const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { encodeArgs, recordingFileName } = require("./audio-encoding");
const { OUTPUT_FORMATS } = require("../settings-store");

describe("encodeArgs", () => {
  it("supports every output format offered in settings", () => {
    for (const format of OUTPUT_FORMATS) {
      assert.ok(encodeArgs(format).length > 0, format);
    }
  });

  it("encodes wav as 16-bit PCM and mp3 with LAME", () => {
    assert.deepEqual(encodeArgs("wav"), ["-codec:a", "pcm_s16le"]);
    assert.deepEqual(encodeArgs("mp3"), ["-codec:a", "libmp3lame", "-q:a", "2"]);
  });

  it("rejects unknown formats", () => {
    assert.throws(() => encodeArgs("ogg"), /Unsupported output format/);
  });
});

describe("recordingFileName", () => {
  it("builds a file-system safe name from the date", () => {
    const date = new Date("2026-09-29T14:05:06.789Z");
    assert.equal(recordingFileName("mp3", date), "audio-recording-2026-09-29T14-05-06-789Z.mp3");
  });
});
