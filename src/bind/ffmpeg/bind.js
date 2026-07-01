/**
 * Constants
 */

const NULL = 0;
const SIZE_I32 = Uint32Array.BYTES_PER_ELEMENT;
const DEFAULT_ARGS = ["./ffmpeg", "-nostdin", "-y"];
const DEFAULT_ARGS_FFPROBE = ["./ffprobe"];

Module["NULL"] = NULL;
Module["SIZE_I32"] = SIZE_I32;
Module["DEFAULT_ARGS"] = DEFAULT_ARGS;
Module["DEFAULT_ARGS_FFPROBE"] = DEFAULT_ARGS_FFPROBE;

/**
 * Variables
 */

Module["ret"] = -1;
Module["timeout"] = -1;
Module["logger"] = () => {};
Module["progress"] = () => {};

/**
 * Functions
 */

function stringToPtr(str) {
  const len = Module["lengthBytesUTF8"](str) + 1;
  const ptr = Module["_malloc"](len);
  Module["stringToUTF8"](str, ptr, len);

  return ptr;
}

function stringsToPtr(strs) {
  const len = strs.length;
  const ptr = Module["_malloc"](len * SIZE_I32);
  for (let i = 0; i < len; i++) {
    Module["setValue"](ptr + SIZE_I32 * i, stringToPtr(strs[i]), "i32");
  }

  return ptr;
}

function print(message) {
  Module["logger"]({ type: "stdout", message });
}

function printErr(message) {
  if (!message.startsWith("Aborted(native code called abort())"))
    Module["logger"]({ type: "stderr", message });
}

function exec(..._args) {
  const args = [...Module["DEFAULT_ARGS"], ..._args];
  try {
    // FFmpeg 7.x/8.x removed exit_program(); main()/ffmpeg() now returns the exit
    // code directly, so capture the return value instead of relying on a
    // C-side EM_ASM setting Module.ret. The Aborted catch remains for the
    // timeout path, which still abort()s.
    Module["ret"] = Module["_ffmpeg"](args.length, stringsToPtr(args));
  } catch (e) {
    if (!e.message.startsWith("Aborted")) {
      throw e;
    }
  }
  return Module["ret"];
}

function ffprobe(..._args) {
  const args = [...Module["DEFAULT_ARGS_FFPROBE"], ..._args];
  try {
    Module["ret"] = Module["_ffprobe"](args.length, stringsToPtr(args));
  } catch (e) {
    if (!e.message.startsWith("Aborted")) {
      throw e;
    }
  }
  return Module["ret"];
}

async function mountOPFS(mountPoint = "/opfs") {
  if (typeof Module["_ffwasm_mount_opfs"] !== "function") {
    throw new Error("OPFS support was not compiled into this ffmpeg-core");
  }

  const ptr = stringToPtr(mountPoint);
  try {
    const ret = await Module["_ffwasm_mount_opfs"](asPtrSize(ptr));
    if (ret !== 0) {
      throw new Error(`mountOPFS(${mountPoint}) failed with ${ret}`);
    }
    return mountPoint;
  } finally {
    if (typeof Module["_free"] === "function") Module["_free"](ptr);
  }
}

async function mkdirp(path) {
  if (typeof Module["_ffwasm_mkdirp"] !== "function") {
    throw new Error("mkdirp support was not compiled into this ffmpeg-core");
  }

  const ptr = stringToPtr(path);
  try {
    const ret = await Module["_ffwasm_mkdirp"](asPtrSize(ptr));
    if (ret !== 0) {
      throw new Error(`mkdirp(${path}) failed with ${ret}`);
    }
    return true;
  } finally {
    if (typeof Module["_free"] === "function") Module["_free"](ptr);
  }
}

function normalizeFileData(data) {
  if (data instanceof Uint8Array) return data;
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof data === "string") return new TextEncoder().encode(data);
  if (Array.isArray(data)) return new Uint8Array(data);
  throw new Error("Unsupported file data type");
}

async function writeFileOPFS(path, data) {
  if (typeof Module["_ffwasm_write_file"] !== "function") {
    throw new Error("writeFileOPFS support was not compiled into this ffmpeg-core");
  }

  const bytes = normalizeFileData(data);
  const pathPtr = stringToPtr(path);
  const dataPtr = bytes.length > 0 ? Module["_malloc"](bytes.length) : NULL;
  try {
    if (bytes.length > 0) {
      Module["HEAPU8"].set(bytes, dataPtr);
    }
    const ret = await Module["_ffwasm_write_file"](
      asPtrSize(pathPtr),
      asPtrSize(dataPtr),
      asPtrSize(bytes.length)
    );
    if (ret !== 0) {
      throw new Error(`writeFileOPFS(${path}) failed with ${ret}`);
    }
    return true;
  } finally {
    if (dataPtr) Module["_free"](dataPtr);
    if (typeof Module["_free"] === "function") Module["_free"](pathPtr);
  }
}

async function fileSize(path) {
  if (typeof Module["_ffwasm_file_size"] !== "function") {
    throw new Error("fileSize support was not compiled into this ffmpeg-core");
  }

  const pathPtr = stringToPtr(path);
  try {
    const ret = await Module["_ffwasm_file_size"](asPtrSize(pathPtr));
    const size = ptrToNumber(ret);
    if (size < 0) {
      throw new Error(`fileSize(${path}) failed with ${size}`);
    }
    return size;
  } finally {
    if (typeof Module["_free"] === "function") Module["_free"](pathPtr);
  }
}

async function readFileChunk(path, offset, length) {
  if (typeof Module["_ffwasm_read_file_chunk"] !== "function") {
    throw new Error("readFileChunk support was not compiled into this ffmpeg-core");
  }

  if (offset < 0 || length < 0) {
    throw new Error("readFileChunk offset and length must be non-negative");
  }

  const pathPtr = stringToPtr(path);
  const outPtr = length > 0 ? Module["_malloc"](length) : NULL;
  const bytesReadPtr = Module["_malloc"](_getPointerSize());
  try {
    const ret = await Module["_ffwasm_read_file_chunk"](
      asPtrSize(pathPtr),
      asPtrSize(offset),
      asPtrSize(outPtr),
      asPtrSize(length),
      asPtrSize(bytesReadPtr)
    );
    if (ret !== 0) {
      throw new Error(`readFileChunk(${path}) failed with ${ret}`);
    }
    const bytesRead = ptrToNumber(Module["getValue"](bytesReadPtr, "*"));
    return Module["HEAPU8"].slice(outPtr, outPtr + bytesRead);
  } finally {
    if (outPtr) Module["_free"](outPtr);
    Module["_free"](bytesReadPtr);
    if (typeof Module["_free"] === "function") Module["_free"](pathPtr);
  }
}

function setLogger(logger) {
  Module["logger"] = logger;
}

function setTimeout(timeout) {
  Module["timeout"] = timeout;
}

function setProgress(handler) {
  Module["progress"] = handler;
}

function receiveProgress(progress, time) {
  Module["progress"]({ progress, time });
}

function reset() {
  Module["ret"] = -1;
  Module["timeout"] = -1;
}

/**
 * In multithread version of ffmpeg.wasm, the bootstrap process is like:
 * 1. Execute ffmpeg-core.js
 * 2. ffmpeg-core.js spawns workers by calling `new Worker("ffmpeg-core.worker.js")`
 * 3. ffmpeg-core.worker.js imports ffmpeg-core.js
 * 4. ffmpeg-core.js imports ffmpeg-core.wasm
 *
 * It is a straightforward process when all files are in the same location.
 * But when files are in different location (or Blob URL), #4 fails because
 * there is no way to pass custom ffmpeg-core.wasm URL to ffmpeg-core.worker.js
 * when it imports ffmpeg-core.js in #3.
 *
 * To fix this issue, a hack here is leveraging mainScriptUrlOrBlob variable by
 * adding wasmURL and workerURL in base64 format as query string. ex:
 *
 *   http://example.com/ffmpeg-core.js#{btoa(JSON.stringify({"wasmURL": "...", "workerURL": "..."}))}
 *
 * Thus, we can successfully extract custom URLs using _locateFile funciton.
 */
function _locateFile(path, prefix) {
  const mainScriptUrlOrBlob = Module["mainScriptUrlOrBlob"];
  if (mainScriptUrlOrBlob) {
    const { wasmURL, workerURL } = JSON.parse(
      atob(mainScriptUrlOrBlob.slice(mainScriptUrlOrBlob.lastIndexOf("#") + 1))
    );
    if (path.endsWith(".wasm")) return wasmURL;
    if (path.endsWith(".worker.js")) return workerURL;
  }
  return prefix + path;
}

Module["stringToPtr"] = stringToPtr;
Module["stringsToPtr"] = stringsToPtr;
Module["print"] = print;
Module["printErr"] = printErr;
Module["locateFile"] = _locateFile;

Module["exec"] = exec;
Module["ffprobe"] = ffprobe;
Module["mountOPFS"] = mountOPFS;
Module["mkdirp"] = mkdirp;
Module["writeFileOPFS"] = writeFileOPFS;
Module["fileSize"] = fileSize;
Module["readFileChunk"] = readFileChunk;
Module["setLogger"] = setLogger;
Module["setTimeout"] = setTimeout;
Module["setProgress"] = setProgress;
Module["reset"] = reset;
Module["receiveProgress"] = receiveProgress;
