const { app, BrowserWindow, dialog, ipcMain, session } = require("electron");
const { spawn, execFileSync } = require("node:child_process");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");

const DEFAULT_SETTINGS = {
  workspace: "",
  codexPath: "",
  controllerEnabled: true,
  deadzone: 0.42,
  permissionMode: "auto",
  modelSlots: [
    { key: "sol", label: "SOL", modelId: "gpt-5.6-sol", color: "#ff7a59" },
    { key: "terra", label: "TERRA", modelId: "gpt-5.6-terra", color: "#9bd6bd" },
    { key: "luna", label: "LUNA", modelId: "gpt-5.6-luna", color: "#9ba7ff" },
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
  },
};

class CodexBridge extends EventEmitter {
  constructor(getBinary) {
    super();
    this.getBinary = getBinary;
    this.proc = null;
    this.pending = new Map();
    this.requestId = 1;
    this.starting = null;
    this.ready = false;
  }

  async start() {
    if (this.ready && this.proc) return;
    if (this.starting) return this.starting;
    this.starting = new Promise((resolve, reject) => {
      const binary = this.getBinary();
      const proc = spawn(binary, ["app-server", "--stdio", "--enable", "realtime_conversation"], {
        cwd: process.cwd(),
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      this.proc = proc;
      let settled = false;
      const fail = (error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      };
      proc.once("error", (error) => fail(new Error(`Codex CLI を起動できません: ${error.message}`)));
      proc.stderr.setEncoding("utf8");
      proc.stderr.on("data", (chunk) => this.emit("log", String(chunk)));
      const rl = readline.createInterface({ input: proc.stdout });
      rl.on("line", (line) => this.handleLine(line));
      proc.on("exit", (code, signal) => {
        const error = new Error(`Codex app-server が終了しました (code=${code}, signal=${signal || "none"})`);
        this.ready = false;
        this.proc = null;
        for (const { reject: rejectPending, timer } of this.pending.values()) {
          clearTimeout(timer);
          rejectPending(error);
        }
        this.pending.clear();
        this.emit("exit", { code, signal });
        fail(error);
      });
      this.request("initialize", {
        clientInfo: { name: "codicon", title: "Codicon", version: app.getVersion() },
        capabilities: { experimentalApi: true },
      }, 20000)
        .then(() => {
          this.notify("initialized");
          this.ready = true;
          settled = true;
          resolve();
        })
        .catch(fail);
    }).finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.emit("log", `Invalid app-server JSON: ${line}`);
      return;
    }
    if (Object.prototype.hasOwnProperty.call(message, "id") && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
      else pending.resolve(message.result);
      return;
    }
    if (Object.prototype.hasOwnProperty.call(message, "id") && message.method) {
      if (message.method === "currentTime/read") {
        this.respond(message.id, { currentTimeAt: Math.floor(Date.now() / 1000) });
        return;
      }
      if (message.method === "account/chatgptAuthTokens/refresh" || message.method === "attestation/generate") {
        this.respondError(message.id, -32601, `${message.method} is not provided by Codicon`);
        return;
      }
      this.emit("server-request", message);
      return;
    }
    if (message.method) this.emit("notification", message);
  }

  send(message) {
    if (!this.proc?.stdin?.writable) throw new Error("Codex app-server に接続されていません");
    this.proc.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params = {}, timeoutMs = 30000) {
    const id = this.requestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} が ${timeoutMs / 1000} 秒でタイムアウトしました`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ method, id, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  notify(method, params) {
    this.send(params === undefined ? { method } : { method, params });
  }

  respond(id, result) {
    this.send({ id, result });
  }

  respondError(id, code, message) {
    this.send({ id, error: { code, message } });
  }

  stop() {
    if (this.proc && !this.proc.killed) this.proc.kill("SIGTERM");
    this.proc = null;
    this.ready = false;
  }
}

let mainWindow = null;
let settingsCache = null;

function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function loadSettings() {
  if (settingsCache) return settingsCache;
  const defaults = {
    ...DEFAULT_SETTINGS,
    workspace: app.isPackaged ? app.getPath("documents") : (process.cwd() === "/" ? app.getPath("documents") : process.cwd()),
  };
  try {
    const stored = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
    settingsCache = {
      ...defaults,
      ...stored,
      bindings: { ...defaults.bindings, ...(stored.bindings || {}) },
      modelSlots: Array.isArray(stored.modelSlots) ? stored.modelSlots : defaults.modelSlots,
    };
  } catch {
    settingsCache = structuredClone(defaults);
  }
  return settingsCache;
}

function saveSettings(next) {
  const current = loadSettings();
  settingsCache = {
    ...current,
    ...next,
    bindings: { ...current.bindings, ...(next.bindings || {}) },
  };
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

const bridge = new CodexBridge(resolveCodexBinary);

function broadcast(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

bridge.on("notification", (message) => broadcast("codex:event", { kind: "notification", ...message }));
bridge.on("server-request", (message) => broadcast("codex:event", { kind: "request", ...message }));
bridge.on("log", (message) => broadcast("codex:event", { kind: "log", message }));
bridge.on("exit", (details) => broadcast("codex:event", { kind: "exit", details }));

function permissionSettings(mode, workspace) {
  if (mode === "read-only") {
    return { approvalPolicy: "on-request", sandbox: "read-only" };
  }
  if (mode === "full") {
    return { approvalPolicy: "on-request", sandbox: "danger-full-access" };
  }
  return { approvalPolicy: "on-request", sandbox: "workspace-write", cwd: workspace };
}

async function ensureBridge() {
  await bridge.start();
}

function registerIpc() {
  ipcMain.handle("codicon:bootstrap", async () => {
    await ensureBridge();
    const safe = async (method, params = {}) => {
      try {
        return await bridge.request(method, params);
      } catch (error) {
        return { error: error.message };
      }
    };
    const [models, account, config, threads] = await Promise.all([
      safe("model/list", { includeHidden: false, limit: 100 }),
      safe("account/read", { refreshToken: false }),
      safe("config/read", { includeLayers: false, cwd: loadSettings().workspace }),
      safe("thread/list", { limit: 30, sortKey: "recency_at", sortDirection: "desc" }),
    ]);
    return {
      platform: process.platform,
      version: app.getVersion(),
      codexPath: resolveCodexBinary(),
      settings: loadSettings(),
      models,
      account,
      config,
      threads,
    };
  });

  ipcMain.handle("codicon:choose-workspace", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Codex のワークスペースを選択",
      defaultPath: loadSettings().workspace,
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    saveSettings({ workspace: result.filePaths[0] });
    return result.filePaths[0];
  });

  ipcMain.handle("codicon:get-settings", () => loadSettings());
  ipcMain.handle("codicon:save-settings", (_event, next) => saveSettings(next || {}));
  ipcMain.handle("codicon:restart-server", async () => {
    bridge.stop();
    await ensureBridge();
    return true;
  });
  ipcMain.handle("codicon:start-thread", async (_event, options) => {
    await ensureBridge();
    const settings = loadSettings();
    const workspace = options?.cwd || settings.workspace;
    const security = permissionSettings(settings.permissionMode, workspace);
    const result = await bridge.request("thread/start", {
      model: options?.model || null,
      serviceTier: options?.serviceTier || null,
      cwd: workspace,
      approvalPolicy: security.approvalPolicy,
      sandbox: security.sandbox,
    });
    if (options?.effort && result?.thread?.id) {
      await bridge.request("thread/settings/update", {
        threadId: result.thread.id,
        model: options.model,
        effort: options.effort,
        serviceTier: options.serviceTier || null,
      });
    }
    return result;
  });
  ipcMain.handle("codicon:resume-thread", async (_event, threadId) => {
    await ensureBridge();
    return bridge.request("thread/resume", { threadId });
  });
  ipcMain.handle("codicon:list-threads", async () => {
    await ensureBridge();
    return bridge.request("thread/list", { limit: 30, sortKey: "recency_at", sortDirection: "desc" });
  });
  ipcMain.handle("codicon:send-message", async (_event, payload) => {
    await ensureBridge();
    const input = [{ type: "text", text: payload.text, text_elements: [] }];
    if (payload.activeTurnId) {
      return bridge.request("turn/steer", {
        threadId: payload.threadId,
        expectedTurnId: payload.activeTurnId,
        input,
      });
    }
    return bridge.request("turn/start", {
      threadId: payload.threadId,
      input,
      model: payload.model || null,
      effort: payload.effort || null,
      serviceTier: payload.serviceTier || null,
    });
  });
  ipcMain.handle("codicon:update-power", async (_event, payload) => {
    await ensureBridge();
    if (!payload.threadId) return {};
    return bridge.request("thread/settings/update", {
      threadId: payload.threadId,
      model: payload.model,
      effort: payload.effort,
      serviceTier: payload.serviceTier || null,
    });
  });
  ipcMain.handle("codicon:interrupt", async (_event, payload) => {
    await ensureBridge();
    return bridge.request("turn/interrupt", { threadId: payload.threadId, turnId: payload.turnId });
  });
  ipcMain.handle("codicon:respond", async (_event, payload) => {
    await ensureBridge();
    bridge.respond(payload.id, payload.result);
    return true;
  });
  ipcMain.handle("codicon:voice-start", async (_event, threadId) => {
    await ensureBridge();
    return bridge.request("thread/realtime/start", {
      threadId,
      outputModality: "text",
      includeStartupContext: true,
      flushTranscriptTailOnSessionEnd: true,
      version: "v1",
    }, 45000);
  });
  ipcMain.handle("codicon:voice-audio", async (_event, payload) => {
    await ensureBridge();
    return bridge.request("thread/realtime/appendAudio", {
      threadId: payload.threadId,
      audio: payload.audio,
    });
  });
  ipcMain.handle("codicon:voice-stop", async (_event, threadId) => {
    await ensureBridge();
    return bridge.request("thread/realtime/stop", { threadId }, 45000);
  });
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
    },
  });
  if (process.env.VITE_DEV_SERVER_URL) mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  else mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const currentUrl = mainWindow?.webContents.getURL();
    if (currentUrl && url !== currentUrl) event.preventDefault();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
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
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  bridge.stop();
  if (process.platform !== "darwin") app.quit();
});
