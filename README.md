---
<p align="center">
  <a href="#">
    <img alt="ffmpeg-wasm-browser" width="128px" height="128px" src="https://github.com/ffmpegwasm/ffmpeg.wasm/blob/main/apps/website/static/img/logo192.png"></img>
  </a>
</p>

# ffmpeg-wasm-browser

ffmpeg-wasm-browser is a browser-focused fork of [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm).

> **Note**: This is the YARI-DEV fork branch (ork-yari-dev) used for testing the original WasmFS OPFS implementation in isolation. It keeps the upstream JavaScript API shape, while changing the core build for large browser media jobs: WebAssembly Memory64, WasmFS with OPFS-backed files, JSPI-enabled async filesystem calls, and native DASH parsing through libxml2.

[![stability-experimental](https://img.shields.io/badge/stability-experimental-orange.svg)](https://github.com/emersion/stability-badges#experimental)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Why this fork exists

The upstream project is a good general-purpose FFmpeg port for the browser. This fork is aimed at workloads where media files, temporary segments, and muxed outputs can be hundreds of megabytes or several gigabytes.

Instead of putting every large file in the in-memory filesystem, this build can mount the browser's Origin Private File System at `/opfs`. FFmpeg still sees normal POSIX-style paths, but files below that mount point are backed by browser storage through Emscripten WasmFS.

## What is different

- `-sMEMORY64=1` is applied across the dependencies and final core build.
- `-sWASMFS`, `-sJSPI`, and `-lopfs.js` are enabled for OPFS-backed filesystem access.
- The single-thread build starts small and can grow to an 8 GiB maximum heap in the current build script (can be increased).
- libxml2 is built and linked with FFmpeg, enabling FFmpeg's native DASH demuxer.
- Additional OPFS helpers are exposed on the core and wrapper APIs.
- The generated Emscripten OPFS access shim is patched after build so large FFmpeg writes do not open and close a browser writable stream for every small AVIO write.

Files outside `/opfs` continue to use the normal in-memory filesystem. OPFS is opt-in per path.

## Browser support

This fork targets browsers with support for:

- WebAssembly Memory64
- WebAssembly JSPI
- Origin Private File System

At the time of this fork, that effectively means modern Chromium-based browsers. Firefox and Safari should be treated as unsupported until they ship the required WebAssembly and storage features.

## API additions

The upstream `FFmpeg` API is kept where possible. This fork adds:

```ts
mountOPFS(mountPoint?: string): Promise<string>
mkdirp(path: string): Promise<boolean>
writeFileOPFS(path: string, data: Uint8Array | ArrayBuffer | string | number[]): Promise<boolean>
fileSize(path: string): Promise<number>
readFileChunk(path: string, offset: number, length: number): Promise<Uint8Array>
```

Use `writeFileOPFS()` for large OPFS inputs and `readFileChunk()` for large OPFS outputs. Calling `readFile()` on a multi-gigabyte output still asks JavaScript to allocate the whole file at once.

## Example

```js
const ffmpeg = new FFmpeg();

await ffmpeg.load({
  coreURL: "/ffmpeg-core.js",
  wasmURL: "/ffmpeg-core.wasm",
});

await ffmpeg.mountOPFS("/opfs");
await ffmpeg.mkdirp("/opfs/job-1");

await ffmpeg.writeFileOPFS("/opfs/job-1/input.mp4", inputBytes);

await ffmpeg.exec([
  "-i", "/opfs/job-1/input.mp4",
  "-c", "copy",
  "/opfs/job-1/output.mp4",
]);

const size = await ffmpeg.fileSize("/opfs/job-1/output.mp4");
const chunkSize = 32 * 1024 * 1024;

for (let offset = 0; offset < size; offset += chunkSize) {
  const chunk = await ffmpeg.readFileChunk(
    "/opfs/job-1/output.mp4",
    offset,
    Math.min(chunkSize, size - offset)
  );

  // Stream or save this chunk in your application.
}
```

## DASH

Because libxml2 is included, FFmpeg's native DASH demuxer is available:

```js
await ffmpeg.exec([
  "-i", "/opfs/job-1/manifest.mpd",
  "-c", "copy",
  "/opfs/job-1/output.mp4",
]);
```

You may still choose to resolve manifests in JavaScript when an application needs custom networking, authentication, range fetching, or progress reporting. The difference is that the core build no longer disables FFmpeg's own DASH parser.

## Workers and JSPI

The core exports `ffmpeg`, `ffprobe`, and the OPFS helper functions as JSPI async exports. That allows synchronous FFmpeg filesystem code to suspend while browser OPFS promises complete.

The default wrapper in this repository still follows the upstream class worker architecture. A separate no-worker wrapper is also available from `@ffmpeg-wasm-browser/ffmpeg/no-worker`; it loads `ffmpeg-core.js` in the current browser context and calls the async core API directly. That integration style is useful in constrained browser contexts such as extension page-world injection.

The UMD build emits both wrapper files:

```text
dist/umd/ffmpeg.js
dist/umd/ffmpeg-no-worker.js
```

## Building

Docker Buildx is required.

```bash
make prd
```

The production target builds the single-thread Memory64 core. The multithread target is retained for parity with the upstream build layout, but it is not the active target for this fork because the current Emscripten pthreads runtime does not compose with `-sMEMORY64=1` in this setup.

The OPFS access patch is applied automatically during the Docker build:

```bash
node scripts/patch-opfs-async-access.js dist/umd/ffmpeg-core.js
node scripts/patch-opfs-async-access.js dist/esm/ffmpeg-core.js
```

More implementation notes are in [docs/opfs-wasmfs.md](docs/opfs-wasmfs.md).

## Relation to upstream

This project is a fork of [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm). The goal is not to replace upstream, but to provide a separate browser-large-file build profile with different tradeoffs and browser requirements.

## License

- JavaScript packages: [MIT](LICENSE)
- FFmpeg core package: GPL-2.0-or-later, following FFmpeg and the enabled GPL components
