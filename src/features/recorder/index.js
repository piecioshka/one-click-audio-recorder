// The recorder records one microphone into one file. Both backends share
// this interface:
//
//   refreshDevices(): Promise<Device[]>   also emits "devices"
//   start({ device, format, outputPath }): Promise<void>
//                                          device null = default microphone
//   stop()
//   isRecording: boolean
//   devicePollIntervalMs: number | null
//
// Events: "devices" (Device[]), "change" (isRecording), "finished"
// ({ outputPath }), "error" (message).
const ffmpegStaticPath = require("ffmpeg-static");
const { convertRecording } = require("./audio-encoding");
const interruptedRecordings = require("./interrupted-recordings");

// In packaged builds require("ffmpeg-static") points inside app.asar, which
// the OS cannot execute from. electron-builder unpacks the binary to
// app.asar.unpacked.
const ffmpegPath = ffmpegStaticPath
  ? ffmpegStaticPath.replace(/app\.asar([\\/])/, "app.asar.unpacked$1")
  : null;

const BACKENDS = ["avfoundation", "media-recorder"];

// ffmpeg's AVFoundation input drops whole audio buffers when the microphone
// runs at 96 kHz (e.g. MacBook Pro), losing more than half of the sound, so
// every platform records with MediaRecorder. RECORDER_BACKEND=avfoundation
// still selects the ffmpeg backend on macOS.
const DEFAULT_BACKEND = "media-recorder";

async function createRecorder({
  backend = process.env.RECORDER_BACKEND || DEFAULT_BACKEND,
  tempDir,
}) {
  if (!BACKENDS.includes(backend)) {
    throw new Error(`Unknown recorder backend: ${backend}`);
  }

  if (backend === "avfoundation") {
    const { AvfoundationRecorder } = require("./avfoundation.adapter");
    return new AvfoundationRecorder({ ffmpegPath });
  }

  const { MediaRecorderRecorder } = require("./media-recorder.adapter");
  return new MediaRecorderRecorder({ ffmpegPath, tempDir }).init();
}

// Converts recordings left in tempDir by a run that never finished them.
function recoverInterruptedRecordings({ tempDir, outputDir }) {
  if (!ffmpegPath) {
    return Promise.resolve({ recovered: [], keptRaw: [] });
  }

  return interruptedRecordings.recoverInterruptedRecordings({
    tempDir,
    outputDir,
    convert: (inputPath, outputPath, format) =>
      convertRecording(ffmpegPath, inputPath, outputPath, format),
  });
}

module.exports = {
  createRecorder,
  recoverInterruptedRecordings,
};
