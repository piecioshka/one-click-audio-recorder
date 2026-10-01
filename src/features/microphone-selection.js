// A selector is the persisted reference to the chosen microphone
// (settings.inputDeviceId). null means the system default microphone.
//
// Canonical selectors are "label:<label>" (both recorder backends expose
// stable labels), with "device:", "group:" and "native:" as fallbacks for
// unlabeled devices. Older app versions stored "native-label:<label>" or a
// bare Chromium deviceId; those still resolve and get migrated by
// reconcileSelector().

const SYSTEM_DEFAULT_LABEL = "System default microphone";

function labelOf(device) {
  return (device.label || "").trim();
}

function selectorFor(device) {
  const label = labelOf(device);

  if (label) {
    return `label:${label}`;
  }

  if (device.deviceId) {
    return `device:${device.deviceId}`;
  }

  if (device.groupId) {
    return `group:${device.groupId}`;
  }

  if (Number.isInteger(device.nativeIndex)) {
    return `native:${device.nativeIndex}`;
  }

  return null;
}

const PARSERS = [
  { prefix: "label:", kind: "label" },
  { prefix: "native-label:", kind: "label" },
  { prefix: "device:", kind: "device" },
  { prefix: "group:", kind: "group" },
  { prefix: "native:", kind: "native" },
];

function parseSelector(selector) {
  if (typeof selector !== "string" || selector.length === 0) {
    return null;
  }

  for (const { prefix, kind } of PARSERS) {
    if (selector.startsWith(prefix)) {
      return { kind, value: selector.slice(prefix.length).trim() };
    }
  }

  // Legacy: a bare Chromium deviceId.
  return { kind: "device", value: selector };
}

const MATCHERS = {
  label: (device, value) => labelOf(device) === value,
  device: (device, value) => device.deviceId === value,
  group: (device, value) => device.groupId === value,
  native: (device, value) => device.nativeIndex === Number.parseInt(value, 10),
};

// The two recorder backends name the same microphone differently: Chromium
// appends the transport type ("MacBook Pro Microphone (Built-in)"),
// system_profiler does not ("MacBook Pro Microphone").
function withoutSuffix(label) {
  return label.replace(/\s*\([^()]*\)$/, "");
}

// Used only when no label matches exactly, and only when it points at a
// single device, so "USB Mic (1)" and "USB Mic (2)" are never confused.
function findBySuffixlessLabel(value, devices) {
  const wanted = withoutSuffix(value);
  const candidates = devices.filter((device) => withoutSuffix(labelOf(device)) === wanted);
  return candidates.length === 1 ? candidates[0] : null;
}

function resolveMicrophone(selector, devices) {
  const parsed = parseSelector(selector);

  if (!parsed || !parsed.value) {
    return null;
  }

  const matches = MATCHERS[parsed.kind];
  const exact = devices.find((device) => matches(device, parsed.value));

  if (exact || parsed.kind !== "label") {
    return exact || null;
  }

  return findBySuffixlessLabel(parsed.value, devices);
}

function reconcileSelector(selector, devices) {
  const device = resolveMicrophone(selector, devices);

  if (!device) {
    return selector || null;
  }

  return selectorFor(device) || selector;
}

function describeSelection(selector, devices) {
  if (!selector) {
    return SYSTEM_DEFAULT_LABEL;
  }

  const device = resolveMicrophone(selector, devices);

  if (device) {
    return labelOf(device) || "Unnamed microphone";
  }

  const parsed = parseSelector(selector);

  if (parsed && parsed.kind === "label" && parsed.value) {
    return `${parsed.value} (disconnected)`;
  }

  return "Previously selected microphone (disconnected)";
}

module.exports = {
  SYSTEM_DEFAULT_LABEL,
  selectorFor,
  resolveMicrophone,
  reconcileSelector,
  describeSelection,
};
