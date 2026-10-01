// Default backend: a hidden window records with MediaRecorder, streams the
// chunks to a temp WebM file, then ffmpeg converts it to the output format.
const fs = require("fs");
const { EventEmitter } = require("events");
const { ipcMain } = require("electron");
const { convertRecording } = require("./audio-encoding");
const { tempPathFor } = require("./interrupted-recordings");
const { createMediaRecorderWindow } = require("./media-recorder.window");

const DEVICE_LIST_TIMEOUT_MS = 5000;

function closeFile(file) {
  if (!file) {
    return Promise.reject(new Error("no audio was received"));
  }

  return new Promise((resolve, reject) => {
    file.once("error", reject);
    file.end(resolve);
  });
}

async function discard(recording) {
  await closeFile(recording.file).catch(() => {});
  await fs.promises.unlink(recording.tempPath).catch(() => {});
}

class MediaRecorderRecorder extends EventEmitter {
  // Chromium does not announce device changes to a hidden window reliably.
  devicePollIntervalMs = 10000;

  #ffmpegPath;
  #tempDir;
  #window = null;
  #devices = [];
  #deviceWaiters = [];
  #pendingStart = null;
  #recording = null;

  constructor({ ffmpegPath, tempDir }) {
    super();
    this.#ffmpegPath = ffmpegPath;
    this.#tempDir = tempDir;
  }

  async init() {
    this.#window = await createMediaRecorderWindow();
    ipcMain.removeAllListeners("recorder:status");
    ipcMain.on("recorder:status", (_event, message) => {
      void this.#handleStatus(message.type, message.payload || {});
    });
    return this;
  }

  get isRecording() {
    return this.#recording !== null && this.#recording.started;
  }

  refreshDevices() {
    if (!this.#send("list-devices")) {
      return Promise.resolve(this.#devices);
    }

    return new Promise((resolve) => {
      const waiter = (devices) => {
        clearTimeout(timer);
        resolve(devices);
      };
      const timer = setTimeout(() => {
        this.#deviceWaiters = this.#deviceWaiters.filter((item) => item !== waiter);
        resolve(this.#devices);
      }, DEVICE_LIST_TIMEOUT_MS);

      this.#deviceWaiters.push(waiter);
    });
  }

  start({ device, format, outputPath }) {
    if (this.#recording) {
      return Promise.resolve();
    }

    if (!this.#ffmpegPath) {
      return Promise.reject(new Error("ffmpeg binary is unavailable"));
    }

    return new Promise((resolve, reject) => {
      this.#recording = {
        format,
        outputPath,
        started: false,
        tempPath: tempPathFor(this.#tempDir, outputPath),
        file: null,
      };
      this.#pendingStart = { resolve, reject };

      const sent = this.#send("start-recording", {
        deviceId: device ? device.deviceId || null : null,
        groupId: device ? device.groupId || null : null,
      });

      if (!sent) {
        this.#failStart("Recorder window is unavailable.");
      }
    });
  }

  stop() {
    if (this.#recording) {
      this.#send("stop-recording");
    }
  }

  #send(command, payload) {
    if (!this.#window || this.#window.isDestroyed()) {
      return false;
    }

    this.#window.webContents.send("recorder:command", command, payload);
    return true;
  }

  #failStart(message) {
    const pending = this.#pendingStart;
    this.#pendingStart = null;
    this.#recording = null;

    if (pending) {
      pending.reject(new Error(message));
    }
  }

  async #handleStatus(type, payload) {
    if (type === "devices-list") {
      this.#devices = payload.devices || [];
      const waiters = this.#deviceWaiters;
      this.#deviceWaiters = [];
      waiters.forEach((waiter) => waiter(this.#devices));
      this.emit("devices", this.#devices);
      return;
    }

    if (type === "recording-started") {
      if (this.#recording) {
        this.#recording.started = true;
        this.#recording.file = fs.createWriteStream(this.#recording.tempPath);
        this.#recording.file.on("error", (error) => {
          console.error("Cannot write recording chunk:", error);
        });
      }

      const pending = this.#pendingStart;
      this.#pendingStart = null;
      this.emit("change", true);

      if (pending) {
        pending.resolve();
      }

      return;
    }

    if (type === "recording-error") {
      const message = payload.message || "Unknown recording error";

      if (this.#pendingStart) {
        this.#failStart(message);
        return;
      }

      const wasRecording = this.isRecording;
      const recording = this.#recording;
      this.#recording = null;

      if (recording) {
        await discard(recording);
      }

      if (wasRecording) {
        this.emit("change", false);
      }

      this.emit("error", message);
      return;
    }

    if (type === "recording-chunk") {
      this.#recording?.file?.write(Buffer.from(payload.arrayBuffer));
      return;
    }

    if (type === "recording-stopped") {
      const recording = this.#recording;
      this.#recording = null;
      this.emit("change", false);

      if (!recording) {
        return;
      }

      try {
        await this.#persist(recording);
        this.emit("finished", { outputPath: recording.outputPath });
      } catch (error) {
        this.emit("error", `Cannot save recording: ${error.message}`);
      }
    }
  }

  async #persist(recording) {
    await closeFile(recording.file);

    try {
      await convertRecording(
        this.#ffmpegPath,
        recording.tempPath,
        recording.outputPath,
        recording.format
      );
    } finally {
      await fs.promises.unlink(recording.tempPath).catch(() => {});
    }
  }
}

module.exports = {
  MediaRecorderRecorder,
};
