// Slim-variant test suite. The slim core is built with `--disable-everything`
// plus an allowlist tuned to live-clipping-poc's real pipeline, so it CANNOT run
// the generic `ffmpeg.test.js` (e.g. its mp4->avi transcode needs the avi muxer /
// mpeg4 encoder, which slim deliberately drops). This suite exercises only the
// operations slim is meant to support, all of which are single-input pipelines:
//   - stream-copy cut and concat (the current browser workload)
//   - single-input libx264/AAC re-encode
//   - re-encode stitch via the concat DEMUXER (multiple clips in, one out)
//
// NOT covered on purpose: multi-input filtergraphs (overlay watermark, xfade
// softened transitions, concat FILTER). Those deadlock on the MT wasm core and
// run server-side — see FORK.md. Keeping them out of the browser build is why
// slim is ~6 MB instead of ~25 MB.
const { FFmpeg } = window.FFmpegWASM;

const genName = (name) => `[ffmpeg][slim] ${name}`;

let ffmpeg;

before(async () => {
  ffmpeg = new FFmpeg();
  await ffmpeg.load({ coreURL: CORE_URL, thread: true });
  await ffmpeg.writeFile("video.mp4", b64ToUint8Array(VIDEO_1S_MP4));
});

after(() => {
  if (ffmpeg) ffmpeg.terminate();
});

describe(genName("core loads"), () => {
  it("should be OK", () => {
    expect(ffmpeg).to.be.ok;
  });
});

describe(genName("app operations"), function () {
  it("copy: lossless cut (-ss/-t -c copy)", async () => {
    const ret = await ffmpeg.exec([
      "-ss", "0", "-i", "video.mp4", "-t", "0.5", "-c", "copy", "cut.mp4",
    ]);
    expect(ret).to.equal(0);
    const out = await ffmpeg.readFile("cut.mp4");
    expect(out.length).to.be.greaterThan(0);
  });

  it("copy: lossless concat (-f concat -c copy)", async () => {
    await ffmpeg.writeFile("clipA.mp4", b64ToUint8Array(VIDEO_1S_MP4));
    await ffmpeg.writeFile("clipB.mp4", b64ToUint8Array(VIDEO_1S_MP4));
    await ffmpeg.writeFile("concat.txt", "file 'clipA.mp4'\nfile 'clipB.mp4'\n");
    const ret = await ffmpeg.exec([
      "-f", "concat", "-safe", "0", "-i", "concat.txt", "-c", "copy", "joined.mp4",
    ]);
    expect(ret).to.equal(0);
    const joined = await ffmpeg.readFile("joined.mp4");
    const single = await ffmpeg.readFile("clipA.mp4");
    expect(joined.length).to.be.greaterThan(single.length);
  });

  it("re-encode: single input (libx264 + aac)", async () => {
    const ret = await ffmpeg.exec([
      "-i", "video.mp4", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "reenc.mp4",
    ]);
    expect(ret).to.equal(0);
    const out = await ffmpeg.readFile("reenc.mp4");
    expect(out.length).to.be.greaterThan(0);
  });

  it("re-encode stitch: concat demuxer -> libx264/aac (multi-clip in, one out)", async () => {
    await ffmpeg.writeFile("sA.mp4", b64ToUint8Array(VIDEO_1S_MP4));
    await ffmpeg.writeFile("sB.mp4", b64ToUint8Array(VIDEO_1S_MP4));
    await ffmpeg.writeFile("slist.txt", "file 'sA.mp4'\nfile 'sB.mp4'\n");
    const ret = await ffmpeg.exec([
      "-f", "concat", "-safe", "0", "-i", "slist.txt",
      "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "stitched.mp4",
    ]);
    expect(ret).to.equal(0);
    const out = await ffmpeg.readFile("stitched.mp4");
    expect(out.length).to.be.greaterThan(0);
  });
});
