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

  // Provider-neutral agent surface. Every payload carries `provider`; the main process routes it
  // to the matching adapter, and all adapters emit the same normalized event stream.
  startThread: (payload) => ipcRenderer.invoke("agent:start-thread", payload),
  sendMessage: (payload) => ipcRenderer.invoke("agent:send", payload),
  updatePower: (payload) => ipcRenderer.invoke("agent:update-power", payload),
  interrupt: (payload) => ipcRenderer.invoke("agent:interrupt", payload),
  respond: (payload) => ipcRenderer.invoke("agent:respond", payload),
  resumeThread: (payload) => ipcRenderer.invoke("agent:resume-thread", payload),
  closeThread: (payload) => ipcRenderer.invoke("agent:close-thread", payload),
  listThreads: (provider) => ipcRenderer.invoke("agent:list-threads", provider),
  voiceStart: (payload) => ipcRenderer.invoke("agent:voice-start", payload),
  voiceAudio: (payload) => ipcRenderer.invoke("agent:voice-audio", payload),
  voiceStop: (payload) => ipcRenderer.invoke("agent:voice-stop", payload),
  onAgentEvent: (listener) => subscribe("agent:event", listener),

  // Which agent the controller currently drives, decided by the focus tracker or manual override.
  getTarget: () => ipcRenderer.invoke("codicon:get-target"),
  setTarget: (target) => ipcRenderer.invoke("codicon:set-target", target),
  cycleTarget: () => ipcRenderer.invoke("codicon:cycle-target"),
  onTargetChanged: (listener) => subscribe("target:changed", listener),

  // Controller input is read by the main process so it survives losing focus to another app.
  controllerStatus: () => ipcRenderer.invoke("codicon:controller-status"),
  setControllerContext: (context) => ipcRenderer.send("codicon:set-controller-context", context),
  onControllerActions: (listener) => subscribe("controller:actions", listener),
  onControllerSnapshot: (listener) => subscribe("controller:snapshot", listener),
  onControllerStatus: (listener) => subscribe("controller:status", listener),

  // Always-on-top status overlay and the standalone power-wheel overlay.
  publishHudState: (patch) => ipcRenderer.send("codicon:publish-hud-state", patch),
  hudState: () => ipcRenderer.invoke("codicon:hud-state"),
  setHudEnabled: (enabled) => ipcRenderer.invoke("codicon:set-hud-enabled", enabled),
  onHudState: (listener) => subscribe("hud:state", listener),
  publishWheelState: (state) => ipcRenderer.send("codicon:publish-wheel-state", state),
  onWheelState: (listener) => subscribe("wheel:state", listener),
  showMainWindow: () => ipcRenderer.send("codicon:show-main-window"),
});
