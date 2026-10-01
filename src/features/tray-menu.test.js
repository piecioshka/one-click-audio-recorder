const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { buildTrayMenu } = require("./tray-menu");

const usbMic = { label: "USB Mic", deviceId: "abc" };
const settings = { inputDeviceId: null, outputFormat: "wav", outputDir: "/rec" };

function recordingActions() {
  const calls = [];
  const record =
    (name) =>
    (...args) =>
      calls.push([name, ...args]);
  return {
    calls,
    actions: {
      toggleRecording: record("toggleRecording"),
      selectMicrophone: record("selectMicrophone"),
      refreshDevices: record("refreshDevices"),
      setOutputFormat: record("setOutputFormat"),
      chooseOutputDir: record("chooseOutputDir"),
      openOutputDir: record("openOutputDir"),
      showAbout: record("showAbout"),
      quit: record("quit"),
    },
  };
}

function build(state = {}) {
  const { calls, actions } = recordingActions();
  const menu = buildTrayMenu(
    { appName: "Recorder", isRecording: false, devices: [usbMic], settings, ...state },
    actions
  );
  const find = (items, label) => items.find((item) => item.label === label);
  return { menu, calls, find };
}

describe("buildTrayMenu", () => {
  it("opens the about panel through an action, not the built-in role", () => {
    const { menu, calls, find } = build();
    const about = find(menu, "About Recorder");

    assert.equal(about.role, undefined);
    about.click();
    assert.deepEqual(calls, [["showAbout"]]);
  });

  it("offers start or stop depending on the recording state", () => {
    assert.equal(build().menu[0].label, "🔴 Start recording");
    assert.equal(build({ isRecording: true }).menu[0].label, "⏹️ Stop recording");
  });

  it("marks the selected microphone and the system default", () => {
    const { menu, find } = build({ settings: { ...settings, inputDeviceId: "label:USB Mic" } });
    const submenu = find(menu, "Microphone").submenu;

    assert.equal(submenu[0].label, "Current: USB Mic");
    assert.equal(find(submenu, "System default microphone").checked, false);
    assert.equal(find(submenu, "USB Mic").checked, true);
  });

  it("selects a microphone by its selector", () => {
    const { menu, calls, find } = build();
    find(find(menu, "Microphone").submenu, "USB Mic").click();
    find(find(menu, "Microphone").submenu, "System default microphone").click();

    assert.deepEqual(calls, [
      ["selectMicrophone", "label:USB Mic"],
      ["selectMicrophone", null],
    ]);
  });

  it("explains an empty device list", () => {
    const { menu, find } = build({ devices: [] });
    assert.ok(find(find(menu, "Microphone").submenu, "No microphones detected"));
  });

  it("switches the output format", () => {
    const { menu, calls, find } = build();
    const submenu = find(menu, "Output format").submenu;

    assert.equal(find(submenu, "WAV (uncompressed)").checked, true);
    find(submenu, "MP3 (compressed, smaller size)").click();
    assert.deepEqual(calls, [["setOutputFormat", "mp3"]]);
  });

  it("shows the output folder", () => {
    const { menu, find } = build();
    assert.ok(find(menu, "Current folder: /rec"));
  });
});
