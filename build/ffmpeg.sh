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

# Codec set by variant (default full). Common to both: --enable-gpl (x264 is
# GPL) and --enable-zlib (load-bearing — FFmpeg's PNG decoder needs zlib, and
# the watermark is a PNG overlay). Slim keeps only x264 on top of that; full
# adds the rest of the lean set.
CODEC_FLAGS=(--enable-gpl --enable-zlib --enable-libx264)
case "${FFMPEG_VARIANT:-full}" in
  slim)
    # Aggressive size trim: disable ALL native components, then re-enable only
    # what live-clipping-poc's pipeline needs — H.264/AAC over mp4/ts (stream-
    # copy clip + concat), x264/AAC re-encode, and PNG-overlay watermark.
    # --disable-everything must precede the --enable-*, so redefine CODEC_FLAGS.
    CODEC_FLAGS=(
      --disable-everything
      --enable-gpl
      --enable-zlib
      --enable-libx264
      --enable-protocol=file,pipe,data,concat,concatf
      --enable-demuxer=mov,mpegts,concat,image2,png_pipe,matroska,webm
      --enable-muxer=mp4,mov,null,matroska,webm
      --enable-decoder=h264,aac,png,ass,ssa,srt,subrip,webvtt
      --enable-encoder=libx264,aac,ass,ssa,srt,subrip,webvtt
      --enable-parser=h264,aac,png,ass,srt,webvtt
      --enable-bsf=h264_mp4toannexb,aac_adtstoasc,extract_extradata,null
      --enable-filter=overlay,scale,format,null,copy,aformat,anull,aresample,fps,setpts,asetpts,buffer,buffersink,abuffer,abuffersink,subtitles,ass
      --enable-libass
      --enable-libfreetype
      --enable-libfribidi
    )
    ;;
  full)
    CODEC_FLAGS+=(
      --enable-libvpx
      --enable-libmp3lame
      --enable-libopus
      --enable-libwebp
      --enable-libzimg
    )
    ;;
  *)
    echo "ffmpeg build: unknown FFMPEG_VARIANT='${FFMPEG_VARIANT:-}'" >&2
    exit 1
    ;;
esac

emconfigure ./configure "${CONF_FLAGS[@]}" "${CODEC_FLAGS[@]}" $@
# Cap parallelism: unbounded `make -j` spawns one clang per libavfilter TU and
# OOM-kills individual compilers when the toolchain runs under x86 emulation
# (amd64-only emsdk on arm64 hosts). Override with FFMPEG_JOBS if desired.
emmake make -j"${FFMPEG_JOBS:-4}"
