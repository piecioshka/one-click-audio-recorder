// macOS backend: ffmpeg records straight from AVFoundation, no window needed.
const fs = require("fs");
const childProcess = require("child_process");
const { EventEmitter } = require("events");
const { encodeArgs } = require("./audio-encoding");

function parseSystemProfilerAudio(stdout) {
  try {
    const parsed = JSON.parse(String(stdout || "{}"));
    const sections = Array.isArray(parsed.SPAudioDataType) ? parsed.SPAudioDataType : [];
    const root =
      sections.find((item) => item && item._name === "coreaudio_device") || sections[0] || {};
    const items = Array.isArray(root._items) ? root._items : [];

    return items
      .filter((item) => Number(item.coreaudio_device_input || 0) > 0)
      .map((item) => String(item._name || "").trim())
      .filter((label) => label.length > 0)
      .map((label, index) => ({ label, nativeName: label, nativeIndex: index }));
  } catch (_error) {
    return [];
  }
}

// Keeps the last lines ffmpeg wrote to stderr, for logs and error messages.
function createOutputTail(limit = 20) {
  const lines = [];
  let partial = "";

  return {
    push(chunk) {
      const parts = (partial + String(chunk)).split(/\r\n|\r|\n/);
      partial = parts.pop();
      lines.push(...parts.map((line) => line.trim()).filter(Boolean));
      lines.splice(0, Math.max(0, lines.length - limit));
    },
    lines(count = limit) {
      const all = partial.trim() ? [...lines, partial.trim()] : lines;
      return all.slice(-count);
    },
  };
}

function withOutput(message, tail) {
  const lines = tail.lines(3);
  return lines.length > 0 ? `${message}\n\nffmpeg:\n${lines.join("\n")}` : message;
}

function fileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch (_error) {
    return 0;
  }
}

class AvfoundationRecorder extends EventEmitter {
  // system_profiler takes about a second, so devices are listed on demand
  // (tray menu opened) instead of polled.
  devicePollIntervalMs = null;

  #ffmpegPath;
  #spawn;
  #execFile;
  #stopTimeoutMs;
  #devices = [];
  #process = null;
  #stopping = false;

  constructor({
    ffmpegPath,
    spawn = childProcess.spawn,
    execFile = childProcess.execFile,
    stopTimeoutMs = 2500,
  }) {
    super();
    this.#ffmpegPath = ffmpegPath;
    this.#spawn = spawn;
    this.#execFile = execFile;
    this.#stopTimeoutMs = stopTimeoutMs;
  }

  get isRecording() {
    return this.#process !== null;
  }

  refreshDevices() {
    return new Promise((resolve) => {
      this.#execFile("system_profiler", ["SPAudioDataType", "-json"], (error, stdout) => {
        this.#devices = error ? [] : parseSystemProfilerAudio(stdout);
        this.emit("devices", this.#devices);
        resolve(this.#devices);
      });
    });
  }

  async start({ device, format, outputPath }) {
    if (this.#process) {
      return;
    }

    if (!this.#ffmpegPath) {
      throw new Error("ffmpeg binary is unavailable");
    }

    // "default" makes AVFoundation pick the system default input, which the
    // first entry from system_profiler is not guaranteed to be.
    const inputName = device ? (device.nativeName || device.label || "").trim() : "default";

    if (!inputName) {
      throw new Error("No selectable microphone found.");
    }

    const args = [
      "-y",
      "-hide_banner",
      "-nostats",
      "-f",
      "avfoundation",
      "-thread_queue_size",
      "4096",
      "-i",
      `:${inputName}`,
      "-vn",
      ...encodeArgs(format),
      // ffmpeg ignores "q" while its input is stalled (e.g. the microphone
      // disappeared) and has to be killed; flushing each packet keeps what
      // was recorded so far on disk.
      "-flush_packets",
      "1",
      outputPath,
    ];

    console.info(`[recorder][start] microphone=${inputName} format=${format}`);

    const child = this.#spawn(this.#ffmpegPath, args, { stdio: ["pipe", "ignore", "pipe"] });
    const output = createOutputTail();
    const startedAt = Date.now();
    this.#process = child;
    this.#stopping = false;
    this.emit("change", true);

    // stderr must be drained, otherwise ffmpeg blocks once the pipe is full.
    child.stderr?.on("data", (chunk) => output.push(chunk));

    child.on("error", (error) => {
      console.error("ffmpeg process error:", error);
    });

    child.on("close", (code, signal) => {
      const wasStopping = this.#stopping;
      const size = fileSize(outputPath);
      const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);

      this.#process = null;
      this.#stopping = false;
      this.emit("change", false);

      console.info(
        `[recorder][finish] elapsed=${elapsedSec}s bytes=${size} code=${code} signal=${signal || "none"}`
      );

      if (size > 0 && code === 0) {
        this.emit("finished", { outputPath });
        return;
      }

      const lines = output.lines();

      if (lines.length > 0) {
        console.warn(`[recorder][ffmpeg]\n${lines.join("\n")}`);
      }

      if (size > 0) {
        this.emit("finished", { outputPath });
      } else if (wasStopping && signal === "SIGKILL") {
        this.emit(
          "error",
          withOutput(
            "The microphone stopped delivering audio (was it disconnected?), so nothing was recorded.",
            output
          )
        );
      } else if (wasStopping) {
        this.emit(
          "error",
          withOutput("Recording was stopped, but no output file was produced.", output)
        );
      } else {
        this.emit(
          "error",
          withOutput(`Recorder exited (code=${code}, signal=${signal || "none"}).`, output)
        );
      }
    });
  }

  stop() {
    const child = this.#process;

    if (!child) {
      return;
    }

    this.#stopping = true;

    // "q" on stdin lets ffmpeg finalize the file header.
    try {
      if (child.stdin && !child.stdin.destroyed) {
        child.stdin.write("q\n");
      } else {
        child.kill("SIGINT");
      }
    } catch (_error) {
      // The close handler reports the final state.
    }

    setTimeout(() => {
      if (this.#process === child) {
        child.kill("SIGKILL");
      }
    }, this.#stopTimeoutMs);
  }
}

module.exports = {
  AvfoundationRecorder,
  parseSystemProfilerAudio,
};
