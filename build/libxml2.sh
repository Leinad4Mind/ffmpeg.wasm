#!/bin/bash
set -euo pipefail

cd /src

NOCONFIGURE=1 ./autogen.sh
LIBXML_CFLAGS="$CFLAGS -Wno-error=int-to-pointer-cast -Wno-error=pointer-to-int-cast"
CFLAGS="$LIBXML_CFLAGS" \
CXXFLAGS="$LIBXML_CFLAGS" \
emconfigure ./configure \
  --prefix="$INSTALL_DIR" \
  --host=x86_64-unknown-linux-gnu \
  --disable-shared \
  --enable-static \
  --without-python \
  --without-lzma \
  --without-iconv \
  --without-zlib \
  --without-http \
  --without-ftp \
  --without-threads \
  --without-modules \
  --without-debug \
  --with-tree \
  --with-reader \
  --with-xpath \
  --with-output

emmake make -j$(nproc)
emmake make install

test -f "$INSTALL_DIR/lib/pkgconfig/libxml-2.0.pc" \
  || { echo "ERROR: libxml-2.0.pc missing - ffmpeg will silently disable libxml2"; exit 1; }
echo "libxml-2.0.pc installed at $INSTALL_DIR/lib/pkgconfig/" >&2