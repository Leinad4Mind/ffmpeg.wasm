# Baseline snapshot — pre-upgrade rollback reference

This records the exact state of the **current (pre-upgrade) `n5.1.4` build** so the
FFmpeg 7.1 upgrade (and every intermediate phase) can be diffed against a known-good
reference. Captured on the `chore/phase-0-baseline` branch.

## Toolchain

| Component            | Version / pin                          | Source |
|----------------------|----------------------------------------|--------|
| FFmpeg               | `n5.1.4`                               | `Dockerfile` `FFMPEG_VERSION` |
| Emscripten (emsdk)   | `3.1.40`                               | `Dockerfile` base image (amd64-only) |
| Host build note      | Built under **x86 emulation** on Apple Silicon (arm64); `emsdk:3.1.40` has no arm64 image | — |

## External libraries (all from `github.com/ffmpegwasm/*` forks unless noted)

| Library    | Pin (branch/tag)   | Notes for upgrade |
|------------|--------------------|-------------------|
| x264       | `4-cores` (branch) | **floating branch** — pin to SHA in Phase 4 |
| x265       | `3.4`              | **DROP** in Phase 3 (HEVC encode; decode is native) |
| libvpx     | `v1.13.1`          | keep, consider bump |
| lame       | `master` (branch)  | **floating branch** — pin to SHA in Phase 4 |
| ogg        | `v1.3.4`           | **DROP** with vorbis/theora |
| theora     | `v1.1.1` (2009)    | **DROP** in Phase 3 |
| opus       | `v1.3.1`           | keep |
| vorbis     | `v1.3.3`           | **DROP** in Phase 3 |
| zlib       | `v1.2.11`          | **BUMP → 1.3.1** (CVE-2018-25032, CVE-2022-37434) |
| libwebp    | `v1.3.2`           | keep |
| freetype2  | `VER-2-10-4` (2020)| **BUMP** (CVEs) |
| fribidi    | `v1.0.9` (upstream)| **BUMP → 1.0.13+** (CVE-2022-2530x) |
| harfbuzz   | `5.2.0` (upstream) | **BUMP → 6.0+** (CVE-2023-25193) |
| libass     | `0.15.0`           | keep |
| zimg       | `release-3.0.5`    | keep |

## FFmpeg configure (extracted from `packages/core/dist/umd/ffmpeg-core.wasm`)

```
--target-os=none --arch=x86_32 --enable-cross-compile
--disable-asm --disable-stripping --disable-programs --disable-doc --disable-debug
--disable-runtime-cpudetect --disable-autodetect
--nm=emnm --ar=emar --ranlib=emranlib --cc=emcc --cxx=em++ --objcc=emcc --dep-cc=emcc
--extra-cflags='-I/opt/include -O3 -msimd128'
--extra-cxxflags='-I/opt/include -O3 -msimd128'
--disable-pthreads --disable-w32threads --disable-os2threads      # (ST variant)
--enable-gpl
--enable-libx264 --enable-libx265 --enable-libvpx --enable-libmp3lame
--enable-libtheora --enable-libvorbis --enable-libopus --enable-zlib
--enable-libwebp --enable-libfreetype --enable-libfribidi --enable-libass --enable-libzimg
```

Note: prod build enables `-msimd128` (Emscripten wasm SIMD); FFmpeg's own x86 asm stays
`--disable-asm`. (Corrects an earlier plan note that said SIMD was off.)

## Artifacts

| Artifact                                  | Size    |
|-------------------------------------------|---------|
| `packages/core/dist/umd/ffmpeg-core.wasm` | ~32.2 MB |
| `packages/core/dist/esm/ffmpeg-core.wasm` | ~32.2 MB |
| `packages/core/dist/{umd,esm}/ffmpeg-core.js` | ~112 KB |

Target for the trimmed 7.1 build: smaller wasm after dropping x265/theora/vorbis.

## Test results (baseline)

Run via headless Chrome. MT suites require cross-origin isolation (COOP/COEP), served
here by a scratchpad COI server because the repo's `serve` script is broken (see gaps).

| Suite                          | Result       | Notes |
|--------------------------------|--------------|-------|
| `test:browser:core:st`         | **12 passing** | ST core, full green |
| `test:browser:ffmpeg:st`       | **11 passing** | ST wrapper, full green |
| `test:browser:ffmpeg:mt`       | **11 passing** | **MT real-world path** (core runs in a Worker) — transcodes correctly |
| `test:browser:core:mt`         | 8 passing / **4 failing** | ⚠️ pre-existing test-design limit — loads MT core on the page **main thread**; the 4 threaded ops fail with `Atomics.wait cannot be called in this context` (forbidden on a Window main thread by spec, unfixable by headers/flags) |
| `test:node:core:*`             | ⚠️ pre-existing gap — UMD core needs browser globals (`self`, `location`); Node harness does not shim them |

**Bottom line:** ST fully green; MT build functional and verified via the wrapper/Worker
path (the way it's actually used). The MT-core-direct and Node suites have pre-existing
harness limitations, not build defects.

## Known baseline gaps (inform Phase 1)

- **No transcode-correctness assertions** — tests only check exit code / non-empty / progress==1; a codec regression would pass silently. (Phase 1 adds PSNR/SSIM + stream-probe goldens.)
- **`serve` script is broken** — `package.json` `serve` passes `--headers '{...}'` to `http-server@14.1.1`, which has **no such option** (only `--cors`), so COOP/COEP headers are never sent and pages aren't cross-origin isolated. MT suites can't run against it. Phase 1 should replace it with a server that actually sets COOP/COEP (a minimal one is proven in `scratchpad/coi-server.js`).
- **MT core direct test unsupported by design** — `tests/ffmpeg-core-mt.test.html` runs the MT core on the page main thread; threaded ops hit `Atomics.wait` (illegal on main thread). Phase 1 fix: drive the core from a Worker in that test, or drop it in favor of the wrapper MT test.
- **Node test path broken** — needs `self`/`location`/`document` shims or an ESM-in-Node loader.
- **Build fragility on Apple Silicon** — amd64-only emsdk emulated; required 24 GiB Docker VM + `make -j4` cap (`build/ffmpeg.sh`) to avoid OOM. Phase 2 (native arm64 emsdk) retires this.
