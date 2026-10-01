const { app, dialog } = require("electron");
const { appName } = require("./src/config");
const { initTrayFeature } = require("./src/features/tray.feature");

function runInBackground() {
  // app.hide() and app.dock exist only on macOS.
  if (process.platform !== "darwin") {
    return;
  }

  app.hide();
  app.dock.hide();
}

async function main() {
  app.setName(appName);
  runInBackground();
  await initTrayFeature();
}

// Without the tray there is no way to reach the app (the macOS dock icon is
// hidden), so a failed start must not leave an invisible process behind.
function failStartup(error) {
  console.error("Cannot start the app:", error);
  dialog.showErrorBox(appName, `Cannot start the app: ${error.message}`);
  app.exit(1);
}

function closeApp() {
  if (process.platform !== "darwin") {
    app.quit();
  }
}

// A second copy would add a second tray icon and fight over the microphone.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(main).catch(failStartup);
  app.on("window-all-closed", closeApp);
}
