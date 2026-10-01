const childProcess = require("child_process");

// ffmpeg output options for each output format. Both recorder backends use
// them, so a "wav" recording is the same kind of file on every platform.
const ENCODE_ARGS = {
  wav: ["-codec:a", "pcm_s16le"],
  mp3: ["-codec:a", "libmp3lame", "-q:a", "2"],
};

function encodeArgs(format) {
  const args = ENCODE_ARGS[format];

  if (!args) {
    throw new Error(`Unsupported output format: ${format}`);
  }

  return [...args];
}

function recordingFileName(format, date = new Date()) {
  const timestamp = date.toISOString().replace(/[:.]/g, "-");
  return `audio-recording-${timestamp}.${format}`;
}

// Converts any audio file ffmpeg can read into the output format.
function convertRecording(ffmpegPath, inputPath, outputPath, format) {
  const args = ["-y", "-i", inputPath, "-vn", ...encodeArgs(format), outputPath];

  return new Promise((resolve, reject) => {
    childProcess.execFile(ffmpegPath, args, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

module.exports = {
  convertRecording,
  encodeArgs,
  recordingFileName,
};
