#!/bin/bash
# `-o <OUTPUT_FILE_NAME>` must be provided when using this build script.
# ex:
#     bash ffmpeg-wasm.sh -o ffmpeg.js

set -euo pipefail

EXPORT_NAME="createFFmpegCore"

CONF_FLAGS=(
  -I.
  -I./src/fftools
  -I./compat/stdbit                       # FFmpeg 7.x fftools use C23 <stdbit.h>; emsdk lacks it, use FFmpeg's compat fallback
  -I$INSTALL_DIR/include
  -L$INSTALL_DIR/lib 
  -Llibavcodec 
  -Llibavdevice 
  -Llibavfilter 
  -Llibavformat 
  -Llibavutil 
  -Llibpostproc 
  -Llibswresample 
  -Llibswscale 
  -lavcodec 
  -lavdevice 
  -lavfilter 
  -lavformat 
  -lavutil 
  -lpostproc 
  -lswresample 
  -lswscale 
  -Wno-deprecated-declarations 
  $LDFLAGS 
  -sENVIRONMENT=worker
  -sWASM_BIGINT                            # enable big int support
  -sUSE_SDL=2                              # use emscripten SDL2 lib port
  -sSTACK_SIZE=5MB                         # increase stack size to support libopus
  -sMODULARIZE                             # modularized to use as a library
  ${FFMPEG_MT:+ -sINITIAL_MEMORY=1024MB}   # ALLOW_MEMORY_GROWTH is not recommended when using threads, thus we use a large initial memory
  ${FFMPEG_MT:+ -sPTHREAD_POOL_SIZE=64}    # FFmpeg 7.x scheduler runs demux/decode/filter/encode/mux on their own threads PLUS per-codec frame-threading (capped ~16/codec); pool must cover the peak or overflow pthread_create deadlocks in the worker (can't spawn while blocked)
  ${FFMPEG_ST:+ -sINITIAL_MEMORY=32MB -sALLOW_MEMORY_GROWTH} # Use just enough memory as memory usage can grow
  -sEXPORT_NAME="$EXPORT_NAME"             # required in browser env, so that user can access this module from window object
  -sEXPORTED_FUNCTIONS=$(node src/bind/ffmpeg/export.js) # exported functions
  -sEXPORTED_RUNTIME_METHODS=$(node src/bind/ffmpeg/export-runtime.js) # exported built-in functions
  -lworkerfs.js
  --pre-js src/bind/ffmpeg/bind.js        # extra bindings, contains most of the ffmpeg.wasm javascript code
  # ffmpeg source code (FFmpeg 7.x fftools: scheduler-based frontend adds
  # ffmpeg_dec/enc/demux/mux_init/sched + objpool/sync_queue/thread_queue)
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
  src/fftools/objpool.c
  src/fftools/opt_common.c
  src/fftools/sync_queue.c
  src/fftools/thread_queue.c
  src/fftools/ffprobe.c
)

emcc "${CONF_FLAGS[@]}" $@

# emsdk 6.0.2 spawns pthread workers from `_scriptName`, which is the URL of the
# script that ran importScripts() — i.e. the @ffmpeg/ffmpeg wrapper worker, NOT
# the core. That makes pthread workers load the wrong script and load() hangs.
# Restore emscripten's mainScriptUrlOrBlob override (the wrapper already sets it
# to the core URL) so pthread workers load the core. Idempotent.
for out in dist/umd/ffmpeg-core.js dist/esm/ffmpeg-core.js; do
  if [ -f "$out" ]; then
    sed -i 's/var pthreadMainJs=_scriptName/var pthreadMainJs=Module["mainScriptUrlOrBlob"]||_scriptName/g' "$out"
  fi
done
