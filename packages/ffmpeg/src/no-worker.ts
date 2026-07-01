import type { FFmpegCoreModule, FFmpegCoreModuleFactory } from "@ffmpeg/types";
import { CORE_URL } from "./const.js";
import {
  ERROR_IMPORT_FAILURE,
  ERROR_NOT_LOADED,
} from "./errors.js";
import {
  FFFSPath,
  FFFSType,
  FFFSMountOptions,
  FileData,
  FSNode,
  IsFirst,
  LogEventCallback,
  OK,
  ProgressEventCallback,
} from "./types.js";

type FFMessageOptions = {
  signal?: AbortSignal;
};

type NoWorkerLoadConfig = {
  coreURL?: string;
  wasmURL?: string;
  workerURL?: string;
  corePath?: string;
};

type CoreFileData =
  | FileData
  | ArrayBuffer
  | number[];

declare global {
  interface Window {
    createFFmpegCore?: FFmpegCoreModuleFactory;
  }
}

const getGlobalScope = (): Window & typeof globalThis =>
  (typeof self !== "undefined" ? self : globalThis) as Window & typeof globalThis;

/**
 * FFmpeg wrapper that loads ffmpeg-core directly in the current browser
 * context instead of spawning the upstream class worker.
 *
 * This is useful in browser integration contexts where a worker cannot be
 * constructed or where the caller wants to pre-inject ffmpeg-core.js.
 */
export class FFmpeg {
  #ffmpeg: FFmpegCoreModule | null = null;
  #logEventCallbacks: LogEventCallback[] = [];
  #progressEventCallbacks: ProgressEventCallback[] = [];

  public loaded = false;

  public on(event: "log", callback: LogEventCallback): void;
  public on(event: "progress", callback: ProgressEventCallback): void;
  public on(
    event: "log" | "progress",
    callback: LogEventCallback | ProgressEventCallback
  ) {
    if (event === "log") {
      this.#logEventCallbacks.push(callback as LogEventCallback);
    } else if (event === "progress") {
      this.#progressEventCallbacks.push(callback as ProgressEventCallback);
    }
  }

  public off(event: "log", callback: LogEventCallback): void;
  public off(event: "progress", callback: ProgressEventCallback): void;
  public off(
    event: "log" | "progress",
    callback: LogEventCallback | ProgressEventCallback
  ) {
    if (event === "log") {
      this.#logEventCallbacks = this.#logEventCallbacks.filter(
        (f) => f !== callback
      );
    } else if (event === "progress") {
      this.#progressEventCallbacks = this.#progressEventCallbacks.filter(
        (f) => f !== callback
      );
    }
  }

  public load = async (
    { coreURL, wasmURL, workerURL, corePath }: NoWorkerLoadConfig = {},
    { signal }: FFMessageOptions = {}
  ): Promise<IsFirst> => {
    if (corePath && !coreURL) coreURL = corePath;
    if (!coreURL) coreURL = CORE_URL;

    if (signal?.aborted) {
      throw new DOMException("Loading aborted", "AbortError");
    }

    const first = !this.#ffmpeg;
    const globalScope = getGlobalScope();

    try {
      if (typeof globalScope.createFFmpegCore !== "function") {
        await this.#loadScript(coreURL, signal);
      }

      if (typeof globalScope.createFFmpegCore !== "function") {
        throw ERROR_IMPORT_FAILURE;
      }

      const actualWasmURL = wasmURL || coreURL.replace(/.js$/g, ".wasm");
      const actualWorkerURL =
        workerURL || coreURL.replace(/.js$/g, ".worker.js");

      this.#ffmpeg = await globalScope.createFFmpegCore({
        mainScriptUrlOrBlob: `${coreURL}#${btoa(
          JSON.stringify({
            wasmURL: actualWasmURL,
            workerURL: actualWorkerURL,
          })
        )}`,
      });

      this.#ffmpeg.setLogger((data) =>
        this.#logEventCallbacks.forEach((f) => f(data))
      );
      this.#ffmpeg.setProgress((data) =>
        this.#progressEventCallbacks.forEach((f) => f(data))
      );

      this.loaded = true;
      return first;
    } catch (error) {
      if ((error as Error).name === "AbortError") throw error;
      throw ERROR_IMPORT_FAILURE;
    }
  };

  async #loadScript(url: string, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw new DOMException("Loading aborted", "AbortError");
    }

    if (typeof document === "undefined") {
      const workerImportScripts = (
        globalThis as { importScripts?: (...urls: string[]) => void }
      ).importScripts;

      try {
        if (typeof workerImportScripts !== "function") {
          throw ERROR_IMPORT_FAILURE;
        }
        workerImportScripts(url);
        return;
      } catch {
        throw ERROR_IMPORT_FAILURE;
      }
    }

    await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      const cleanup = () => {
        script.onload = null;
        script.onerror = null;
        signal?.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        cleanup();
        script.remove();
        reject(new DOMException("Loading aborted", "AbortError"));
      };

      script.src = url;
      script.onload = () => {
        cleanup();
        resolve();
      };
      script.onerror = () => {
        cleanup();
        reject(ERROR_IMPORT_FAILURE);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      document.head.appendChild(script);
    });
  }

  public exec = async (
    args: string[],
    timeout = -1,
    { signal }: FFMessageOptions = {}
  ): Promise<number> => {
    if (!this.#ffmpeg) throw ERROR_NOT_LOADED;
    if (signal?.aborted) {
      throw new DOMException("FFmpeg execution aborted", "AbortError");
    }

    this.#ffmpeg.setTimeout(timeout);
    await this.#ffmpeg.exec(...args);
    const ret = this.#ffmpeg.ret;
    this.#ffmpeg.reset();
    return ret;
  };

  public ffprobe = async (
    args: string[],
    timeout = -1,
    { signal }: FFMessageOptions = {}
  ): Promise<number> => {
    if (!this.#ffmpeg) throw ERROR_NOT_LOADED;
    if (signal?.aborted) {
      throw new DOMException("FFprobe execution aborted", "AbortError");
    }

    this.#ffmpeg.setTimeout(timeout);
    await this.#ffmpeg.ffprobe(...args);
    const ret = this.#ffmpeg.ret;
    this.#ffmpeg.reset();
    return ret;
  };

  public terminate = (): void => {
    this.#ffmpeg = null;
    this.loaded = false;
  };

  public writeFile = async (
    path: string,
    data: FileData,
    { signal }: FFMessageOptions = {}
  ): Promise<OK> => {
    if (!this.#ffmpeg) throw ERROR_NOT_LOADED;
    if (signal?.aborted) {
      throw new DOMException("Write operation aborted", "AbortError");
    }

    this.#ffmpeg.FS.writeFile(path, data);
    return true;
  };

  public mount = async (
    fsType: FFFSType,
    options: FFFSMountOptions,
    mountPoint: FFFSPath
  ): Promise<OK> => {
    if (!this.#ffmpeg) throw ERROR_NOT_LOADED;

    const fs = this.#ffmpeg.FS.filesystems[
      fsType as keyof typeof this.#ffmpeg.FS.filesystems
    ];
    if (!fs) return false;

    this.#ffmpeg.FS.mount(fs, options, mountPoint);
    return true;
  };

  public unmount = async (mountPoint: FFFSPath): Promise<OK> => {
    if (!this.#ffmpeg) throw ERROR_NOT_LOADED;
    this.#ffmpeg.FS.unmount(mountPoint);
    return true;
  };

  public mountOPFS = async (
    mountPoint: FFFSPath = "/opfs",
    { signal }: FFMessageOptions = {}
  ): Promise<FFFSPath> => {
    if (!this.#ffmpeg) throw ERROR_NOT_LOADED;
    if (signal?.aborted) {
      throw new DOMException("OPFS mount aborted", "AbortError");
    }
    if (typeof this.#ffmpeg.mountOPFS !== "function") {
      throw new Error("mountOPFS is not available in this ffmpeg-core build");
    }
    return this.#ffmpeg.mountOPFS(mountPoint);
  };

  public mkdirp = async (
    path: FFFSPath,
    { signal }: FFMessageOptions = {}
  ): Promise<OK> => {
    if (!this.#ffmpeg) throw ERROR_NOT_LOADED;
    if (signal?.aborted) {
      throw new DOMException("mkdirp aborted", "AbortError");
    }
    if (typeof this.#ffmpeg.mkdirp !== "function") {
      throw new Error("mkdirp is not available in this ffmpeg-core build");
    }
    return this.#ffmpeg.mkdirp(path);
  };

  public writeFileOPFS = async (
    path: FFFSPath,
    data: CoreFileData,
    { signal }: FFMessageOptions = {}
  ): Promise<OK> => {
    if (!this.#ffmpeg) throw ERROR_NOT_LOADED;
    if (signal?.aborted) {
      throw new DOMException("OPFS write aborted", "AbortError");
    }
    if (typeof this.#ffmpeg.writeFileOPFS !== "function") {
      throw new Error("writeFileOPFS is not available in this ffmpeg-core build");
    }
    return this.#ffmpeg.writeFileOPFS(path, data);
  };

  public fileSize = async (
    path: FFFSPath,
    { signal }: FFMessageOptions = {}
  ): Promise<number> => {
    if (!this.#ffmpeg) throw ERROR_NOT_LOADED;
    if (signal?.aborted) {
      throw new DOMException("File size read aborted", "AbortError");
    }
    if (typeof this.#ffmpeg.fileSize !== "function") {
      throw new Error("fileSize is not available in this ffmpeg-core build");
    }
    return this.#ffmpeg.fileSize(path);
  };

  public readFileChunk = async (
    path: FFFSPath,
    offset: number,
    length: number,
    { signal }: FFMessageOptions = {}
  ): Promise<Uint8Array> => {
    if (!this.#ffmpeg) throw ERROR_NOT_LOADED;
    if (signal?.aborted) {
      throw new DOMException("Chunk read aborted", "AbortError");
    }
    if (typeof this.#ffmpeg.readFileChunk !== "function") {
      throw new Error("readFileChunk is not available in this ffmpeg-core build");
    }
    return this.#ffmpeg.readFileChunk(path, offset, length);
  };

  public readFile = async (
    path: string,
    encoding = "binary",
    { signal }: FFMessageOptions = {}
  ): Promise<FileData> => {
    if (!this.#ffmpeg) throw ERROR_NOT_LOADED;
    if (signal?.aborted) {
      throw new DOMException("Read operation aborted", "AbortError");
    }

    return this.#ffmpeg.FS.readFile(path, { encoding }) as FileData;
  };

  public deleteFile = async (
    path: string,
    { signal }: FFMessageOptions = {}
  ): Promise<OK> => {
    if (!this.#ffmpeg) throw ERROR_NOT_LOADED;
    if (signal?.aborted) {
      throw new DOMException("Delete operation aborted", "AbortError");
    }

    this.#ffmpeg.FS.unlink(path);
    return true;
  };

  public rename = async (
    oldPath: string,
    newPath: string,
    { signal }: FFMessageOptions = {}
  ): Promise<OK> => {
    if (!this.#ffmpeg) throw ERROR_NOT_LOADED;
    if (signal?.aborted) {
      throw new DOMException("Rename operation aborted", "AbortError");
    }

    this.#ffmpeg.FS.rename(oldPath, newPath);
    return true;
  };

  public createDir = async (
    path: string,
    { signal }: FFMessageOptions = {}
  ): Promise<OK> => {
    if (!this.#ffmpeg) throw ERROR_NOT_LOADED;
    if (signal?.aborted) {
      throw new DOMException("Directory creation aborted", "AbortError");
    }

    this.#ffmpeg.FS.mkdir(path);
    return true;
  };

  public listDir = async (
    path: string,
    { signal }: FFMessageOptions = {}
  ): Promise<FSNode[]> => {
    if (!this.#ffmpeg) throw ERROR_NOT_LOADED;
    if (signal?.aborted) {
      throw new DOMException("Directory listing aborted", "AbortError");
    }

    const names = this.#ffmpeg.FS.readdir(path);
    return names.map((name) => {
      const stat = this.#ffmpeg!.FS.stat(`${path}/${name}`);
      return { name, isDir: this.#ffmpeg!.FS.isDir(stat.mode) };
    });
  };

  public deleteDir = async (
    path: string,
    { signal }: FFMessageOptions = {}
  ): Promise<OK> => {
    if (!this.#ffmpeg) throw ERROR_NOT_LOADED;
    if (signal?.aborted) {
      throw new DOMException("Directory deletion aborted", "AbortError");
    }

    this.#ffmpeg.FS.rmdir(path);
    return true;
  };
}

export { FFFSType };
