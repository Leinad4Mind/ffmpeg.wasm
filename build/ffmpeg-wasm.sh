#!/bin/bash
# `-o <OUTPUT_FILE_NAME>` must be provided when using this build script.
# ex:
#     bash ffmpeg-wasm.sh -o ffmpeg.js

set -euo pipefail

EXPORT_NAME="createFFmpegCore"

CONF_FLAGS=(
  -I.
  -I./src/fftools
  -I./compat/stdbit                       # FFmpeg 7.x/8.x fftools use C23 <stdbit.h>; emsdk lacks it, use FFmpeg's compat fallback
  -I$INSTALL_DIR/include
  -L$INSTALL_DIR/lib 
  -Llibavcodec 
  -Llibavdevice 
  -Llibavfilter 
  -Llibavformat
  -Llibavutil
  -Llibswresample
  -Llibswscale
  -lavcodec
  -lavdevice
  -lavfilter
  -lavformat
  -lavutil
  -lswresample
  -lswscale
  -Wno-deprecated-declarations 
  $LDFLAGS 
  -sENVIRONMENT=worker
  -sMEMORY64=1                             # enable 64-bit wasm memory
  -sWASM_BIGINT                            # i64 values across JS<->wasm cross as BigInt (needed for MEMORY64)
  -sWASMFS                                 # use the wasm-native filesystem layer
  -sFORCE_FILESYSTEM                       # keep the JS FS API used by @ffmpeg-wasm-browser/ffmpeg and the extension
  -sJSPI                                   # OPFS-backed WasmFS operations are async under the hood
  -sJSPI_EXPORTS=ffmpeg,ffprobe,ffwasm_mount_opfs,ffwasm_mkdirp,ffwasm_write_file,ffwasm_file_size,ffwasm_read_file_chunk
  -sUSE_SDL=2                              # use emscripten SDL2 lib port
  -sSTACK_SIZE=5MB                         # increase stack size to support libopus
  -sMODULARIZE                             # modularized to use as a library
  ${FFMPEG_MT:+ -sINITIAL_MEMORY=1024MB}   # ALLOW_MEMORY_GROWTH is not recommended when using threads, thus we use a large initial memory
  ${FFMPEG_MT:+ -sPTHREAD_POOL_SIZE=32}    # scheduler threads + per-codec frame-threading (capped to 8 cores post-build) fit in 32; overflow pthread_create deadlocks in the worker. 32 also keeps multi-instance worker count sane.
  ${FFMPEG_ST:+ -sINITIAL_MEMORY=32MB -sALLOW_MEMORY_GROWTH} # Use just enough memory as memory usage can grow
  -sEXPORT_NAME="$EXPORT_NAME"             # required in browser env, so that user can access this module from window object
  -sEXPORTED_FUNCTIONS=$(node src/bind/ffmpeg/export.js) # exported functions
  -sEXPORTED_RUNTIME_METHODS=$(node src/bind/ffmpeg/export-runtime.js) # exported built-in functions
  -lopfs.js
  --pre-js src/bind/ffmpeg/bind.js        # extra bindings, contains most of the ffmpeg.wasm javascript code
  # ffmpeg source code (FFmpeg 8.x fftools: scheduler-based frontend =
  # ffmpeg_dec/enc/demux/mux_init/sched + sync_queue/thread_queue). vs 7.x:
  # objpool.c was dropped (thread_queue now uses libavutil/container_fifo);
  # ffprobe's writers were extracted into textformat/*; graph/graphprint.c is a
  # fork stub (upstream needs the resources/resman resource-bundling pipeline).
  src/fftools/cmdutils.c
  src/fftools/ffmpeg.c
  src/fftools/ffmpeg_dec.c
  src/fftools/ffmpeg_demux.c
  src/fftools/ffmpeg_enc.c
  src/fftools/ffmpeg_filter.c
  src/fftools/ffmpeg_hw.c
  src/fftools/ffmpeg_mux.c
  src/fftools/ffmpeg_mux_init.c
  src/fftools/ffmpeg_opt.c
  src/fftools/ffmpeg_sched.c
  src/fftools/graph/graphprint.c
  src/fftools/opt_common.c
  src/fftools/sync_queue.c
  src/fftools/thread_queue.c
  src/fftools/textformat/avtextformat.c
  src/fftools/textformat/tf_compact.c
  src/fftools/textformat/tf_default.c
  src/fftools/textformat/tf_flat.c
  src/fftools/textformat/tf_ini.c
  src/fftools/textformat/tf_json.c
  src/fftools/textformat/tf_mermaid.c
  src/fftools/textformat/tf_xml.c
  src/fftools/textformat/tw_avio.c
  src/fftools/textformat/tw_buffer.c
  src/fftools/textformat/tw_stdout.c
  src/fftools/ffprobe.c
  src/bind/ffmpeg/opfs.c
)

# Codec link libs by variant (default full). Mirrors the --enable set chosen in
# build/ffmpeg.sh. -lz is always present (PNG/zlib). Slim links only x264 + z.
case "${FFMPEG_VARIANT:-full}" in
  slim)
    FFMPEG_LIBS=(-lx264 -lz)
    ;;
  full)
    FFMPEG_LIBS=(-lx264 -lvpx -lmp3lame -lopus -lz -lwebpmux -lwebp -lsharpyuv -lzimg)
    ;;
  *)
    echo "ffmpeg-wasm build: unknown FFMPEG_VARIANT='${FFMPEG_VARIANT:-}'" >&2
    exit 1
    ;;
esac

emcc "${CONF_FLAGS[@]}" "${FFMPEG_LIBS[@]}" $@

# Post-build patches to the emscripten output. Target only the -o file just
# built (this script runs once per variant) so patches aren't double-applied.
OUT=$(echo "$@" | sed -n 's/.*-o \([^ ]*\.js\).*/\1/p')
if [ -n "$OUT" ] && [ -f "$OUT" ]; then
  # (1) emsdk 6.0.2 spawns pthread workers from `_scriptName` — the URL of the
  # script that ran importScripts() (the @ffmpeg/ffmpeg wrapper worker), NOT the
  # core — so pthread workers load the wrong script and load() hangs. Restore
  # emscripten's mainScriptUrlOrBlob override (the wrapper sets it to the core URL).
  sed -i 's/var pthreadMainJs=_scriptName/var pthreadMainJs=Module["mainScriptUrlOrBlob"]||_scriptName/g' "$OUT"

  # (2) Cap the core count FFmpeg auto-detects (av_cpu_count -> sysconf ->
  # navigator.hardwareConcurrency). Uncapped, the 7.x scheduler + per-codec
  # frame-threading requests ~2*cores threads and overflows the pthread pool,
  # deadlocking mid-transcode; capping keeps a transcode within a modest pool
  # and keeps per-instance worker count low. Explicit -threads still overrides.
  sed -i 's/navigator\["hardwareConcurrency"\]/Math.min(navigator["hardwareConcurrency"]||8,8)/g' "$OUT"
fi
