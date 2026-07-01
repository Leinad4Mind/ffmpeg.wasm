export const CORE_VERSION = "0.1.0";

export const CORE_URL = `https://cdn.jsdelivr.net/npm/@ffmpeg-wasm-browser/core@${CORE_VERSION}/dist/umd/ffmpeg-core.js`;
export const CORE_MT_URL = `https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@${CORE_VERSION}/dist/umd/ffmpeg-core.js`;

export const CORE_SIZE = {
  [`https://cdn.jsdelivr.net/npm/@ffmpeg-wasm-browser/core@${CORE_VERSION}/dist/umd/ffmpeg-core.js`]: 114673,
  [`https://cdn.jsdelivr.net/npm/@ffmpeg-wasm-browser/core@${CORE_VERSION}/dist/umd/ffmpeg-core.wasm`]: 32129114,
  [`https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@${CORE_VERSION}/dist/umd/ffmpeg-core.js`]: 132680,
  [`https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@${CORE_VERSION}/dist/umd/ffmpeg-core.wasm`]: 32609891,
  [`https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@${CORE_VERSION}/dist/umd/ffmpeg-core.worker.js`]: 2915,
};

export const SAMPLE_FILES = {
  "video.webm":
    "https://raw.githubusercontent.com/ffmpegwasm/testdata/master/Big_Buck_Bunny_180_10s.webm",
};
