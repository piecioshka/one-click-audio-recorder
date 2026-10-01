const path = require("path");
const { app, dialog, Menu, shell, Tray, systemPreferences } = require("electron");
const { trayIconPath, trayRecordingIconPath, appName, debugLogs } = require("../config");
const { createSettingsStore } = require("./settings-store");
const { createRecorder, recoverInterruptedRecordings } = require("./recorder");
const { stopAndWait } = require("./recorder/stop-and-wait");
const { recordingFileName } = require("./recorder/audio-encoding");
const { buildTrayMenu } = require("./tray-menu");
const { reconcileSelector, resolveMicrophone, selectorFor } = require("./microphone-selection");

let tray = null;
let settingsStore = null;
let recorder = null;
let audioInputDevices = [];
let contextMenu = null;
let devicePollInterval = null;
let quitting = false;

// Converting a long recording to MP3 takes a while; past this the app quits
// anyway and the next start recovers the recording from the temp folder.
const QUIT_SAVE_TIMEOUT_MS = 60000;

let openDialogs = 0;

// The app has no Dock icon and is never the active app on macOS, so its
// windows (dialogs, the about panel) would open behind the windows of the app
// in use. Activate it first; after the last dialog closes, hand the focus
// back to the previous app.
function bringToFront() {
  if (process.platform === "darwin") {
    app.focus({ steal: true });
  }
}

async function inFront(showDialog) {
  openDialogs += 1;
  bringToFront();

  try {
    return await showDialog();
  } finally {
    openDialogs -= 1;

    if (openDialogs === 0 && process.platform === "darwin") {
      app.hide();
    }
  }
}

function showMessage(options) {
  inFront(() => dialog.showMessageBox({ title: appName, ...options })).catch(() => {});
}

function showError(message, detail) {
  showMessage({ type: "error", message, detail });
}

function showRecordingError(message) {
  showError("Recording failed", message || "Unknown recording error");
}

async function ensureMicrophoneAccess() {
  if (process.platform !== "darwin") {
    return true;
  }

  const status = systemPreferences.getMediaAccessStatus("microphone");

  if (status === "granted") {
    return true;
  }

  if (status === "not-determined") {
    try {
      return await systemPreferences.askForMediaAccess("microphone");
    } catch (_error) {
      showRecordingError("Cannot request microphone permission.");
      return false;
    }
  }

  showRecordingError(
    "Microphone access is blocked. Open System Settings > Privacy & Security > Microphone and enable access for this app."
  );
  return false;
}

async function pickOutputDirectory(currentPath) {
  const { canceled, filePaths } = await inFront(() =>
    dialog.showOpenDialog({
      defaultPath: currentPath || app.getPath("downloads"),
      title: "Choose recordings output folder",
      properties: ["openDirectory", "createDirectory"],
    })
  );

  return canceled || filePaths.length === 0 ? null : filePaths[0];
}

function logDevices(devices) {
  if (!debugLogs) {
    return;
  }

  const lines = devices.map((device, index) => {
    const label = (device.label || "").trim() || "<no-label>";
    return `${index + 1}. ${label} [${selectorFor(device) || "<no-selector>"}]`;
  });

  console.info(`[recorder][devices] count=${devices.length}\n${lines.join("\n")}`);
  console.info(
    `[recorder][devices] selected=${settingsStore.get().inputDeviceId || "system-default"}`
  );
}

function applyInputDevices(devices) {
  audioInputDevices = devices;
  logDevices(devices);

  const { inputDeviceId } = settingsStore.get();
  const reconciled = reconcileSelector(inputDeviceId, devices);

  if (reconciled !== inputDeviceId) {
    settingsStore.update({ inputDeviceId: reconciled });
  }

  updateContextMenu();
}

function updateTrayState() {
  if (!tray) {
    return;
  }

  tray.setImage(recorder.isRecording ? trayRecordingIconPath : trayIconPath);
  tray.setToolTip(recorder.isRecording ? `${appName} (recording)` : appName);
}

async function toggleRecording() {
  if (recorder.isRecording) {
    recorder.stop();
    return;
  }

  if (!(await ensureMicrophoneAccess())) {
    return;
  }

  const settings = settingsStore.get();
  const outputDir = settingsStore.ensureOutputDir();

  try {
    await recorder.start({
      device: resolveMicrophone(settings.inputDeviceId, audioInputDevices),
      format: settings.outputFormat,
      outputPath: path.join(outputDir, recordingFileName(settings.outputFormat)),
    });
  } catch (error) {
    showRecordingError(error.message);
  }
}

const menuActions = {
  toggleRecording: () => void toggleRecording(),
  selectMicrophone: (selector) => settingsStore.update({ inputDeviceId: selector }),
  refreshDevices: () => void recorder.refreshDevices(),
  setOutputFormat: (format) => settingsStore.update({ outputFormat: format }),
  chooseOutputDir: async () => {
    const nextPath = await pickOutputDirectory(settingsStore.get().outputDir);

    if (nextPath) {
      settingsStore.update({ outputDir: nextPath });
    }
  },
  openOutputDir: async () => {
    const error = await shell.openPath(settingsStore.get().outputDir);

    if (error) {
      showError("Cannot open the recordings folder", error);
    }
  },
  showAbout: () => {
    bringToFront();
    app.showAboutPanel();
  },
  quit: () => app.quit(),
};

function updateContextMenu() {
  if (!tray) {
    return;
  }

  const template = buildTrayMenu(
    {
      isRecording: recorder.isRecording,
      devices: audioInputDevices,
      appName,
      settings: settingsStore.get(),
    },
    menuActions
  );

  contextMenu = Menu.buildFromTemplate(template);

  // Linux trays never emit "right-click" and cannot popUpContextMenu(); the
  // menu has to be attached to the icon, and re-attached after every change.
  if (process.platform === "linux") {
    tray.setContextMenu(contextMenu);
  }
}

async function recoverRecordings() {
  const { recovered, keptRaw } = await recoverInterruptedRecordings({
    tempDir: app.getPath("temp"),
    outputDir: settingsStore.ensureOutputDir(),
  });
  const files = [...recovered, ...keptRaw].map((filePath) => path.basename(filePath));

  if (files.length === 0) {
    return;
  }

  console.info(`[recorder] recovered ${files.join(", ")}`);
  showMessage({
    type: "info",
    message: "Recovered unfinished recordings",
    detail: `The app was closed while recording. Saved to the recordings folder:\n\n${files.join("\n")}`,
  });
}

// Quitting mid-recording would close the recorder window before the last
// chunks arrive and before ffmpeg writes the file, so quitting waits.
function quitAfterSaving(event) {
  clearInterval(devicePollInterval);

  if (quitting || !recorder.isRecording) {
    return;
  }

  quitting = true;
  event.preventDefault();
  void stopAndWait(recorder, QUIT_SAVE_TIMEOUT_MS).then(() => app.quit());
}

async function initTrayFeature() {
  settingsStore = createSettingsStore({
    filePath: path.join(app.getPath("userData"), "settings.json"),
    fallbackOutputDir: app.getPath("downloads"),
  });
  console.log(`[recorder] settings file: ${settingsStore.filePath}`);

  recorder = await createRecorder({ tempDir: app.getPath("temp") });

  settingsStore.on("change", updateContextMenu);
  recorder.on("devices", applyInputDevices);
  recorder.on("change", () => {
    updateTrayState();
    updateContextMenu();
  });
  recorder.on("finished", ({ outputPath }) => {
    console.info(`[recorder] saved ${path.basename(outputPath)}`);
  });
  recorder.on("error", (message) => {
    console.error("Recording error:", message);
    showRecordingError(message);
  });

  tray = new Tray(trayIconPath);
  tray.on("click", () => {
    void toggleRecording();
  });
  tray.on("right-click", () => {
    void recorder.refreshDevices();
    updateContextMenu();
    tray.popUpContextMenu(contextMenu);
  });

  updateTrayState();
  updateContextMenu();
  void recorder.refreshDevices();

  if (recorder.devicePollIntervalMs) {
    devicePollInterval = setInterval(() => {
      void recorder.refreshDevices();
    }, recorder.devicePollIntervalMs);
  }

  app.on("before-quit", quitAfterSaving);

  recoverRecordings().catch((error) => {
    console.error("Cannot recover unfinished recordings:", error);
  });
}

module.exports = {
  initTrayFeature,
};
