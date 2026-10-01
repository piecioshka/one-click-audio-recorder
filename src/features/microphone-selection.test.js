const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  selectorFor,
  resolveMicrophone,
  reconcileSelector,
  describeSelection,
} = require("./microphone-selection");

const usbMic = { label: "USB Mic", deviceId: "abc", groupId: "g1" };
const macMic = {
  label: "MacBook Pro Microphone",
  nativeName: "MacBook Pro Microphone",
  nativeIndex: 0,
};

describe("selectorFor", () => {
  it("prefers the device label", () => {
    assert.equal(selectorFor(usbMic), "label:USB Mic");
    assert.equal(selectorFor(macMic), "label:MacBook Pro Microphone");
  });

  it("falls back to ids for unlabeled devices", () => {
    assert.equal(selectorFor({ label: " ", deviceId: "abc" }), "device:abc");
    assert.equal(selectorFor({ groupId: "g1" }), "group:g1");
    assert.equal(selectorFor({ nativeIndex: 2 }), "native:2");
    assert.equal(selectorFor({}), null);
  });
});

describe("resolveMicrophone", () => {
  const devices = [macMic, usbMic];

  it("resolves every selector format, including legacy ones", () => {
    assert.equal(resolveMicrophone("label:USB Mic", devices), usbMic);
    assert.equal(resolveMicrophone("native-label:USB Mic", devices), usbMic);
    assert.equal(resolveMicrophone("device:abc", devices), usbMic);
    assert.equal(resolveMicrophone("group:g1", devices), usbMic);
    assert.equal(resolveMicrophone("native:0", devices), macMic);
    assert.equal(resolveMicrophone("abc", devices), usbMic);
  });

  it("matches a label saved by the other backend, with or without the transport suffix", () => {
    // Chromium appends the transport type; system_profiler does not.
    const chromiumMac = { label: "MacBook Pro Microphone (Built-in)", deviceId: "m1" };
    const iphone = { label: "iPhone (PK) Microphone", deviceId: "i1" };

    assert.equal(
      resolveMicrophone("label:MacBook Pro Microphone", [iphone, chromiumMac]),
      chromiumMac
    );
    assert.equal(resolveMicrophone("label:MacBook Pro Microphone (Built-in)", [macMic]), macMic);
  });

  it("does not guess between devices that differ only by the suffix", () => {
    const first = { label: "USB Mic (1)", deviceId: "u1" };
    const second = { label: "USB Mic (2)", deviceId: "u2" };

    assert.equal(resolveMicrophone("label:USB Mic (2)", [first, second]), second);
    assert.equal(resolveMicrophone("label:USB Mic", [first, second]), null);
  });

  it("returns null for the system default and for missing devices", () => {
    assert.equal(resolveMicrophone(null, devices), null);
    assert.equal(resolveMicrophone("label:Gone", devices), null);
  });
});

describe("reconcileSelector", () => {
  it("keeps a label selection after the device list refreshes", () => {
    const selector = selectorFor(usbMic);
    assert.equal(reconcileSelector(selector, [usbMic]), "label:USB Mic");
  });

  it("migrates legacy selectors to the canonical form", () => {
    assert.equal(reconcileSelector("native-label:USB Mic", [usbMic]), "label:USB Mic");
    assert.equal(reconcileSelector("abc", [usbMic]), "label:USB Mic");
    assert.equal(reconcileSelector("native:0", [macMic]), "label:MacBook Pro Microphone");
  });

  it("migrates a label saved by the other backend to the current label", () => {
    const chromiumMac = { label: "MacBook Pro Microphone (Built-in)", deviceId: "m1" };
    assert.equal(
      reconcileSelector("label:MacBook Pro Microphone", [chromiumMac]),
      "label:MacBook Pro Microphone (Built-in)"
    );
  });

  it("keeps the selection when the device is disconnected", () => {
    assert.equal(reconcileSelector("label:USB Mic", []), "label:USB Mic");
  });

  it("keeps the system default", () => {
    assert.equal(reconcileSelector(null, [usbMic]), null);
  });
});

describe("describeSelection", () => {
  it("names the system default", () => {
    assert.equal(describeSelection(null, [usbMic]), "System default microphone");
  });

  it("names a connected device", () => {
    assert.equal(describeSelection("device:abc", [usbMic]), "USB Mic");
  });

  it("marks a disconnected device", () => {
    assert.equal(describeSelection("label:USB Mic", []), "USB Mic (disconnected)");
    assert.equal(
      describeSelection("device:abc", []),
      "Previously selected microphone (disconnected)"
    );
  });
});
