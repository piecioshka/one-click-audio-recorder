const { BrowserWindow } = require("electron");
const path = require("path");
const { debugLogs } = require("../../config");

let mediaPermissionsConfigured = false;

function isMediaPermission(permission) {
  return permission === "media" || permission === "audioCapture";
}

function configureMediaPermissions(targetSession) {
  if (!targetSession || mediaPermissionsConfigured) {
    return;
  }

  const isTrustedOrigin = (origin) => {
    return !origin || origin.startsWith("file://");
  };

  targetSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    if (isMediaPermission(permission) && isTrustedOrigin(requestingOrigin)) {
      return true;
    }

    return false;
  });

  targetSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingOrigin =
      details && details.requestingOrigin
        ? details.requestingOrigin
        : webContents && webContents.getURL
          ? webContents.getURL()
          : "";

    if (isMediaPermission(permission) && isTrustedOrigin(requestingOrigin)) {
      callback(true);
      return;
    }

    callback(false);
  });

  mediaPermissionsConfigured = true;
}

async function createMediaRecorderWindow() {
  const window = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    width: 200,
    height: 100,
    webPreferences: {
      preload: path.join(__dirname, "media-recorder.preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // The sandboxed preload reads this from process.argv.
      additionalArguments: debugLogs ? ["--recorder-debug"] : [],
    },
  });

  configureMediaPermissions(window.webContents.session);

  await window.loadFile(path.join(__dirname, "media-recorder.renderer.html"));
  return window;
}

module.exports = {
  createMediaRecorderWindow,
};
