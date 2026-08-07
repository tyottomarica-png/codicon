const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, screen, session, systemPreferences, Tray } = require("electron");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { CodexAgent } = require("./agents/codexAgent.cjs");
const { ClaudeAgent } = require("./agents/claudeAgent.cjs");
const { FocusTracker } = require("./focusTracker.cjs");
const { GamepadSource } = require("./gamepadSource.cjs");
const { InputBridge } = require("./inputBridge.cjs");
const { planKeystrokes } = require("./keystrokePlan.cjs");

const DEFAULT_SETTINGS = {
  workspace: "",
  codexPath: "",
  claudePath: "",
  controllerEnabled: true,
  hudEnabled: true,
  hudBounds: null,
  quitOnWindowClose: false,
  deadzone: 0.42,
  permissionMode: "auto",
  target: { mode: "auto", manual: "codex" },
  // Direct control: drive the agent already open in another app instead of Codicon's own session.
  // "off" until the user opts in; "clipboard" needs no OS permission, "type" needs Accessibility.
  directControl: { mode: "off" },
  providers: {
    codex: {
      slots: [
        { key: "sol", label: "SOL", modelId: "gpt-5.6-sol", color: "#ff7a59" },
        { key: "terra", label: "TERRA", modelId: "gpt-5.6-terra", color: "#9bd6bd" },
        { key: "luna", label: "LUNA", modelId: "gpt-5.6-luna", color: "#9ba7ff" },
      ],
    },
    claude: {
      slots: [
        { key: "fable", label: "FABLE", modelId: "claude-fable-5", color: "#d97757" },
        { key: "opus", label: "OPUS", modelId: "opus", color: "#9bd6bd" },
        { key: "sonnet", label: "SONNET", modelId: "sonnet", color: "#9ba7ff" },
      ],
    },
  },
  skills: [
    { id: "review", label: "REVIEW PR", prompt: "Review the current branch's changes and report defects, ranked by severity.", color: "#9bd6bd" },
    { id: "debug", label: "DEBUG", prompt: "Reproduce and diagnose the most recent error, then propose the smallest correct fix.", color: "#ff7a59" },
    { id: "refactor", label: "REFACTOR", prompt: "Simplify the code I last touched without changing its behaviour, and explain each change.", color: "#9ba7ff" },
    { id: "test", label: "TESTS", prompt: "Add the tests that would have caught the most recent bug, and run them.", color: "#daa04f" },
  ],
  bindings: {
    primary: 0,
    cancel: 1,
    focusComposer: 2,
    newThread: 3,
    powerWheel: 4,
    pushToTalk: 5,
    fastMode: 11,
    settings: 9,
    switchTarget: 8,
    skillsRing: 6,
  },
};

let mainWindow = null;
let hudWindow = null;
let wheelWindow = null;
let tray = null;
let isQuitting = false;
let settingsCache = null;

// The ring sizes depend on the model list the renderer loaded, so the renderer publishes them up
// to the main process where the controller edge detection lives.
let controllerContext = { modelCount: 3, effortCount: 5, skillCount: 4 };

// Last states the main window published for the overlay windows. Cached so an overlay opened
// later renders something immediately instead of waiting for the next change.
let hudState = {
  connection: "connecting",
  target: "codex",
  targetSource: "fallback",
  model: "",
  effort: "",
  serviceTier: null,
  busy: false,
  voiceActive: false,
  approvalPending: false,
  controller: false,
  agentsRunning: 0,
  agentsWaiting: 0,
  agentsTotal: 0,
};
let wheelState = { open: false };

function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

/** Merge stored settings over defaults, migrating the pre-multi-agent shape. */
function upgradeSettings(stored, defaults) {
  const next = {
    ...defaults,
    ...stored,
    target: { ...defaults.target, ...(stored.target || {}) },
    directControl: { ...defaults.directControl, ...(stored.directControl || {}) },
    bindings: { ...defaults.bindings, ...(stored.bindings || {}) },
    providers: {
      codex: { slots: stored.providers?.codex?.slots?.length ? stored.providers.codex.slots : defaults.providers.codex.slots },
      claude: { slots: stored.providers?.claude?.slots?.length ? stored.providers.claude.slots : defaults.providers.claude.slots },
    },
    skills: Array.isArray(stored.skills) && stored.skills.length ? stored.skills : defaults.skills,
  };
  // v0.1 kept the codex slots at the top level.
  if (Array.isArray(stored.modelSlots) && !stored.providers) {
    next.providers.codex.slots = stored.modelSlots;
  }
  delete next.modelSlots;
  return next;
}

function loadSettings() {
  if (settingsCache) return settingsCache;
  const defaults = {
    ...DEFAULT_SETTINGS,
    workspace: app.isPackaged ? app.getPath("documents") : (process.cwd() === "/" ? app.getPath("documents") : process.cwd()),
  };
  try {
    const stored = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
    settingsCache = upgradeSettings(stored, defaults);
  } catch {
    settingsCache = structuredClone(defaults);
  }
  return settingsCache;
}

function saveSettings(next) {
  const current = loadSettings();
  settingsCache = upgradeSettings({ ...current, ...next }, current);
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), `${JSON.stringify(settingsCache, null, 2)}\n`, { mode: 0o600 });
  return settingsCache;
}

function resolveCodexBinary() {
  const configured = loadSettings().codexPath?.trim();
  if (configured) return configured;
  if (process.env.CODEX_PATH) return process.env.CODEX_PATH;
  const candidates = [
    path.join(os.homedir(), ".local", "bin", "codex"),
    path.join(os.homedir(), ".codex", "bin", "codex"),
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
    "/usr/bin/codex",
  ];
  try {
    const fromPath = execFileSync("which", ["codex"], { encoding: "utf8" }).trim();
    if (fromPath) candidates.unshift(fromPath);
  } catch {
    // GUI-launched macOS apps commonly have a minimal PATH; check known locations below.
  }
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Continue to the next candidate.
    }
  }
  return "codex";
}

const agents = {
  codex: new CodexAgent({ getBinary: resolveCodexBinary, getVersion: () => app.getVersion() }),
  claude: new ClaudeAgent({ getSettings: loadSettings }),
};

function broadcast(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

for (const agent of Object.values(agents)) {
  agent.on("event", (event) => broadcast("agent:event", event));
}

const gamepad = new GamepadSource(() => {
  const settings = loadSettings();
  return {
    enabled: settings.controllerEnabled,
    bindings: settings.bindings,
    deadzone: settings.deadzone,
    modelCount: controllerContext.modelCount,
    effortCount: controllerContext.effortCount,
    skillCount: controllerContext.skillCount,
  };
});

gamepad.on("actions", (actions) => {
  // Target switching is main-process state; everything else belongs to the session renderer.
  for (const action of actions) {
    if (action.type === "switchTarget") cycleTarget();
  }
  broadcast("controller:actions", actions);
});
gamepad.on("snapshot", (snapshot) => broadcast("controller:snapshot", snapshot));
gamepad.on("status", (status) => {
  broadcast("controller:status", status);
  publishHudState({ controller: status.connected });
  refreshTrayMenu();
});

const focusTracker = new FocusTracker({ getMode: () => loadSettings().target });

const inputBridge = new InputBridge({
  getSettings: loadSettings,
  // The detected agent, not the resolved target: a manual pin must never make Codicon type into
  // an app that is not actually that agent.
  getFrontApp: () => ({ agent: focusTracker.state.detected, name: focusTracker.state.app }),
  clipboard,
  systemPreferences,
});

function currentTarget() {
  return focusTracker.state;
}

focusTracker.on("change", (state) => {
  broadcast("target:changed", state);
  publishHudState({ target: state.target, targetSource: state.source });
  refreshTrayMenu();
});

function setTarget(target) {
  saveSettings({ target });
  void focusTracker.poll();
  return currentTarget();
}

function cycleTarget() {
  const settings = loadSettings();
  const next = currentTarget().target === "codex" ? "claude" : "codex";
  return setTarget({ ...settings.target, mode: "manual", manual: next });
}

function hardenWindow(window) {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    const currentUrl = window.webContents.getURL();
    if (currentUrl && url !== currentUrl) event.preventDefault();
  });
}

function loadRenderer(window, view) {
  if (process.env.VITE_DEV_SERVER_URL) {
    const url = new URL(process.env.VITE_DEV_SERVER_URL);
    if (view) url.searchParams.set("view", view);
    return window.loadURL(url.href);
  }
  const file = path.join(__dirname, "..", "dist", "index.html");
  return view ? window.loadFile(file, { query: { view } }) : window.loadFile(file);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1040,
    minHeight: 720,
    backgroundColor: "#111416",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The agent session lives in this renderer and keeps streaming while another app owns the
      // foreground, so its timers must not be throttled when hidden.
      backgroundThrottling: false,
    },
  });
  loadRenderer(mainWindow, null);
  hardenWindow(mainWindow);
  // Hide rather than close. The agent threads, their history, and the controller wiring all live
  // in this renderer, so destroying the window would end the sessions that background input exists
  // to keep driving. Only do this when the tray can bring it back.
  mainWindow.on("close", (event) => {
    if (isQuitting || loadSettings().quitOnWindowClose || !tray || tray.isDestroyed()) return;
    event.preventDefault();
    mainWindow.hide();
  });
  // Getting here means the close was deliberately allowed above, so there is no way back to the
  // session and no reason to keep the process (or a lone overlay) running.
  mainWindow.on("closed", () => {
    mainWindow = null;
    if (!isQuitting) {
      isQuitting = true;
      app.quit();
    }
  });
}

function hudDefaultBounds() {
  const { workArea } = screen.getPrimaryDisplay();
  const width = 292;
  const height = 104;
  return {
    width,
    height,
    x: workArea.x + workArea.width - width - 24,
    y: workArea.y + 24,
  };
}

// Keep a stored HUD position usable after a monitor change: if it no longer intersects any
// display, fall back to the default corner rather than opening off-screen.
function hudStartBounds() {
  const stored = loadSettings().hudBounds;
  const fallback = hudDefaultBounds();
  if (!stored || typeof stored.x !== "number" || typeof stored.y !== "number") return fallback;
  const bounds = { ...fallback, x: stored.x, y: stored.y };
  const visible = screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    return bounds.x < area.x + area.width && bounds.x + bounds.width > area.x
      && bounds.y < area.y + area.height && bounds.y + bounds.height > area.y;
  });
  return visible ? bounds : fallback;
}

function overlayWebPreferences() {
  return {
    preload: path.join(__dirname, "preload.cjs"),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    backgroundThrottling: false,
  };
}

function createHud() {
  if (hudWindow && !hudWindow.isDestroyed()) {
    hudWindow.showInactive();
    return hudWindow;
  }
  hudWindow = new BrowserWindow({
    ...hudStartBounds(),
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    hasShadow: false,
    skipTaskbar: true,
    // Never take keyboard focus: the point is that Codex or Claude Code stays focused while the
    // overlay reports what Codicon is doing.
    focusable: false,
    backgroundColor: "#00000000",
    webPreferences: overlayWebPreferences(),
  });
  // "screen-saver" is the level that also floats above macOS fullscreen spaces.
  hudWindow.setAlwaysOnTop(true, "screen-saver");
  hudWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  loadRenderer(hudWindow, "hud");
  hardenWindow(hudWindow);
  // Only remember moves the user made. macOS emits "moved" while the window is still being placed
  // and made visible on all workspaces, and persisting those pins the overlay to a corner of the
  // screen on every later launch.
  let saveMove = null;
  hudWindow.once("ready-to-show", () => {
    hudWindow?.showInactive();
    hudWindow?.on("moved", () => {
      if (!hudWindow || hudWindow.isDestroyed()) return;
      clearTimeout(saveMove);
      saveMove = setTimeout(() => {
        if (!hudWindow || hudWindow.isDestroyed()) return;
        const { x, y } = hudWindow.getBounds();
        saveSettings({ hudBounds: { x, y } });
      }, 400);
    });
  });
  hudWindow.on("closed", () => {
    hudWindow = null;
  });
  return hudWindow;
}

function destroyHud() {
  if (hudWindow && !hudWindow.isDestroyed()) hudWindow.destroy();
  hudWindow = null;
}

// Both the tray checkbox and the Settings panel write hudEnabled, so reconciling the window with
// the stored setting is kept in one place.
function syncHudWindow() {
  if (loadSettings().hudEnabled) createHud();
  else destroyHud();
  refreshTrayMenu();
}

function setHudEnabled(enabled) {
  saveSettings({ hudEnabled: enabled });
  syncHudWindow();
}

function publishHudState(patch) {
  hudState = { ...hudState, ...patch };
  if (hudWindow && !hudWindow.isDestroyed()) hudWindow.webContents.send("hud:state", hudState);
}

// The standalone power-wheel overlay: same design as the in-app wheel, shown centred on the
// display the user is working on, so LB works identically while Codex or Claude Code is frontmost.
function createWheelWindow() {
  if (wheelWindow && !wheelWindow.isDestroyed()) return wheelWindow;
  wheelWindow = new BrowserWindow({
    width: 640,
    height: 640,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    hasShadow: false,
    skipTaskbar: true,
    focusable: false,
    backgroundColor: "#00000000",
    webPreferences: overlayWebPreferences(),
  });
  wheelWindow.setAlwaysOnTop(true, "screen-saver");
  wheelWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Purely visual: clicks pass through to the app underneath.
  wheelWindow.setIgnoreMouseEvents(true);
  loadRenderer(wheelWindow, "wheel");
  hardenWindow(wheelWindow);
  wheelWindow.on("closed", () => {
    wheelWindow = null;
  });
  return wheelWindow;
}

function centerWheelOnActiveDisplay() {
  if (!wheelWindow || wheelWindow.isDestroyed()) return;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const [width, height] = wheelWindow.getSize();
  wheelWindow.setPosition(
    Math.round(display.workArea.x + (display.workArea.width - width) / 2),
    Math.round(display.workArea.y + (display.workArea.height - height) / 2),
  );
}

function publishWheelState(state) {
  wheelState = state || { open: false };
  if (!wheelWindow || wheelWindow.isDestroyed()) return;
  wheelWindow.webContents.send("wheel:state", wheelState);
  // The overlay only appears when the main window cannot show the wheel itself.
  const mainVisible = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && mainWindow.isFocused();
  if (wheelState.open && !mainVisible) {
    centerWheelOnActiveDisplay();
    wheelWindow.showInactive();
  } else if (!wheelState.open && wheelWindow.isVisible()) {
    wheelWindow.hide();
  }
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  else {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
}

function refreshTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  const status = gamepad.status;
  const settings = loadSettings();
  const target = currentTarget();
  const controllerLine = !status.available
    ? `Controller: unavailable (${status.reason || "unknown"})`
    : status.connected
      ? `Controller: ${status.id || "connected"}`
      : "Controller: waiting for a gamepad";
  const targetLine = `Target: ${target.target.toUpperCase()} (${target.source})`;
  tray.setToolTip(`Codicon — ${targetLine}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: controllerLine, enabled: false },
    { label: targetLine, enabled: false },
    { type: "separator" },
    {
      label: "Target: Auto (follow focus)",
      type: "radio",
      checked: settings.target.mode === "auto",
      click: () => setTarget({ ...settings.target, mode: "auto" }),
    },
    {
      label: "Target: Codex",
      type: "radio",
      checked: settings.target.mode === "manual" && settings.target.manual === "codex",
      click: () => setTarget({ mode: "manual", manual: "codex" }),
    },
    {
      label: "Target: Claude Code",
      type: "radio",
      checked: settings.target.mode === "manual" && settings.target.manual === "claude",
      click: () => setTarget({ mode: "manual", manual: "claude" }),
    },
    { type: "separator" },
    { label: "Open Codicon", click: () => showMainWindow() },
    {
      label: "Show status overlay",
      type: "checkbox",
      checked: Boolean(settings.hudEnabled),
      click: (item) => setHudEnabled(item.checked),
    },
    { type: "separator" },
    {
      label: "Quit Codicon",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]));
}

function createTray() {
  if (tray && !tray.isDestroyed()) return tray;
  // Generated from build/icon.png; electron-builder only ships electron/** and dist/**, so the
  // runtime icon has to live next to this file rather than in build/.
  const icon = nativeImage.createFromPath(path.join(__dirname, "tray.png"));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.on("click", () => showMainWindow());
  refreshTrayMenu();
  return tray;
}

function agentFor(provider) {
  const agent = agents[provider];
  if (!agent) throw new Error(`Unknown agent provider: ${provider}`);
  return agent;
}

function registerIpc() {
  ipcMain.handle("codicon:bootstrap", async () => {
    const settings = loadSettings();
    const context = { workspace: settings.workspace };
    const [codex, claude] = await Promise.all([
      agents.codex.bootstrap(context),
      agents.claude.bootstrap(context),
    ]);
    return {
      platform: process.platform,
      version: app.getVersion(),
      codexPath: resolveCodexBinary(),
      settings,
      providers: { codex, claude },
    };
  });

  ipcMain.handle("codicon:choose-workspace", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "ワークスペースを選択",
      defaultPath: loadSettings().workspace,
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    saveSettings({ workspace: result.filePaths[0] });
    return result.filePaths[0];
  });

  ipcMain.handle("codicon:get-settings", () => loadSettings());
  ipcMain.handle("codicon:save-settings", (_event, next) => {
    const saved = saveSettings(next || {});
    syncHudWindow();
    void focusTracker.poll();
    return saved;
  });
  ipcMain.handle("codicon:restart-server", async () => {
    agents.codex.stop();
    agents.claude.stop();
    await agents.codex.ensureStarted();
    return true;
  });

  ipcMain.handle("agent:start-thread", (_event, { provider, ...payload }) => {
    const settings = loadSettings();
    return agentFor(provider).startThread({ ...payload, cwd: settings.workspace, permissionMode: settings.permissionMode });
  });
  ipcMain.handle("agent:send", (_event, { provider, ...payload }) => agentFor(provider).sendMessage(payload));
  ipcMain.handle("agent:update-power", (_event, { provider, ...payload }) => agentFor(provider).updatePower(payload));
  ipcMain.handle("agent:interrupt", (_event, { provider, ...payload }) => agentFor(provider).interrupt(payload));
  ipcMain.handle("agent:respond", (_event, { provider, ...payload }) => agentFor(provider).respond(payload));
  ipcMain.handle("agent:resume-thread", (_event, { provider, threadId }) => agentFor(provider).resumeThread(threadId));
  ipcMain.handle("agent:close-thread", (_event, { provider, threadId }) => agentFor(provider).closeThread(threadId));
  ipcMain.handle("agent:list-threads", (_event, provider) => agentFor(provider).listThreads());
  ipcMain.handle("agent:voice-start", (_event, { provider, threadId }) => agentFor(provider).voiceStart(threadId));
  ipcMain.handle("agent:voice-audio", (_event, { provider, ...payload }) => agentFor(provider).voiceAudio(payload));
  ipcMain.handle("agent:voice-stop", (_event, { provider, threadId }) => agentFor(provider).voiceStop(threadId));

  ipcMain.handle("codicon:get-target", () => currentTarget());
  ipcMain.handle("codicon:set-target", (_event, target) => setTarget(target));
  ipcMain.handle("codicon:cycle-target", () => cycleTarget());

  ipcMain.handle("codicon:direct-status", () => inputBridge.status());
  ipcMain.handle("codicon:request-accessibility", () => {
    // Opens the standard macOS prompt; the user grants it in System Settings.
    inputBridge.isTrusted(true);
    return inputBridge.status();
  });
  ipcMain.handle("codicon:direct-dispatch", (_event, { provider, action, value }) => {
    const plan = planKeystrokes({ provider, action, value });
    const result = inputBridge.dispatch(plan, { provider });
    broadcast("direct:result", result);
    return result;
  });

  ipcMain.handle("codicon:controller-status", () => gamepad.status);
  ipcMain.on("codicon:set-controller-context", (_event, context) => {
    controllerContext = {
      modelCount: Math.max(1, Number(context?.modelCount) || controllerContext.modelCount),
      effortCount: Math.max(1, Number(context?.effortCount) || controllerContext.effortCount),
      skillCount: Math.max(1, Number(context?.skillCount) || controllerContext.skillCount),
    };
  });
  ipcMain.on("codicon:publish-hud-state", (_event, patch) => publishHudState(patch || {}));
  ipcMain.handle("codicon:hud-state", () => hudState);
  ipcMain.handle("codicon:set-hud-enabled", (_event, enabled) => {
    setHudEnabled(Boolean(enabled));
    return Boolean(enabled);
  });
  ipcMain.on("codicon:publish-wheel-state", (_event, state) => publishWheelState(state));
  ipcMain.on("codicon:show-main-window", () => showMainWindow());
}

app.whenReady().then(() => {
  const isTrustedRenderer = (webContents) => {
    const url = webContents?.getURL() || "";
    return url.startsWith("file://") || url.startsWith("http://127.0.0.1:5173/");
  };
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => permission === "media" && isTrustedRenderer(webContents));
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(isTrustedRenderer(webContents) && permission === "media" && details.mediaTypes?.includes("audio"));
  });
  registerIpc();
  createWindow();
  createTray();
  createWheelWindow();
  if (loadSettings().hudEnabled) createHud();
  focusTracker.start();
  // Loading SDL takes a moment and is not needed to draw the first frame, so it starts after the
  // window exists. A failure here only means no controller input.
  void gamepad.start().then(refreshTrayMenu);
  app.on("activate", () => {
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
    else showMainWindow();
  });
});

app.on("before-quit", () => {
  isQuitting = true;
  gamepad.stop();
  focusTracker.stop();
  agents.codex.stop();
  agents.claude.stop();
  destroyHud();
  if (wheelWindow && !wheelWindow.isDestroyed()) wheelWindow.destroy();
  wheelWindow = null;
  if (tray && !tray.isDestroyed()) tray.destroy();
  tray = null;
});

// Reached only when nothing can bring Codicon back — no tray, or the user opted into
// quitOnWindowClose. Staying alive then would leave an invisible process holding live sessions.
app.on("window-all-closed", () => {
  agents.codex.stop();
  agents.claude.stop();
  app.quit();
});
