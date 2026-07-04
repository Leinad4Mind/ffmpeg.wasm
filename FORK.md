# FloSports fork — FFmpeg 7.1.5 (MT-only)

This is a hardened fork of ffmpeg.wasm on **FFmpeg 7.1.5** (upstream is on 5.1.4).
It targets an internal **video clipping** use case: cut, transcode, and losslessly
stitch clips in the browser. Built for **vendoring** (not npm-published).

## What changed vs upstream
- **FFmpeg 5.1.4 → 7.1.5**; **Emscripten 3.1.40 → 6.0.2** (digest-pinned, native arm64 + amd64).
- **Lean codec set**: kept x264, vpx, opus, mp3lame, webp, zimg + native AAC.
  Dropped x265, theora, vorbis/ogg, and the subtitle/text stack (libass, freetype,
  fribidi, harfbuzz) — no subtitles/text overlays. Core is **~23.6 MB** (was 32.7).
- **MT-only.** The 7.x CLI frontend requires threads, so there is no single-threaded
  core. The MT core requires cross-origin isolation (see Headers below).
- Supply chain: floating lib branches (x264, lame) pinned to commit SHAs; zlib bumped
  to **1.3.1** (CVE-2018-25032, CVE-2022-37434) from upstream.

## Capability map (what works in the browser)
| Operation | Status |
|-----------|--------|
| Cut / trim (`-ss`/`-t` `-c copy`) | ✅ |
| Single-input transcode / re-encode | ✅ |
| Lossless concat (`-f concat -c copy`) | ✅ |
| **Multi-input filtergraph** (`xfade` transitions, concat *filter*, overlay) | ❌ deadlocks — **run server-side** |

The multi-input deadlock is a 7.x scheduler-in-wasm limitation (not thread-count).
Softened transitions must be produced server-side.

## Required headers (MT / SharedArrayBuffer)
Serve the app's HTML with:
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp   # or: credentialless (if loading cross-origin video)
```
Without these, the MT core will not load.

## Usage (single long-lived instance)
Create **one** instance, load once, reuse it for every operation (creating/terminating
many instances leaks pthread workers under emsdk 6.0.2):
```js
import { FFmpeg } from "@ffmpeg/ffmpeg";
const ffmpeg = new FFmpeg();
await ffmpeg.load({ coreURL: "/assets/ffmpeg-core.js", thread: true }); // your vendored path
await ffmpeg.writeFile("in.mp4", data);
await ffmpeg.exec(["-ss", "1.5", "-to", "4.0", "-i", "in.mp4", "-c", "copy", "out.mp4"]);
const out = await ffmpeg.readFile("out.mp4");
```

## Build
```
make prd-mt            # builds packages/core-mt/dist (native; requires Docker)
npm ci && npm run build# builds the @ffmpeg/ffmpeg + @ffmpeg/util JS wrappers
npm test               # 12/12 MT suite (headless Chrome)
```
Apple Silicon note: builds run native arm64 on emsdk 6.0.2. `build/ffmpeg.sh` caps
`make -j` (FFMPEG_JOBS, default 4) to avoid OOM; a ~24 GiB Docker VM is recommended.

## Vendoring from a targeted release
Push a `v*` tag → CI builds and attaches `ffmpeg-core-mt-<tag>.tgz` (the core:
`ffmpeg-core.js`, `.wasm`, `.worker.js`) and `ffmpeg-wasm-<tag>.tgz` (the wrapper)
to the GitHub Release. Vendor those into the app and serve them same-origin.
