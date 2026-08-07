const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, listener) {
  const wrapped = (_event, payload) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

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
  onEvent: (listener) => subscribe("codex:event", listener),

  // Controller input is read by the main process so it survives losing focus to another app.
  controllerStatus: () => ipcRenderer.invoke("codicon:controller-status"),
  setControllerContext: (context) => ipcRenderer.send("codicon:set-controller-context", context),
  onControllerActions: (listener) => subscribe("controller:actions", listener),
  onControllerSnapshot: (listener) => subscribe("controller:snapshot", listener),
  onControllerStatus: (listener) => subscribe("controller:status", listener),

  // Always-on-top status overlay.
  publishHudState: (patch) => ipcRenderer.send("codicon:publish-hud-state", patch),
  hudState: () => ipcRenderer.invoke("codicon:hud-state"),
  setHudEnabled: (enabled) => ipcRenderer.invoke("codicon:set-hud-enabled", enabled),
  onHudState: (listener) => subscribe("hud:state", listener),
  showMainWindow: () => ipcRenderer.send("codicon:show-main-window"),
});
