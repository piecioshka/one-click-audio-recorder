// Builds the Electron menu template for the tray from explicit state.
// Clicks call the given actions; nothing here touches Electron.
const { SYSTEM_DEFAULT_LABEL, describeSelection, selectorFor } = require("./microphone-selection");

const OUTPUT_FORMAT_ITEMS = [
  { format: "wav", label: "WAV (uncompressed)" },
  { format: "mp3", label: "MP3 (compressed, smaller size)" },
];

function microphoneSubmenu({ devices, settings }, actions) {
  const { inputDeviceId } = settings;
  const submenu = [
    { label: `Current: ${describeSelection(inputDeviceId, devices)}`, enabled: false },
    { type: "separator" },
    {
      label: SYSTEM_DEFAULT_LABEL,
      type: "radio",
      checked: !inputDeviceId,
      click: () => actions.selectMicrophone(null),
    },
    { type: "separator" },
  ];

  if (devices.length === 0) {
    submenu.push({ label: "No microphones detected", enabled: false });
    submenu.push({ label: "Check microphone permission in system settings", enabled: false });
  }

  for (const device of devices) {
    const selector = selectorFor(device);

    submenu.push({
      label: (device.label || "").trim() || "Unnamed microphone",
      type: "radio",
      checked: Boolean(selector) && inputDeviceId === selector,
      enabled: Boolean(selector),
      click: () => actions.selectMicrophone(selector),
    });
  }

  submenu.push({ type: "separator" });
  submenu.push({ label: "Refresh list", click: () => actions.refreshDevices() });
  return submenu;
}

function outputFormatSubmenu({ settings }, actions) {
  return [
    { label: `Current: ${settings.outputFormat.toUpperCase()}`, enabled: false },
    { type: "separator" },
    ...OUTPUT_FORMAT_ITEMS.map(({ format, label }) => ({
      label,
      type: "radio",
      checked: settings.outputFormat === format,
      click: () => actions.setOutputFormat(format),
    })),
  ];
}

function buildTrayMenu(state, actions) {
  return [
    {
      label: state.isRecording ? "⏹️ Stop recording" : "🔴 Start recording",
      click: () => actions.toggleRecording(),
    },
    { type: "separator" },
    { label: "Microphone", submenu: microphoneSubmenu(state, actions) },
    { type: "separator" },
    { label: "Output format", submenu: outputFormatSubmenu(state, actions) },
    { type: "separator" },
    { label: "Set output folder...", click: () => actions.chooseOutputDir() },
    { label: "Open recordings folder", click: () => actions.openOutputDir() },
    { label: `Current folder: ${state.settings.outputDir}`, enabled: false },
    { type: "separator" },
    // Not role "about": the app has to be activated first (see tray.feature.js).
    { label: `About ${state.appName}`, click: () => actions.showAbout() },
    { label: "Quit", click: () => actions.quit() },
  ];
}

module.exports = {
  buildTrayMenu,
};
