#!/bin/bash

set -euo pipefail

CONF_FLAGS=(
  --prefix=$INSTALL_DIR                               # install library in a build directory for FFmpeg to include
  --host=x86_64-linux
  --enable-shared=no                                  # not to build shared library
  --enable-static=yes
  --disable-dependency-tracking
  --disable-debug
)
emconfigure ./autogen.sh "${CONF_FLAGS[@]}"
# Install serially (no -j): fribidi's c2man man-page generation is broken under
# emsdk 6.0.2 and races the library install under -j, intermittently failing
# before libfribidi.a/headers land. Serial install does the lib subdir first,
# so the (ignored) doc failure can't clobber it.
emmake make install || true
mkdir -p $INSTALL_DIR/lib/pkgconfig && cp fribidi.pc $INSTALL_DIR/lib/pkgconfig/
