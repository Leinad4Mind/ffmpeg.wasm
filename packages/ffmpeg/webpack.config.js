const path = require("path");

module.exports = {
  mode: "production",
  devtool: "source-map",
  entry: {
    ffmpeg: "./dist/esm/index.js",
    "ffmpeg-no-worker": "./dist/esm/no-worker.js",
  },
  resolve: {
    extensions: [".js"],
  },
  output: {
    path: path.resolve(__dirname, "dist/umd"),
    filename: "[name].js",
    library: "FFmpegWASM",
    libraryTarget: "umd",
  },
  stats: {
    warnings:false
  }
};
