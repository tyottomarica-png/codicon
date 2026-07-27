const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("codicon", {
  bootstrap: () => ipcRenderer.invoke("codicon:bootstrap"),
  chooseWorkspace: () => ipcRenderer.invoke("codicon:choose-workspace"),
  getSettings: () => ipcRenderer.invoke("codicon:get-settings"),
  saveSettings: (settings) => ipcRenderer.invoke("codicon:save-settings", settings),
  restartServer: () => ipcRenderer.invoke("codicon:restart-server"),
  startThread: (options) => ipcRenderer.invoke("codicon:start-thread", options),
  resumeThread: (threadId) => ipcRenderer.invoke("codicon:resume-thread", threadId),
  listThreads: () => ipcRenderer.invoke("codicon:list-threads"),
  sendMessage: (payload) => ipcRenderer.invoke("codicon:send-message", payload),
  updatePower: (payload) => ipcRenderer.invoke("codicon:update-power", payload),
  interrupt: (payload) => ipcRenderer.invoke("codicon:interrupt", payload),
  respond: (payload) => ipcRenderer.invoke("codicon:respond", payload),
  voiceStart: (threadId) => ipcRenderer.invoke("codicon:voice-start", threadId),
  voiceAudio: (payload) => ipcRenderer.invoke("codicon:voice-audio", payload),
  voiceStop: (threadId) => ipcRenderer.invoke("codicon:voice-stop", threadId),
  onEvent: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on("codex:event", wrapped);
    return () => ipcRenderer.removeListener("codex:event", wrapped);
  },
});
