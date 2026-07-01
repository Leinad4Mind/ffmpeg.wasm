const { FFmpeg } = window.FFmpegWASM;

const genName = (name) => `[ffmpeg][${FFMPEG_TYPE}] ${name}`;

// A single, long-lived FFmpeg instance is reused across all suites. This mirrors
// real-world usage (create/load once, reuse for every operation) and avoids the
// emsdk 6.0.2 pthread-pool leak that surfaces when many instances are created and
// terminated in one page. See the Phase 3 handoff for details.
let ffmpeg;

before(async () => {
  ffmpeg = new FFmpeg();
  await ffmpeg.load({
    coreURL: CORE_URL,
    thread: FFMPEG_TYPE === "mt",
  });
  await ffmpeg.writeFile("video.mp4", b64ToUint8Array(VIDEO_1S_MP4));
});

after(() => {
  if (ffmpeg) ffmpeg.terminate();
});

describe(genName("new FFmpeg()"), () => {
  it("should be OK", () => {
    expect(new FFmpeg()).to.be.ok;
  });
});

describe(
  genName(
    "FFmpeg directory APIs (createDir(), listDir(), deleteDir(), rename())"
  ),
  function () {
    it("should list root dir", async () => {
      const files = await ffmpeg.listDir("/");
      expect(files.length).to.be.greaterThan(0);
    });

    it("should expose OPFS helpers", () => {
      expect(ffmpeg.mountOPFS).to.be.a("function");
      expect(ffmpeg.mkdirp).to.be.a("function");
      expect(ffmpeg.writeFileOPFS).to.be.a("function");
      expect(ffmpeg.fileSize).to.be.a("function");
      expect(ffmpeg.readFileChunk).to.be.a("function");
    });
    it("should create a dir", async () => {
      await ffmpeg.createDir("/dir1");
      const files = await ffmpeg.listDir("/");
      expect(files.map(({ name }) => name)).to.include("dir1");
    });

    it("should delete a dir", async () => {
      await ffmpeg.createDir("/dir2");
      await ffmpeg.deleteDir("/dir2");
      const files = await ffmpeg.listDir("/");
      expect(files.map(({ name }) => name)).to.not.include("dir2");
    });

    it("should rename a dir", async () => {
      await ffmpeg.createDir("/dir3");
      await ffmpeg.rename("/dir3", "/dir4");
      const files = await ffmpeg.listDir("/");
      expect(files.map(({ name }) => name)).to.not.include("dir3");
      expect(files.map(({ name }) => name)).to.include("dir4");
    });
  }
);

describe(
  genName(
    "FFmpeg files APIs (readFile(), writeFile(), deleteFile(), rename())"
  ),
  function () {
    it("should write/read a text file", async () => {
      const text = "foo";
      await ffmpeg.writeFile("/file1", text);
      const data = await ffmpeg.readFile("/file1", "utf8");
      const files = await ffmpeg.listDir("/");
      expect(files.map(({ name }) => name)).to.include("file1");
      expect(data).to.equal(text);
    });

    it("should write a binary file", async () => {
      const bin = [1, 2, 3];
      await ffmpeg.writeFile("/file2", Uint8Array.from(bin));
      const data = await ffmpeg.readFile("/file2");
      const files = await ffmpeg.listDir("/");
      expect(files.map(({ name }) => name)).to.include("file2");
      expect(data).to.deep.equal(Uint8Array.from(bin));
    });
  }
);

describe(genName("FFmpeg.exec()"), function () {
  it("should output help with exit code 0", async () => {
    let m;
    const listener = ({ message }) => {
      m = message;
    };
    ffmpeg.on("log", listener);
    const ret = await ffmpeg.exec(["-h"]);
    expect(ret).to.equal(0);
    expect(m).to.be.a("string");
    ffmpeg.off("log", listener);
  });

  it("should transcode mp4 to avi", async () => {
    let p;
    const listener = ({ progress }) => {
      p = progress;
    };
    ffmpeg.on("progress", listener);
    const ret = await ffmpeg.exec(["-i", "video.mp4", "video.avi"]);
    expect(ret).to.equal(0);
    expect(p).to.equal(1);
    ffmpeg.off("progress", listener);
  });

  it("should stop if timeout", async () => {
    const ret = await ffmpeg.exec(["-i", "video.mp4", "video2.avi"], 1);
    expect(ret).to.equal(1);
  });

  it("should abort", () => {
    const controller = new AbortController();
    const { signal } = controller;

    const promise = ffmpeg.exec(["-i", "video.mp4", "video3.avi"], undefined, {
      signal,
    });
    controller.abort();

    return promise.catch((err) => {
      expect(err.name).to.equal("AbortError");
    });
  });
});

// Clip-editor operations: lossless cut + concat (the browser-side workload).
// NOTE: multi-input filtergraphs (xfade transitions, concat filter, overlay)
// deadlock on the MT 7.x core in wasm and must run server-side — see the
// Phase 3 handoff. Only stream-copy stitching is exercised here.
describe(genName("FFmpeg clip operations"), function () {
  it("should losslessly cut a segment (-ss/-t -c copy)", async () => {
    const ret = await ffmpeg.exec([
      "-ss", "0", "-i", "video.mp4", "-t", "0.5", "-c", "copy", "cut.mp4",
    ]);
    expect(ret).to.equal(0);
    const out = await ffmpeg.readFile("cut.mp4");
    expect(out.length).to.be.greaterThan(0);
  });

  it("should losslessly concat clips (-f concat -c copy)", async () => {
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
});
