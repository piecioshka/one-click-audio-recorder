const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { stopAndWait } = require("./stop-and-wait");

function fakeRecorder({ isRecording = true, onStop = () => {} } = {}) {
  const recorder = new EventEmitter();
  recorder.isRecording = isRecording;
  recorder.stopCalls = 0;
  recorder.stop = () => {
    recorder.stopCalls += 1;
    onStop(recorder);
  };
  return recorder;
}

describe("stopAndWait", () => {
  it("resolves right away when nothing is being recorded", async () => {
    const recorder = fakeRecorder({ isRecording: false });

    assert.equal(await stopAndWait(recorder, 1000), "idle");
    assert.equal(recorder.stopCalls, 0);
  });

  it("stops the recording and waits until it is saved", async () => {
    const recorder = fakeRecorder({
      onStop: (self) => setImmediate(() => self.emit("finished", { outputPath: "/out/a.wav" })),
    });

    assert.equal(await stopAndWait(recorder, 1000), "saved");
    assert.equal(recorder.stopCalls, 1);
    assert.equal(recorder.listenerCount("finished"), 0);
    assert.equal(recorder.listenerCount("error"), 0);
  });

  it("resolves when saving fails", async () => {
    const recorder = fakeRecorder({
      onStop: (self) => setImmediate(() => self.emit("error", "Cannot save recording")),
    });

    assert.equal(await stopAndWait(recorder, 1000), "failed");
  });

  it("gives up after the timeout", async () => {
    const recorder = fakeRecorder();

    assert.equal(await stopAndWait(recorder, 10), "timeout");
    assert.equal(recorder.listenerCount("finished"), 0);
  });
});
