const EXPORTED_FUNCTIONS = [
  "_ffmpeg",
  "_abort",
  "_malloc",
  "_free",
  "_ffprobe",
  "_ffwasm_mount_opfs",
  "_ffwasm_mkdirp",
  "_ffwasm_write_file",
  "_ffwasm_file_size",
  "_ffwasm_read_file_chunk",
];

console.log(EXPORTED_FUNCTIONS.join(","));
