const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");

const OUTPUT_FORMATS = ["wav", "mp3"];
const DEFAULT_OUTPUT_FORMAT = "wav";

function writableDir(candidate) {
  if (typeof candidate !== "string" || candidate.trim().length === 0) {
    return null;
  }

  try {
    const resolved = path.resolve(candidate);
    fs.mkdirSync(resolved, { recursive: true });
    fs.accessSync(resolved, fs.constants.W_OK);
    return resolved;
  } catch (_error) {
    return null;
  }
}

function normalize(raw, fallbackOutputDir) {
  return {
    outputDir: writableDir(raw.outputDir) || fallbackOutputDir,
    inputDeviceId:
      typeof raw.inputDeviceId === "string" && raw.inputDeviceId.length > 0
        ? raw.inputDeviceId
        : null,
    outputFormat: OUTPUT_FORMATS.includes(raw.outputFormat)
      ? raw.outputFormat
      : DEFAULT_OUTPUT_FORMAT,
  };
}

function readRaw(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const isPlainObject = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
    return isPlainObject ? parsed : {};
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("Cannot read settings file:", error);
    }

    return {};
  }
}

// Settings are always valid: every read and update goes through normalize(),
// and every update is persisted and announced with a "change" event.
function createSettingsStore({ filePath, fallbackOutputDir }) {
  const events = new EventEmitter();
  let settings = normalize(readRaw(filePath), fallbackOutputDir);

  function persist() {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(settings, null, 2));
    } catch (error) {
      console.error("Cannot write settings file:", error);
    }
  }

  function update(patch) {
    settings = normalize({ ...settings, ...patch }, fallbackOutputDir);
    persist();
    events.emit("change", { ...settings });
  }

  persist();

  return {
    filePath,
    get: () => ({ ...settings }),
    update,
    // The output folder can disappear between recordings (deleted, unmounted
    // drive). Returns a folder that is writable right now.
    ensureOutputDir() {
      const current = writableDir(settings.outputDir);

      if (current !== settings.outputDir) {
        update({ outputDir: current });
      }

      return settings.outputDir;
    },
    on: (eventName, listener) => events.on(eventName, listener),
  };
}

module.exports = {
  OUTPUT_FORMATS,
  createSettingsStore,
};
