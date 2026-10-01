// Runs in the hidden recorder window; talks to the main process only through
// window.recorderBridge from media-recorder.preload.js.
let mediaRecorder = null;
let mediaStream = null;
// Chunks go to the main process in order, one at a time.
let chunkQueue = Promise.resolve();

function notify(type, payload = {}) {
  window.recorderBridge.sendStatus(type, payload);
}

function stopTracks() {
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }
}

// Device lists are refreshed every few seconds; log them only on request.
function debug(message) {
  if (window.recorderBridge.debugLogs) {
    console.info(`[recorder][renderer] ${message}`);
  }
}

function formatDeviceDiagnostics(prefix, list) {
  const lines = list.map((item, index) => {
    const label = (item.label || "").trim() || "<no-label>";
    const deviceId = item.deviceId || "<no-device-id>";
    const groupId = item.groupId || "<no-group-id>";
    return `${index + 1}. ${label} [deviceId=${deviceId}] [groupId=${groupId}]`;
  });

  if (lines.length === 0) {
    debug(`${prefix}: <empty>`);
    return;
  }

  debug(`${prefix}:\n${lines.join("\n")}`);
}

async function listDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  let audioInputs = devices.filter((item) => item.kind === "audioinput");
  const beforeFilter = [...audioInputs];

  const hasAnyLabels = audioInputs.some((item) => item.label && item.label.trim().length > 0);

  // Without labels, Chromium usually exposes synthetic entries like
  // "default" and "communications". Treat that as unavailable until
  // permission is granted, so the tray menu can show proper guidance.
  if (!hasAnyLabels) {
    audioInputs = [];
  }

  if (audioInputs.length > 0) {
    audioInputs = audioInputs
      .filter((item) => {
        const hasUsableId = Boolean(item.deviceId) || Boolean(item.groupId);
        const isSyntheticAlias = item.deviceId === "default" || item.deviceId === "communications";
        return hasUsableId && !isSyntheticAlias;
      })
      .filter((item, index, all) => {
        const key = item.deviceId ? `device:${item.deviceId}` : `group:${item.groupId}`;
        return (
          all.findIndex((other) => {
            const otherKey = other.deviceId ? `device:${other.deviceId}` : `group:${other.groupId}`;
            return otherKey === key;
          }) === index
        );
      });
  }

  debug(`enumerate audio inputs: before=${beforeFilter.length} after=${audioInputs.length}`);
  formatDeviceDiagnostics("audio inputs before filters", beforeFilter);
  formatDeviceDiagnostics("audio inputs after filters", audioInputs);

  // MediaDeviceInfo is a platform object; send plain data over IPC.
  const devicesForMain = audioInputs.map((item) => ({
    label: item.label,
    deviceId: item.deviceId,
    groupId: item.groupId,
  }));

  notify("devices-list", { devices: devicesForMain });
}

// Chromium applies voice-call processing by default: echo cancellation
// and noise suppression cut music and room sound, and automatic gain
// control fades the level in over the first seconds. A recorder keeps
// the microphone signal as it is.
const RAW_AUDIO = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
};

function toConstraints(payload = {}) {
  if (payload.deviceId) {
    return { audio: { ...RAW_AUDIO, deviceId: { exact: payload.deviceId } } };
  }

  if (payload.groupId) {
    return { audio: { ...RAW_AUDIO, groupId: { exact: payload.groupId } } };
  }

  return { audio: RAW_AUDIO };
}

// PCM keeps the recording lossless until ffmpeg writes the output
// format; Opus is the fallback where PCM in WebM is unsupported.
function recorderOptions() {
  const mimeType = ["audio/webm;codecs=pcm", "audio/webm;codecs=opus"].find((type) =>
    MediaRecorder.isTypeSupported(type)
  );

  return mimeType ? { mimeType, audioBitsPerSecond: 256000 } : undefined;
}

async function startRecording(payload = {}) {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    return;
  }

  const preferredConstraints = toConstraints(payload);

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia(preferredConstraints);
  } catch (_error) {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: RAW_AUDIO });
  }

  const audioTrack = mediaStream.getAudioTracks()[0];

  if (!audioTrack) {
    throw new Error("No audio track available from selected microphone");
  }

  audioTrack.enabled = true;

  const recorder = new MediaRecorder(mediaStream, recorderOptions());
  mediaRecorder = recorder;
  chunkQueue = Promise.resolve();

  // Each chunk is written to disk by the main process right away, so a
  // long recording does not pile up in memory.
  recorder.ondataavailable = (event) => {
    if (!event.data || event.data.size === 0) {
      return;
    }

    const data = event.data;
    chunkQueue = chunkQueue.then(async () => {
      notify("recording-chunk", { arrayBuffer: await data.arrayBuffer() });
    });
  };

  recorder.onerror = (event) => {
    notify("recording-error", {
      message: event.error ? event.error.message : "Unknown recording error",
    });
  };

  recorder.onstop = async () => {
    try {
      await chunkQueue;
      notify("recording-stopped", { mimeType: recorder.mimeType || "audio/webm" });
    } catch (error) {
      notify("recording-error", {
        message: error.message || "Cannot process recorded audio",
      });
    } finally {
      mediaRecorder = null;
      stopTracks();
    }
  };

  recorder.start(1000);
  notify("recording-started", { mimeType: recorder.mimeType || "audio/webm" });
  await listDevices();
}

function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state !== "recording") {
    stopTracks();
    return;
  }

  mediaRecorder.stop();
}

window.recorderBridge.onCommand(async (command, payload) => {
  try {
    if (command === "start-recording") {
      await startRecording(payload);
      return;
    }

    if (command === "stop-recording") {
      stopRecording();
      return;
    }

    if (command === "list-devices") {
      await listDevices();
    }
  } catch (error) {
    notify("recording-error", {
      message: error.message || "Unhandled recorder error",
    });
  }
});

listDevices().catch(() => {
  notify("devices-list", { devices: [] });
});
