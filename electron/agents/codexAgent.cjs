// Codex backend, spoken through the official `codex app-server` JSONL protocol.
//
// This file owns everything Codex-specific: the child process, the JSON-RPC framing, and the
// translation of app-server notifications into the provider-neutral events the renderer consumes
// (see src/types/agent.ts for the schema). The renderer never sees a raw app-server message, which
// is what lets one UI drive both Codex and Claude Code.
//
// The translation functions are pure and exported for unit tests.

const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");
const readline = require("node:readline");

const APPROVAL_METHODS = [
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
  "execCommandApproval",
  "applyPatchApproval",
];

const ACTIVITY_TITLES = {
  commandExecution: "COMMAND",
  fileChange: "FILES",
  mcpToolCall: "TOOL",
  webSearch: "SEARCH",
  collabAgentToolCall: "ULTRA AGENT",
};

/** Translate one app-server notification into zero or more provider-neutral events. */
function normalizeCodexNotification(message) {
  const params = message.params || {};
  switch (message.method) {
    case "turn/started": {
      const turn = params.turn || {};
      return turn.id ? [{ kind: "turn-started", turnId: turn.id }] : [];
    }
    case "turn/completed":
      return [{ kind: "turn-completed" }];
    case "item/agentMessage/delta":
      return [{ kind: "message-delta", itemId: String(params.itemId || "agent-stream"), delta: String(params.delta || "") }];
    case "item/started":
    case "item/completed": {
      const item = params.item;
      if (!item || !item.id || !item.type) return [];
      const done = message.method === "item/completed";
      if (item.type === "agentMessage") {
        return done ? [{ kind: "message-completed", itemId: String(item.id), text: String(item.text || "") }] : [];
      }
      if (Object.prototype.hasOwnProperty.call(ACTIVITY_TITLES, item.type)) {
        const detail = String(
          item.command || item.tool || item.server ||
          (item.type === "fileChange" ? `${(item.changes || []).length} changes` : item.type),
        );
        return [{
          kind: "activity",
          id: String(item.id),
          type: String(item.type),
          title: ACTIVITY_TITLES[item.type],
          detail,
          status: done ? "completed" : "running",
        }];
      }
      return [];
    }
    case "thread/realtime/started":
      return [{ kind: "voice-started" }];
    case "thread/realtime/transcript/delta":
      return params.role === "user" ? [{ kind: "voice-transcript-delta", delta: String(params.delta || "") }] : [];
    case "thread/realtime/transcript/done":
      return params.role === "user" ? [{ kind: "voice-transcript-done", text: String(params.text || "") }] : [];
    case "thread/realtime/closed":
      return [{ kind: "voice-closed" }];
    case "thread/realtime/error":
      return [{ kind: "voice-error", message: String(params.message || "音声セッションでエラーが発生しました") }];
    case "error":
      return [{ kind: "error", message: String(params.message || "Codex でエラーが発生しました") }];
    default:
      return [];
  }
}

/**
 * Classify a server-initiated request.
 * @returns {{ action: "approval", event: object } | { action: "question", event: object }
 *         | { action: "respond", result: object } | { action: "reject", code: number, message: string }}
 */
function classifyCodexRequest(message) {
  const params = message.params || {};
  if (message.method === "item/tool/requestUserInput") {
    return { action: "question", event: { kind: "question", id: message.id, questions: params.questions || [] } };
  }
  if (APPROVAL_METHODS.includes(message.method || "")) {
    const method = message.method;
    // A permissions grant must show WHAT is being granted; approving an unseen permissions object
    // would be a blind escalation.
    const command = typeof params.command === "string"
      ? params.command
      : method === "item/permissions/requestApproval" && params.permissions
        ? JSON.stringify(params.permissions, null, 1)
        : "Codex が操作の許可を求めています";
    return {
      action: "approval",
      event: {
        kind: "approval",
        id: message.id,
        title: method.includes("fileChange") ? "ファイル変更の承認" : method.includes("permissions") ? "追加権限の承認" : "コマンド実行の承認",
        command,
        reason: typeof params.reason === "string" ? params.reason : "この操作は現在の安全設定の外側にあります。",
      },
    };
  }
  if (message.method === "mcpServer/elicitation/request") {
    return { action: "respond", result: { action: "cancel", content: null, _meta: null } };
  }
  if (message.method === "item/tool/call") {
    return {
      action: "respond",
      result: { contentItems: [{ type: "inputText", text: "Codicon does not expose client-side dynamic tools." }], success: false },
    };
  }
  return { action: "reject", code: -32601, message: `${message.method} is not supported by Codicon` };
}

/** Normalize a codex model/list entry to the provider-neutral model shape. */
function normalizeCodexModel(entry) {
  return {
    id: entry.id,
    model: entry.model,
    displayName: entry.displayName,
    description: entry.description || "",
    efforts: (entry.supportedReasoningEfforts || []).map((option) => ({
      id: option.reasoningEffort,
      description: option.description || option.reasoningEffort,
    })),
    defaultEffort: entry.defaultReasoningEffort || null,
    tiers: (entry.serviceTiers || []).map((tier) => ({ id: tier.id, name: tier.name })),
    defaultTier: entry.defaultServiceTier || null,
    isDefault: Boolean(entry.isDefault),
  };
}

/** Extract plain chat messages from a thread/resume response. */
function messagesFromCodexThread(response) {
  const thread = response?.thread;
  const output = [];
  for (const turn of thread?.turns || []) {
    for (const item of turn.items || []) {
      if (item.type === "userMessage") {
        const text = Array.isArray(item.content)
          ? item.content.filter((part) => part && part.type === "text").map((part) => part.text).join("\n")
          : "";
        output.push({ id: String(item.id), role: "user", text });
      }
      if (item.type === "agentMessage") output.push({ id: String(item.id), role: "assistant", text: String(item.text || "") });
    }
  }
  return output;
}

function permissionSettings(mode, workspace) {
  if (mode === "read-only") return { approvalPolicy: "on-request", sandbox: "read-only" };
  if (mode === "full") return { approvalPolicy: "on-request", sandbox: "danger-full-access" };
  return { approvalPolicy: "on-request", sandbox: "workspace-write", cwd: workspace };
}

class CodexAgent extends EventEmitter {
  /**
   * @param {{ getBinary: () => string, getVersion: () => string }} options
   */
  constructor(options) {
    super();
    this.id = "codex";
    this.capabilities = { voice: true, steer: true, fastTier: true, question: true, liveEffort: true };
    this.getBinary = options.getBinary;
    this.getVersion = options.getVersion;
    this.proc = null;
    this.pending = new Map();
    this.requestId = 1;
    this.starting = null;
    this.ready = false;
    // Approval requests need their original method to build the right response shape later.
    this.openRequests = new Map();
  }

  emitEvent(event) {
    this.emit("event", { provider: this.id, ...event });
  }

  async ensureStarted() {
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
      proc.stderr.on("data", (chunk) => this.emitEvent({ kind: "log", message: String(chunk) }));
      const rl = readline.createInterface({ input: proc.stdout });
      // Both handlers guard on identity: after a restart, the SIGTERMed server's exit (and any
      // final output) arrives asynchronously and must not clobber the replacement's state — the
      // old exit used to reject the NEW server's pending initialize and null the live proc.
      rl.on("line", (line) => {
        if (this.proc === proc) this.handleLine(line);
      });
      proc.on("exit", (code, signal) => {
        rl.close();
        const error = new Error(`Codex app-server が終了しました (code=${code}, signal=${signal || "none"})`);
        if (this.proc === proc) {
          this.ready = false;
          this.proc = null;
          for (const { reject: rejectPending, timer } of this.pending.values()) {
            clearTimeout(timer);
            rejectPending(error);
          }
          this.pending.clear();
          this.openRequests.clear();
          this.emitEvent({ kind: "status", state: "exit", detail: error.message });
        }
        // Unconditional: a start whose own process died must still reject.
        fail(error);
      });
      this.request("initialize", {
        clientInfo: { name: "codicon", title: "Codicon", version: this.getVersion() },
        capabilities: { experimentalApi: true },
      }, 20000)
        .then(() => {
          this.notify("initialized");
          this.ready = true;
          settled = true;
          this.emitEvent({ kind: "status", state: "ready" });
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
      this.emitEvent({ kind: "log", message: `Invalid app-server JSON: ${line}` });
      return;
    }
    const hasId = Object.prototype.hasOwnProperty.call(message, "id");
    if (hasId && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
      else pending.resolve(message.result);
      return;
    }
    if (hasId && message.method) {
      if (message.method === "currentTime/read") {
        this.respondRaw(message.id, { currentTimeAt: Math.floor(Date.now() / 1000) });
        return;
      }
      if (message.method === "account/chatgptAuthTokens/refresh" || message.method === "attestation/generate") {
        this.respondError(message.id, -32601, `${message.method} is not provided by Codicon`);
        return;
      }
      const classified = classifyCodexRequest(message);
      if (classified.action === "respond") {
        this.respondRaw(message.id, classified.result);
      } else if (classified.action === "reject") {
        // The original renderer left unknown requests unanswered, which stalls the server's turn
        // forever. Refusing explicitly lets Codex continue and report the failure in-band.
        this.respondError(message.id, classified.code, classified.message);
        this.emitEvent({ kind: "error", message: `未対応の Codex リクエストを拒否しました: ${message.method}` });
      } else {
        this.openRequests.set(message.id, { method: message.method, params: message.params || {} });
        const threadId = message.params?.threadId;
        this.emitEvent(threadId ? { ...classified.event, threadId } : classified.event);
      }
      return;
    }
    if (message.method) {
      // app-server scopes thread events with threadId in params; carry it through so the renderer
      // can route each event to the right chat now that several run at once.
      const threadId = message.params?.threadId;
      for (const event of normalizeCodexNotification(message)) {
        this.emitEvent(threadId ? { ...event, threadId } : event);
      }
    }
  }

  writeMessage(message) {
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
        this.writeMessage({ method, id, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  notify(method, params) {
    this.writeMessage(params === undefined ? { method } : { method, params });
  }

  respondRaw(id, result) {
    this.writeMessage({ id, result });
  }

  respondError(id, code, message) {
    this.writeMessage({ id, error: { code, message } });
  }

  async bootstrap(context) {
    try {
      await this.ensureStarted();
    } catch (error) {
      return { available: false, reason: error instanceof Error ? error.message : String(error), models: [], threads: [], accountLabel: "" };
    }
    const safe = async (method, params, fallback) => {
      try {
        return await this.request(method, params);
      } catch {
        return fallback;
      }
    };
    const [models, account, threads] = await Promise.all([
      safe("model/list", { includeHidden: false, limit: 100 }, { data: [] }),
      safe("account/read", { refreshToken: false }, {}),
      safe("thread/list", { limit: 30, sortKey: "recency_at", sortDirection: "desc" }, { data: [] }),
    ]);
    const accountInfo = account?.account || {};
    return {
      available: true,
      models: (models?.data || []).map(normalizeCodexModel),
      threads: threads?.data || [],
      accountLabel: accountInfo.email || accountInfo.type || "CHATGPT",
      workspace: context?.workspace || "",
    };
  }

  async startThread({ model, effort, tier, cwd, permissionMode }) {
    await this.ensureStarted();
    const security = permissionSettings(permissionMode, cwd);
    const result = await this.request("thread/start", {
      model: model || null,
      serviceTier: tier || null,
      cwd,
      approvalPolicy: security.approvalPolicy,
      sandbox: security.sandbox,
    });
    const threadId = result?.thread?.id;
    if (!threadId) throw new Error("Codex スレッドを開始できませんでした");
    if (effort) {
      await this.request("thread/settings/update", { threadId, model, effort, serviceTier: tier || null });
    }
    return { threadId };
  }

  async sendMessage({ threadId, activeTurnId, text, model, effort, tier }) {
    await this.ensureStarted();
    const input = [{ type: "text", text, text_elements: [] }];
    if (activeTurnId) {
      const result = await this.request("turn/steer", { threadId, expectedTurnId: activeTurnId, input });
      return { turnId: result?.turn?.id || activeTurnId };
    }
    const result = await this.request("turn/start", {
      threadId,
      input,
      model: model || null,
      effort: effort || null,
      serviceTier: tier || null,
    });
    return { turnId: result?.turn?.id || null };
  }

  async updatePower({ threadId, model, effort, tier }) {
    if (!threadId) return {};
    await this.ensureStarted();
    return this.request("thread/settings/update", { threadId, model, effort, serviceTier: tier || null });
  }

  async interrupt({ threadId, turnId }) {
    await this.ensureStarted();
    return this.request("turn/interrupt", { threadId, turnId });
  }

  /**
   * Answer an approval or question surfaced earlier.
   * @param {{ id: number|string, decision?: string, answers?: Record<string,string> }} payload
   */
  async respond(payload) {
    const open = this.openRequests.get(payload.id);
    this.openRequests.delete(payload.id);
    if (!open) throw new Error("応答対象のリクエストが見つかりません");
    if (open.method === "item/tool/requestUserInput") {
      const answers = Object.fromEntries(
        Object.entries(payload.answers || {}).map(([questionId, answer]) => [questionId, { answers: [answer] }]),
      );
      this.respondRaw(payload.id, { answers });
      return true;
    }
    const decision = payload.decision || "decline";
    if (open.method === "item/permissions/requestApproval") {
      const granted = decision === "accept" || decision === "acceptForSession";
      this.respondRaw(payload.id, {
        permissions: granted ? open.params.permissions || {} : {},
        scope: decision === "acceptForSession" ? "session" : "turn",
      });
      return true;
    }
    this.respondRaw(payload.id, { decision });
    return true;
  }

  /**
   * Codex threads live in the app-server, not in this process, so closing a chat only drops our
   * interest in it — the thread stays resumable from the history rail.
   */
  async closeThread() {
    return true;
  }

  async resumeThread(threadId) {
    await this.ensureStarted();
    const result = await this.request("thread/resume", { threadId });
    return { threadId, messages: messagesFromCodexThread(result) };
  }

  async listThreads() {
    await this.ensureStarted();
    const result = await this.request("thread/list", { limit: 30, sortKey: "recency_at", sortDirection: "desc" });
    return { data: result?.data || [] };
  }

  async voiceStart(threadId) {
    await this.ensureStarted();
    return this.request("thread/realtime/start", {
      threadId,
      outputModality: "text",
      includeStartupContext: true,
      flushTranscriptTailOnSessionEnd: true,
      version: "v1",
    }, 45000);
  }

  async voiceAudio({ threadId, audio }) {
    await this.ensureStarted();
    return this.request("thread/realtime/appendAudio", { threadId, audio });
  }

  async voiceStop(threadId) {
    await this.ensureStarted();
    return this.request("thread/realtime/stop", { threadId }, 45000);
  }

  stop() {
    const proc = this.proc;
    // Detach first: the exit-handler guard compares against this.proc, so nulling it here makes
    // the dying process's exit a no-op instead of a reset of the replacement's state.
    this.proc = null;
    this.ready = false;
    const error = new Error("Codex app-server を停止しました");
    for (const { reject: rejectPending, timer } of this.pending.values()) {
      clearTimeout(timer);
      rejectPending(error);
    }
    this.pending.clear();
    this.openRequests.clear();
    if (proc && !proc.killed) proc.kill("SIGTERM");
  }
}

module.exports = {
  CodexAgent,
  classifyCodexRequest,
  messagesFromCodexThread,
  normalizeCodexModel,
  normalizeCodexNotification,
};
