const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createSettingsStore } = require("./settings-store");

describe("createSettingsStore", () => {
  let dir;
  let filePath;
  let fallbackOutputDir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "settings-store-"));
    filePath = path.join(dir, "config", "settings.json");
    fallbackOutputDir = path.join(dir, "downloads");
    fs.mkdirSync(fallbackOutputDir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeRaw(content) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }

  function readPersisted() {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  }

  it("starts from defaults and persists them", () => {
    const store = createSettingsStore({ filePath, fallbackOutputDir });

    assert.deepEqual(store.get(), {
      outputDir: fallbackOutputDir,
      inputDeviceId: null,
      outputFormat: "wav",
    });
    assert.deepEqual(readPersisted(), store.get());
  });

  it("loads saved settings", () => {
    const outputDir = path.join(dir, "recordings");
    writeRaw(JSON.stringify({ outputDir, inputDeviceId: "label:USB Mic", outputFormat: "mp3" }));

    const settings = createSettingsStore({ filePath, fallbackOutputDir }).get();

    assert.equal(settings.outputDir, outputDir);
    assert.equal(settings.inputDeviceId, "label:USB Mic");
    assert.equal(settings.outputFormat, "mp3");
    assert.ok(fs.existsSync(outputDir), "creates the output folder");
  });

  it("repairs invalid values", () => {
    writeRaw(JSON.stringify({ outputDir: 42, inputDeviceId: "", outputFormat: "ogg" }));

    assert.deepEqual(createSettingsStore({ filePath, fallbackOutputDir }).get(), {
      outputDir: fallbackOutputDir,
      inputDeviceId: null,
      outputFormat: "wav",
    });
  });

  it("survives corrupted files", () => {
    for (const content of ["{not json", "null", "[]", '"text"']) {
      writeRaw(content);
      assert.equal(createSettingsStore({ filePath, fallbackOutputDir }).get().outputFormat, "wav");
    }
  });

  it("falls back when the output folder is not writable", () => {
    const blocker = path.join(dir, "file");
    fs.writeFileSync(blocker, "");
    writeRaw(JSON.stringify({ outputDir: path.join(blocker, "sub") }));

    assert.equal(
      createSettingsStore({ filePath, fallbackOutputDir }).get().outputDir,
      fallbackOutputDir
    );
  });

  it("update() normalizes, persists and notifies", () => {
    const store = createSettingsStore({ filePath, fallbackOutputDir });
    const seen = [];
    store.on("change", (settings) => seen.push(settings));

    store.update({ outputFormat: "mp3", inputDeviceId: "label:USB Mic" });
    store.update({ outputFormat: "flac" });

    assert.equal(store.get().outputFormat, "wav");
    assert.equal(store.get().inputDeviceId, "label:USB Mic");
    assert.equal(readPersisted().outputFormat, "wav");
    assert.equal(seen.length, 2);
  });

  it("get() returns a copy", () => {
    const store = createSettingsStore({ filePath, fallbackOutputDir });
    store.get().outputFormat = "mp3";
    assert.equal(store.get().outputFormat, "wav");
  });

  it("ensureOutputDir() recreates a deleted folder", () => {
    const outputDir = path.join(dir, "recordings");
    const store = createSettingsStore({ filePath, fallbackOutputDir });
    store.update({ outputDir });
    fs.rmSync(outputDir, { recursive: true });

    assert.equal(store.ensureOutputDir(), outputDir);
    assert.ok(fs.existsSync(outputDir));
  });
});
