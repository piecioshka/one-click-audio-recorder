const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("recorderBridge", {
  debugLogs: process.argv.includes("--recorder-debug"),
  onCommand(handler) {
    ipcRenderer.on("recorder:command", (_event, command, payload = {}) => {
      handler(command, payload);
    });
  },
  sendStatus(type, payload = {}) {
    ipcRenderer.send("recorder:status", { type, payload });
  },
});
