# ffmpeg-wasm-browser OPFS/WasmFS Build Notes

This fork builds `ffmpeg-core` with Emscripten WasmFS and the OPFS backend.
The goal is to let large HLS/DASH staging jobs place temporary media files and
`output.mp4` under browser-backed storage instead of MEMFS.

## Build switches

`build/ffmpeg-wasm.sh` enables:

- `-sWASMFS`
- `-sFORCE_FILESYSTEM`
- `-sJSPI`
- `-sJSPI_EXPORTS=ffmpeg,ffprobe,ffwasm_mount_opfs,ffwasm_mkdirp,ffwasm_write_file,ffwasm_file_size,ffwasm_read_file_chunk`
- `-lopfs.js`

`-sJSPI` is required because the OPFS backend performs asynchronous browser
storage work behind synchronous POSIX-style file operations. The public
`exec()` and `ffprobe()` wrappers are therefore Promise-returning.

The generated Emscripten MAIN-thread OPFS fallback is patched after build by
`scripts/patch-opfs-async-access.js`. Without that patch, each WasmFS write
opens an OPFS writable stream, writes one AVIO-sized chunk, and closes the
stream again. That can make large muxes extremely slow in extension context.
The patch keeps the writable stream open until file close and
caches read blobs, preserving the OPFS memory benefits while avoiding thousands
of per-chunk commits.

## Core API

After loading `ffmpeg-core`, mount OPFS once:

```js
await core.mountOPFS("/opfs");
await core.mkdirp("/opfs/job-123");
```

Then use the existing FS API with OPFS-backed paths:

```js
await core.writeFileOPFS("/opfs/job-123/media.m3u8", playlistBytes);
await core.writeFileOPFS("/opfs/job-123/seg_0001.ts", segmentBytes);

await core.exec(
  "-allowed_extensions", "ALL",
  "-i", "/opfs/job-123/media.m3u8",
  "-c", "copy",
  "/opfs/job-123/output.mp4"
);
```

Files outside `/opfs` still use the normal in-memory filesystem.

`WORKERFS` is intentionally not linked in this build. Emscripten 3.1.74 does
not support `-lworkerfs.js` together with `-sWASMFS`, and OPFS is the large-file
backend this fork targets.

For large outputs, avoid `core.FS.readFile("/opfs/job-123/output.mp4")`.
Read bounded slices instead:

```js
const size = await core.fileSize("/opfs/job-123/output.mp4");
const part = await core.readFileChunk("/opfs/job-123/output.mp4", 0, 32 * 1024 * 1024);
```

## Why this helps

MEMFS stores file contents in memory, so a large mux can hold input segment
files, `output.mp4`, and a final `readFile()` copy at the same time. OPFS-backed
WasmFS paths move the staged files and mux output into browser storage, reducing
peak JS/WASM memory pressure. There are still transient buffers when JavaScript
fetches and writes a segment, but the complete segment set and final output no
longer have to live as MEMFS allocations.

## Runtime notes

OPFS is a browser feature. The core is built for both `web` and `worker`
environments so it can be loaded by the no-worker wrapper as well as by the
upstream `@ffmpeg-wasm-browser/ffmpeg` worker wrapper.

The upstream wrapper still spawns its class worker by default. The no-worker
wrapper entry can be used instead when an application needs to load the core in
the current browser context; that wrapper awaits the async core
`exec()`/`ffprobe()` calls and forwards the OPFS helpers directly.
