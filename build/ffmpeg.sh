#!/bin/bash

set -euo pipefail

# Strip any shared libs from the dep prefix so FFmpeg (and the downstream core
# link, which inherits this stage) links everything statically. Some deps build
# a .so despite BUILD_SHARED_LIBS=OFF (e.g. zlib's CMake always emits libz.so),
# and emsdk 6.0.2's -l<name> prefers the .so, turning it into a runtime dlopen
# (e.g. "404: libz.so") in a build that must be self-contained.
rm -f "$INSTALL_DIR"/lib/*.so "$INSTALL_DIR"/lib/*.so.*

CONF_FLAGS=(
  --target-os=none              # disable target specific configs
  --arch=x86_32                 # use x86_32 arch
  --enable-cross-compile        # use cross compile configs
  --disable-asm                 # disable asm
  --disable-stripping           # disable stripping as it won't work
  --disable-programs            # disable ffmpeg, ffprobe and ffplay build
  --disable-doc                 # disable doc build
  --disable-debug               # disable debug mode
  --disable-runtime-cpudetect   # disable cpu detection
  --disable-autodetect          # disable env auto detect

  # assign toolchains and extra flags
  --nm=emnm
  --ar=emar
  --ranlib=emranlib
  --cc=emcc
  --cxx=em++
  --objcc=emcc
  --dep-cc=emcc
  # -fPIC scoped to FFmpeg's build only. emsdk 6.0.2's wasm-ld rejects
  # table-index relocations against function symbols in non-PIC objects
  # (R_WASM_TABLE_INDEX_SLEB), which makes ./configure's lib-detection probes
  # fail ("zlib requested but not found"). Keeping it here (not global) means
  # the external libs stay static .a and the final core links statically —
  # applying it globally made emscripten emit a MAIN_MODULE that tried to
  # dlopen libz.so at runtime.
  --extra-cflags="$CFLAGS -fPIC"
  --extra-cxxflags="$CXXFLAGS -fPIC"

  # disable thread when FFMPEG_ST is NOT defined
  ${FFMPEG_ST:+ --disable-pthreads --disable-w32threads --disable-os2threads}
)

emconfigure ./configure "${CONF_FLAGS[@]}" $@
# Cap parallelism: unbounded `make -j` spawns one clang per libavfilter TU and
# OOM-kills individual compilers when the toolchain runs under x86 emulation
# (amd64-only emsdk on arm64 hosts). Override with FFMPEG_JOBS if desired.
emmake make -j"${FFMPEG_JOBS:-4}"
