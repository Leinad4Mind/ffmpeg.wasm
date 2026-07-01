# syntax=docker/dockerfile-upstream:master-labs

# Base emsdk image with environment variables.
# Pinned to emscripten/emsdk:latest by manifest-list digest = Emscripten 6.0.2.
# Rationale: only the `latest` tag is multi-arch (arm64+amd64); every versioned
# emsdk tag is amd64-only, which forced slow, OOM-prone x86 emulation on Apple
# Silicon. Pinning the list digest keeps builds reproducible AND native per-arch.
FROM emscripten/emsdk@sha256:644883f58ca15c38c8be59b3a727ba0eff347729bc31d50a3348a6c9ed92bc07 AS emsdk-base
ARG EXTRA_CFLAGS
ARG EXTRA_LDFLAGS
ARG FFMPEG_ST
ARG FFMPEG_MT
ARG FFMPEG_VARIANT=full
ENV INSTALL_DIR=/opt
ENV FFMPEG_VERSION=n8.1.2
ENV CFLAGS="-I$INSTALL_DIR/include $CFLAGS $EXTRA_CFLAGS"
ENV CXXFLAGS="$CFLAGS"
ENV LDFLAGS="-L$INSTALL_DIR/lib $LDFLAGS $CFLAGS $EXTRA_LDFLAGS"
ENV EM_PKG_CONFIG_PATH=$EM_PKG_CONFIG_PATH:$INSTALL_DIR/lib/pkgconfig:/emsdk/upstream/emscripten/system/lib/pkgconfig
ENV EM_TOOLCHAIN_FILE=$EMSDK/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake
ENV PKG_CONFIG_PATH=$PKG_CONFIG_PATH:$EM_PKG_CONFIG_PATH
ENV FFMPEG_ST=$FFMPEG_ST
ENV FFMPEG_MT=$FFMPEG_MT
ENV FFMPEG_VARIANT=$FFMPEG_VARIANT
RUN apt-get update && \
      apt-get install -y pkg-config autoconf automake libtool ragel

# Build x264
FROM emsdk-base AS x264-builder
# Pinned to the 4-cores branch HEAD by commit SHA (was a floating branch).
ENV X264_REF=33cac6b77d5b9259c552156013a817ab23119612
ADD https://github.com/ffmpegwasm/x264.git#$X264_REF /src
COPY build/x264.sh /src/build.sh
RUN bash -x /src/build.sh

# Build libvpx
FROM emsdk-base AS libvpx-builder
ENV LIBVPX_BRANCH=v1.13.1
ADD https://github.com/ffmpegwasm/libvpx.git#$LIBVPX_BRANCH /src
COPY build/libvpx.sh /src/build.sh
RUN bash -x /src/build.sh

# Build lame
FROM emsdk-base AS lame-builder
# Pinned to master HEAD by commit SHA (was a floating branch).
ENV LAME_REF=2badea1974ae36cb8312afe99cff1e6b3b5decee
ADD https://github.com/ffmpegwasm/lame.git#$LAME_REF /src
COPY build/lame.sh /src/build.sh
RUN bash -x /src/build.sh

# Build opus
FROM emsdk-base AS opus-builder
ENV OPUS_BRANCH=v1.3.1
ADD https://github.com/ffmpegwasm/opus.git#$OPUS_BRANCH /src
COPY build/opus.sh /src/build.sh
RUN bash -x /src/build.sh

# Build zlib
FROM emsdk-base AS zlib-builder
# zlib 1.3.1 from upstream (fixes CVE-2018-25032, CVE-2022-37434). The
# ffmpegwasm fork has no 1.3.1 tag; pinned to the v1.3.1 commit SHA.
ENV ZLIB_REF=925af44f3cde53c6b076611c297850091b5dc7bb
ADD https://github.com/madler/zlib.git#$ZLIB_REF /src
COPY build/zlib.sh /src/build.sh
RUN bash -x /src/build.sh

# Build libwebp
FROM emsdk-base AS libwebp-builder
COPY --from=zlib-builder $INSTALL_DIR $INSTALL_DIR
ENV LIBWEBP_BRANCH=v1.3.2
ADD https://github.com/ffmpegwasm/libwebp.git#$LIBWEBP_BRANCH /src
COPY build/libwebp.sh /src/build.sh
RUN bash -x /src/build.sh

# Build zimg
FROM emsdk-base AS zimg-builder
ENV ZIMG_BRANCH=release-3.0.5
RUN apt-get update && apt-get install -y git
RUN git clone --recursive -b $ZIMG_BRANCH https://github.com/sekrit-twc/zimg.git /src
COPY build/zimg.sh /src/build.sh
RUN bash -x /src/build.sh

# Base ffmpeg image with dependencies and source code populated.
FROM emsdk-base AS ffmpeg-base
RUN embuilder build sdl2 sdl2-mt
ADD https://github.com/FFmpeg/FFmpeg.git#$FFMPEG_VERSION /src
COPY --from=x264-builder $INSTALL_DIR $INSTALL_DIR
COPY --from=libvpx-builder $INSTALL_DIR $INSTALL_DIR
COPY --from=lame-builder $INSTALL_DIR $INSTALL_DIR
COPY --from=opus-builder $INSTALL_DIR $INSTALL_DIR
COPY --from=libwebp-builder $INSTALL_DIR $INSTALL_DIR
COPY --from=zimg-builder $INSTALL_DIR $INSTALL_DIR

# Build ffmpeg
FROM ffmpeg-base AS ffmpeg-builder
COPY build/ffmpeg.sh /src/build.sh
# Codec --enable flags are selected inside build.sh by $FFMPEG_VARIANT.
RUN bash -x /src/build.sh

# Build ffmpeg.wasm
FROM ffmpeg-builder AS ffmpeg-wasm-builder
COPY src/bind /src/src/bind
COPY src/fftools /src/src/fftools
COPY build/ffmpeg-wasm.sh build.sh
COPY scripts/patch-opfs-async-access.js scripts/patch-opfs-async-access.js
# Codec link libs are selected inside build.sh by $FFMPEG_VARIANT.
RUN mkdir -p /src/dist/umd && bash -x /src/build.sh \
      -o dist/umd/ffmpeg-core.js \
    && node scripts/patch-opfs-async-access.js dist/umd/ffmpeg-core.js
RUN mkdir -p /src/dist/esm && bash -x /src/build.sh \
      -sEXPORT_ES6 \
      -o dist/esm/ffmpeg-core.js \
    && node scripts/patch-opfs-async-access.js dist/esm/ffmpeg-core.js

# Export ffmpeg-core.wasm to dist/, use `docker buildx build -o . .` to get assets
FROM scratch AS exportor
COPY --from=ffmpeg-wasm-builder /src/dist /dist
