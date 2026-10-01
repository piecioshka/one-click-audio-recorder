const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { AvfoundationRecorder, parseSystemProfilerAudio } = require("./avfoundation.adapter");

const PROFILER_OUTPUT = JSON.stringify({
  SPAudioDataType: [
    {
      _name: "coreaudio_device",
      _items: [
        { _name: "MacBook Pro Microphone", coreaudio_device_input: 1 },
        { _name: "MacBook Pro Speakers", coreaudio_device_output: 2 },
        { _name: "USB Mic", coreaudio_device_input: 2 },
      ],
    },
  ],
});

describe("parseSystemProfilerAudio", () => {
  it("lists input devices only", () => {
    assert.deepEqual(
      parseSystemProfilerAudio(PROFILER_OUTPUT).map((device) => [device.label, device.nativeIndex]),
      [
        ["MacBook Pro Microphone", 0],
        ["USB Mic", 1],
      ]
    );
  });

  it("returns an empty list for unexpected output", () => {
    assert.deepEqual(parseSystemProfilerAudio("not json"), []);
    assert.deepEqual(parseSystemProfilerAudio("{}"), []);
  });
});

function fakeProcess() {
  const child = new EventEmitter();
  child.written = [];
  child.signals = [];
  child.stdin = { destroyed: false, write: (data) => child.written.push(data) };
  child.stderr = new EventEmitter();
  child.kill = (signal) => child.signals.push(signal);
  return child;
}

describe("AvfoundationRecorder", () => {
  let dir;
  let spawned;
  let recorder;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "avfoundation-"));
    spawned = [];
    recorder = new AvfoundationRecorder({
      ffmpegPath: "/bin/ffmpeg",
      spawn: (command, args) => {
        const child = fakeProcess();
        spawned.push({ command, args, child });
        return child;
      },
      execFile: (_command, _args, callback) => callback(null, PROFILER_OUTPUT),
      stopTimeoutMs: 10,
    });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("records the chosen device with the format's encoder", async () => {
    const outputPath = path.join(dir, "out.mp3");
    await recorder.start({
      device: { label: "USB Mic", nativeName: "USB Mic" },
      format: "mp3",
      outputPath,
    });

    const { command, args } = spawned[0];
    assert.equal(command, "/bin/ffmpeg");
    assert.deepEqual(args.slice(0, 9), [
      "-y",
      "-hide_banner",
      "-nostats",
      "-f",
      "avfoundation",
      "-thread_queue_size",
      "4096",
      "-i",
      ":USB Mic",
    ]);
    assert.deepEqual(args.slice(-7, -3), ["-codec:a", "libmp3lame", "-q:a", "2"]);
    assert.equal(args.at(-1), outputPath);
    assert.equal(recorder.isRecording, true);
  });

  // A microphone that disappears mid-recording (e.g. an iPhone over
  // Continuity) leaves ffmpeg blocked on input, so it ignores "q" and gets
  // SIGKILLed. Without per-packet flushing the whole recording is lost.
  it("writes every packet to disk so a killed ffmpeg keeps the audio", async () => {
    const outputPath = path.join(dir, "out.wav");
    await recorder.start({ device: null, format: "wav", outputPath });

    const { args } = spawned[0];
    assert.deepEqual(args.slice(-3), ["-flush_packets", "1", outputPath]);
  });

  it("saves what was recorded when ffmpeg had to be killed", async () => {
    const outputPath = path.join(dir, "out.wav");
    const finished = new Promise((resolve) => recorder.once("finished", resolve));
    await recorder.start({ device: null, format: "wav", outputPath });

    recorder.stop();
    fs.writeFileSync(outputPath, "RIFF");
    spawned[0].child.emit("close", null, "SIGKILL");

    assert.deepEqual(await finished, { outputPath });
  });

  // The first device from system_profiler is not the system default: it can
  // be an iPhone microphone over Continuity that comes and goes.
  it("records the system default microphone when none is chosen", async () => {
    await recorder.start({ device: null, format: "wav", outputPath: path.join(dir, "out.wav") });
    const { args } = spawned[0];
    assert.equal(args[args.indexOf("-i") + 1], ":default");
  });

  it("stops ffmpeg gracefully and reports the saved file", async () => {
    const outputPath = path.join(dir, "out.wav");
    const finished = new Promise((resolve) => recorder.once("finished", resolve));
    await recorder.start({ device: null, format: "wav", outputPath });

    recorder.stop();
    const { child } = spawned[0];
    assert.deepEqual(child.written, ["q\n"]);

    fs.writeFileSync(outputPath, "RIFF");
    child.emit("close", 0, null);

    assert.deepEqual(await finished, { outputPath });
    assert.equal(recorder.isRecording, false);
  });

  it("reports an error when ffmpeg produced no file", async () => {
    const failed = new Promise((resolve) => recorder.once("error", resolve));
    await recorder.start({ device: null, format: "wav", outputPath: path.join(dir, "out.wav") });

    spawned[0].child.emit("close", 1, null);

    assert.match(await failed, /exited \(code=1/);
  });

  it("reports ffmpeg's last messages when it fails", async () => {
    const failed = new Promise((resolve) => recorder.once("error", resolve));
    await recorder.start({ device: null, format: "wav", outputPath: path.join(dir, "out.wav") });

    const { child } = spawned[0];
    child.stderr.emit("data", Buffer.from("noise\r[AVFoundation indev] Audio device not found\n"));
    child.stderr.emit("data", Buffer.from(":Nope Mic: Input/output error\n"));
    child.emit("close", 1, null);

    const message = await failed;
    assert.match(message, /exited \(code=1/);
    assert.match(message, /Audio device not found\n:Nope Mic: Input\/output error$/);
  });

  it("explains a stalled microphone when ffmpeg had to be killed", async () => {
    const failed = new Promise((resolve) => recorder.once("error", resolve));
    await recorder.start({ device: null, format: "wav", outputPath: path.join(dir, "out.wav") });

    recorder.stop();
    spawned[0].child.emit("close", null, "SIGKILL");

    assert.match(await failed, /microphone stopped delivering audio/);
  });

  it("kills ffmpeg when it ignores the stop request", async () => {
    await recorder.start({ device: null, format: "wav", outputPath: path.join(dir, "out.wav") });
    recorder.stop();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(spawned[0].child.signals, ["SIGKILL"]);
  });

  it("ignores a second start while recording", async () => {
    const options = { device: null, format: "wav", outputPath: path.join(dir, "out.wav") };
    await recorder.start(options);
    await recorder.start(options);
    assert.equal(spawned.length, 1);
  });
});
