const path = require("path");
const { app } = require("electron");

const root = app.isPackaged ? process.resourcesPath : app.getAppPath();
const iconsDir = path.join(root, "icons");

module.exports = {
  appName: "OneClick Audio Recorder",
  debugLogs: process.env.RECORDER_DEBUG === "1",
  trayIconPath: path.join(iconsDir, "tray-icon.png"),
  trayRecordingIconPath: path.join(iconsDir, "tray-icon-recording.png"),
};
