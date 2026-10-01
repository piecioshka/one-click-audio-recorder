// Stops the current recording and resolves once it is saved ("saved"), has
// failed ("failed") or did not settle within timeoutMs ("timeout"). Resolves
// with "idle" right away when nothing is being recorded.
function stopAndWait(recorder, timeoutMs) {
  if (!recorder.isRecording) {
    return Promise.resolve("idle");
  }

  return new Promise((resolve) => {
    const settle = (outcome) => {
      clearTimeout(timer);
      recorder.off("finished", onFinished);
      recorder.off("error", onError);
      resolve(outcome);
    };
    const onFinished = () => settle("saved");
    const onError = () => settle("failed");
    const timer = setTimeout(() => settle("timeout"), timeoutMs);

    recorder.on("finished", onFinished);
    recorder.on("error", onError);
    recorder.stop();
  });
}

module.exports = {
  stopAndWait,
};
