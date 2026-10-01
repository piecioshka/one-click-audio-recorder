const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  tempPathFor,
  findInterruptedRecordings,
  recoverInterruptedRecordings,
} = require("./interrupted-recordings");

describe("interrupted recordings", () => {
  let dir;
  let tempDir;
  let outputDir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "interrupted-recordings-"));
    tempDir = path.join(dir, "temp");
    outputDir = path.join(dir, "out");
    fs.mkdirSync(tempDir);
    fs.mkdirSync(outputDir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeTemp(name, content = "webm-data") {
    const filePath = path.join(tempDir, name);
    fs.writeFileSync(filePath, content);
    return filePath;
  }

  function fakeConvert({ fail = false } = {}) {
    const calls = [];
    const convert = async (inputPath, outputPath, format) => {
      calls.push({ inputPath, outputPath, format });

      if (fail) {
        throw new Error("ffmpeg failed");
      }

      fs.writeFileSync(outputPath, `converted:${format}`);
    };
    return { calls, convert };
  }

  describe("tempPathFor", () => {
    it("names the temp file after the output file", () => {
      assert.equal(
        tempPathFor("/tmp", "/out/audio-recording-1.mp3"),
        path.join("/tmp", "audio-recording-1.mp3.webm")
      );
    });
  });

  describe("findInterruptedRecordings", () => {
    it("finds only temp files of this app", () => {
      writeTemp("audio-recording-2026-10-01T10-00-00-000Z.wav.webm");
      writeTemp("audio-recording-2026-10-01T11-00-00-000Z.mp3.webm");
      writeTemp("audio-recording-2026-10-01T12-00-00-000Z.ogg.webm");
      writeTemp("something-else.wav.webm");
      writeTemp("audio-recording-2026-10-01T13-00-00-000Z.wav");

      const found = findInterruptedRecordings(tempDir).map(({ fileName, format }) => ({
        fileName,
        format,
      }));

      assert.deepEqual(found, [
        { fileName: "audio-recording-2026-10-01T10-00-00-000Z.wav", format: "wav" },
        { fileName: "audio-recording-2026-10-01T11-00-00-000Z.mp3", format: "mp3" },
      ]);
    });

    it("returns nothing when the temp folder is missing", () => {
      assert.deepEqual(findInterruptedRecordings(path.join(dir, "missing")), []);
    });
  });

  describe("recoverInterruptedRecordings", () => {
    it("converts a leftover recording into the output folder and removes the temp file", async () => {
      const tempPath = writeTemp("audio-recording-a.mp3.webm");
      const { calls, convert } = fakeConvert();

      const result = await recoverInterruptedRecordings({ tempDir, outputDir, convert });

      const outputPath = path.join(outputDir, "audio-recording-a.mp3");
      assert.deepEqual(calls, [{ inputPath: tempPath, outputPath, format: "mp3" }]);
      assert.deepEqual(result, { recovered: [outputPath], keptRaw: [] });
      assert.equal(fs.readFileSync(outputPath, "utf8"), "converted:mp3");
      assert.equal(fs.existsSync(tempPath), false);
    });

    it("keeps the raw WebM in the output folder when conversion fails", async () => {
      const tempPath = writeTemp("audio-recording-b.wav.webm", "raw-audio");
      const { convert } = fakeConvert({ fail: true });

      const result = await recoverInterruptedRecordings({ tempDir, outputDir, convert });

      const rawPath = path.join(outputDir, "audio-recording-b.wav.webm");
      assert.deepEqual(result, { recovered: [], keptRaw: [rawPath] });
      assert.equal(fs.readFileSync(rawPath, "utf8"), "raw-audio");
      assert.equal(fs.existsSync(tempPath), false);
      assert.equal(fs.existsSync(path.join(outputDir, "audio-recording-b.wav")), false);
    });

    it("deletes empty leftovers without converting them", async () => {
      const tempPath = writeTemp("audio-recording-c.wav.webm", "");
      const { calls, convert } = fakeConvert();

      const result = await recoverInterruptedRecordings({ tempDir, outputDir, convert });

      assert.deepEqual(calls, []);
      assert.deepEqual(result, { recovered: [], keptRaw: [] });
      assert.equal(fs.existsSync(tempPath), false);
    });

    it("does not overwrite a recording that already exists", async () => {
      const tempPath = writeTemp("audio-recording-d.wav.webm");
      const outputPath = path.join(outputDir, "audio-recording-d.wav");
      fs.writeFileSync(outputPath, "already-saved");
      const { calls, convert } = fakeConvert();

      const result = await recoverInterruptedRecordings({ tempDir, outputDir, convert });

      assert.deepEqual(calls, []);
      assert.deepEqual(result, { recovered: [], keptRaw: [] });
      assert.equal(fs.readFileSync(outputPath, "utf8"), "already-saved");
      assert.equal(fs.existsSync(tempPath), false);
    });
  });
});
