// Claude Code backend, driven through the official Claude Agent SDK.
//
// Each Codicon thread is one long-lived SDK `query()` in streaming-input mode. Streaming input is
// not an implementation detail: the SDK only honours control requests — interrupt, setModel,
// applyFlagSettings — on streaming-input sessions, and those are exactly the operations the
// controller performs mid-turn. The SDK spawns its own bundled `claude` binary, which shares the
// user's existing `claude login`; no API key is involved.
//
// `normalizeClaudeMessage` translates SDK messages into the same provider-neutral events the Codex
// adapter emits, so the renderer cannot tell the two backends apart. It is pure over an explicit
// per-thread state object and exported for unit tests.

const { randomUUID } = require("node:crypto");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Claude has no service tiers; this pseudo-tier id maps the controller's speed toggle onto the
// CLI's fast-mode flag setting.
const FAST_TIER = { id: "fast", name: "Fast" };
const DEFAULT_EFFORTS = ["low", "medium", "high", "xhigh", "max"];

const TOOL_TITLES = [
  [/^Bash$/i, { title: "COMMAND", type: "commandExecution", detail: (input) => String(input.command || "") }],
  [/^(Edit|Write|MultiEdit|NotebookEdit)$/i, { title: "FILES", type: "fileChange", detail: (input) => String(input.file_path || input.notebook_path || "") }],
  [/^(WebSearch|WebFetch)$/i, { title: "SEARCH", type: "webSearch", detail: (input) => String(input.query || input.url || "") }],
  [/^(Task|Agent)$/i, { title: "AGENT", type: "collabAgentToolCall", detail: (input) => String(input.description || input.prompt || "").slice(0, 80) }],
  [/^(Read|Grep|Glob)$/i, { title: "READ", type: "read", detail: (input) => String(input.file_path || input.pattern || "") }],
];

function describeTool(name, input) {
  for (const [pattern, spec] of TOOL_TITLES) {
    if (pattern.test(name)) return { title: spec.title, type: spec.type, detail: spec.detail(input || {}) || name };
  }
  const summary = JSON.stringify(input || {});
  return { title: "TOOL", type: "mcpToolCall", detail: `${name} ${summary.length > 80 ? `${summary.slice(0, 77)}…` : summary}` };
}

function createThreadState(prefix) {
  // The prefix keeps message item ids unique across threads: the renderer keeps old messages on
  // screen across a resume, so a bare per-thread counter would collide with ids it still holds.
  return { prefix: prefix || randomUUID().slice(0, 8), streamCounter: 0, streamOpen: false };
}

function currentStreamId(state) {
  return `claude-${state.prefix}-${state.streamCounter}`;
}

/**
 * Translate one SDK message into provider-neutral events, threading per-conversation stream state.
 * Mutates `state` (stream id bookkeeping) by design — the caller owns one state per thread.
 */
function normalizeClaudeMessage(message, state) {
  switch (message.type) {
    case "stream_event": {
      // Nested/subagent streams carry parent_tool_use_id; the top-level transcript does not.
      if (message.parent_tool_use_id) return [];
      const event = message.event || {};
      if (event.type === "message_start") {
        if (state.streamOpen) state.streamCounter += 1;
        state.streamOpen = true;
        return [];
      }
      if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
        if (!state.streamOpen) {
          state.streamOpen = true;
        }
        return [{ kind: "message-delta", itemId: currentStreamId(state), delta: String(event.delta.text || "") }];
      }
      return [];
    }
    case "assistant": {
      if (message.parent_tool_use_id) return [];
      const blocks = Array.isArray(message.message?.content) ? message.message.content : [];
      const events = [];
      const text = blocks.filter((block) => block.type === "text").map((block) => block.text).join("");
      if (text) {
        events.push({ kind: "message-completed", itemId: currentStreamId(state), text });
        state.streamCounter += 1;
        state.streamOpen = false;
      }
      for (const block of blocks) {
        if (block.type !== "tool_use") continue;
        const described = describeTool(String(block.name || "tool"), block.input);
        events.push({ kind: "activity", id: String(block.id), type: described.type, title: described.title, detail: described.detail, status: "running" });
      }
      return events;
    }
    case "user": {
      // Synthetic user messages deliver tool results; use them to close the matching activity.
      const blocks = Array.isArray(message.message?.content) ? message.message.content : [];
      return blocks
        .filter((block) => block && block.type === "tool_result" && block.tool_use_id)
        .map((block) => ({
          kind: "activity-status",
          id: String(block.tool_use_id),
          status: block.is_error ? "failed" : "completed",
        }));
    }
    case "result": {
      const events = [{ kind: "turn-completed" }];
      if (message.subtype !== "success") {
        const detail = Array.isArray(message.errors) && message.errors.length ? message.errors.join("; ") : message.subtype;
        events.push({ kind: "error", message: `Claude ターンがエラーで終了しました: ${detail}` });
      } else if (message.is_error) {
        events.push({ kind: "error", message: String(message.result || "Claude がエラーを返しました") });
      }
      return events;
    }
    case "system": {
      if (message.subtype === "session_state_changed" && message.state === "idle") {
        // Authoritative backup for turn completion (e.g. after an interrupt with no result message).
        return [{ kind: "turn-completed" }];
      }
      return [];
    }
    default:
      return [];
  }
}

/** Keep only permission suggestions that stay within the current session. */
function filterSessionSuggestions(suggestions) {
  return (suggestions || []).filter((update) => update && update.destination === "session");
}

/** Map Codicon's permission preset onto SDK options. */
function claudePermissionOptions(mode) {
  if (mode === "read-only") return { permissionMode: "plan" };
  if (mode === "full") return { permissionMode: "bypassPermissions", allowDangerouslySkipPermissions: true };
  return { permissionMode: "default" };
}

function normalizeClaudeModel(info) {
  const efforts = (info.supportedEffortLevels?.length ? info.supportedEffortLevels : DEFAULT_EFFORTS).map((id) => ({ id, description: id }));
  return {
    id: info.value,
    model: info.value,
    displayName: info.displayName || info.value,
    description: info.description || "",
    efforts: info.supportsEffort === false ? [] : efforts,
    defaultEffort: "high",
    tiers: info.supportsFastMode ? [FAST_TIER] : [],
    defaultTier: null,
    isDefault: false,
  };
}

function normalizeClaudeSession(info) {
  return {
    id: info.sessionId,
    preview: info.customTitle || info.summary || info.firstPrompt || "",
    name: info.customTitle || null,
    cwd: info.cwd || "",
    updatedAt: info.lastModified || 0,
    recencyAt: info.lastModified || 0,
    status: { type: "idle" },
  };
}

/**
 * Locate the claude executable the SDK should spawn.
 *
 * The SDK's own resolution breaks in a packaged Electron app: it resolves the platform package
 * relative to its module URL, which points inside app.asar, and spawning through the asar path
 * fails with ENOTDIR because a native binary cannot execute from inside the archive. Resolve the
 * same package ourselves and map it to the app.asar.unpacked copy (the package is listed in
 * asarUnpack). Fall back to a user-installed claude for setups without the platform package.
 */
function resolveClaudeExecutable() {
  const packageNames = [
    `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/claude`,
    `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}-musl/claude`,
  ];
  for (const name of packageNames) {
    try {
      const resolved = require.resolve(name);
      const unpacked = resolved.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
      if (fs.existsSync(unpacked)) return unpacked;
      if (fs.existsSync(resolved)) return resolved;
    } catch {
      // Platform package absent; try the next candidate.
    }
  }
  const candidates = [
    path.join(os.homedir(), ".local", "bin", "claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    "/usr/bin/claude",
  ];
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Continue to the next candidate.
    }
  }
  return null;
}

/** Buffered async iterable the adapter pushes user messages into. */
function createInputQueue() {
  const buffer = [];
  let notify = null;
  let closed = false;
  return {
    push(message) {
      buffer.push(message);
      if (notify) notify();
    },
    close() {
      closed = true;
      if (notify) notify();
    },
    async *stream() {
      for (;;) {
        while (buffer.length) yield buffer.shift();
        if (closed) return;
        await new Promise((resolve) => {
          notify = resolve;
        });
        notify = null;
      }
    },
  };
}

class ClaudeAgent extends EventEmitter {
  /**
   * @param {{ getSettings: () => object }} options getSettings returns Codicon settings
   *   (workspace, permissionMode, claudePath override).
   */
  constructor(options) {
    super();
    this.id = "claude";
    this.capabilities = { voice: false, steer: true, fastTier: true, question: false, liveEffort: true };
    this.getSettings = options.getSettings;
    this.sdk = null;
    this.handle = null; // single live thread: { threadId, query, queue, state, model, effort, tier }
    this.pendingApprovals = new Map();
    this.approvalCounter = 1;
    this.executablePath = undefined; // resolved lazily; null = nothing found
  }

  emitEvent(event) {
    this.emit("event", { provider: this.id, ...event });
  }

  async loadSdk() {
    if (this.sdk) return this.sdk;
    // ESM-only package; import() keeps this file plain CommonJS.
    this.sdk = await import("@anthropic-ai/claude-agent-sdk");
    return this.sdk;
  }

  baseOptions(settings, extra = {}) {
    const options = {
      cwd: settings.workspace || undefined,
      includePartialMessages: true,
      // Fast mode refuses to serve SDK sessions without this opt-in — the session reports
      // fast_mode_disabled_reason "sdk_opt_in_required" and applyFlagSettings({fastMode}) is a
      // silent no-op. This is the flag-settings layer, so it does not touch the user's own files.
      settings: { fastModePerSessionOptIn: true },
      ...claudePermissionOptions(settings.permissionMode),
      canUseTool: (toolName, input, callbackOptions) => this.handlePermission(toolName, input, callbackOptions),
      stderr: (line) => this.emitEvent({ kind: "log", message: String(line) }),
      ...extra,
    };
    const claudePath = settings.claudePath?.trim();
    if (claudePath) {
      options.pathToClaudeCodeExecutable = claudePath;
    } else {
      if (this.executablePath === undefined) this.executablePath = resolveClaudeExecutable();
      if (this.executablePath) options.pathToClaudeCodeExecutable = this.executablePath;
      // With nothing resolved, leave it to the SDK's own lookup and let its error surface.
    }
    return options;
  }

  handlePermission(toolName, input, callbackOptions) {
    const id = `claude-approval-${this.approvalCounter++}`;
    const described = describeTool(toolName, input);
    return new Promise((resolve) => {
      this.pendingApprovals.set(id, { resolve, input, suggestions: callbackOptions?.suggestions });
      const abort = () => {
        if (!this.pendingApprovals.has(id)) return;
        this.pendingApprovals.delete(id);
        this.emitEvent({ kind: "approval-dismissed", id });
        resolve({ behavior: "deny", message: "The request was cancelled before the user answered.", decisionClassification: "user_reject" });
      };
      callbackOptions?.signal?.addEventListener?.("abort", abort, { once: true });
      this.emitEvent({
        kind: "approval",
        id,
        title: callbackOptions?.displayName || described.title,
        command: callbackOptions?.title || described.detail || toolName,
        reason: callbackOptions?.decisionReason || callbackOptions?.description || "Claude Code がツールの実行許可を求めています。",
      });
    });
  }

  async respond(payload) {
    const pending = this.pendingApprovals.get(payload.id);
    if (!pending) throw new Error("応答対象のリクエストが見つかりません");
    this.pendingApprovals.delete(payload.id);
    const decision = payload.decision || "decline";
    if (decision === "accept" || decision === "acceptForSession") {
      // Session-scoped rules only. The SDK's suggestions can carry destinations that persist to
      // settings files; the "セッション中許可" button must never write beyond this session.
      const sessionSuggestions = decision === "acceptForSession"
        ? filterSessionSuggestions(pending.suggestions)
        : [];
      pending.resolve({
        behavior: "allow",
        updatedInput: pending.input,
        updatedPermissions: sessionSuggestions.length ? sessionSuggestions : undefined,
        decisionClassification: "user_temporary",
      });
    } else {
      pending.resolve({ behavior: "deny", message: "Codicon のユーザーが操作を拒否しました。", decisionClassification: "user_reject" });
    }
    return true;
  }

  async closeHandle() {
    const handle = this.handle;
    this.handle = null;
    if (!handle) return;
    try {
      handle.queue.close();
      handle.query.close();
    } catch {
      // The subprocess may already be gone; nothing to clean beyond our own bookkeeping.
    }
    // Killing a session mid-turn produces no result message, so the renderer would stay "busy"
    // forever without this terminal event.
    this.emitEvent({ kind: "turn-completed", threadId: handle.threadId });
  }

  /**
   * Open a streaming-input query and pump its messages into normalized events.
   *
   * The session id is known synchronously: new sessions are created with a forced UUID via
   * Options.sessionId, resumed sessions keep the id they are resumed under. Waiting for the
   * system/init message would deadlock here — in streaming-input mode the CLI defers it until the
   * first user message (verified empirically), while control requests answer immediately.
   */
  async openThread({ resume, model, effort, tier }) {
    const sdk = await this.loadSdk();
    const settings = this.getSettings();
    await this.closeHandle();
    const threadId = resume || randomUUID();
    const queue = createInputQueue();
    const query = sdk.query({
      prompt: queue.stream(),
      options: this.baseOptions(settings, {
        model: model || undefined,
        effort: effort || undefined,
        ...(resume ? { resume } : { sessionId: threadId }),
      }),
    });
    const handle = { threadId, query, queue, state: createThreadState(), model, effort, tier: tier || null };
    this.handle = handle;

    (async () => {
      try {
        for await (const message of query) {
          if (this.handle !== handle) break;
          // A resume can fork to a fresh id in edge cases; trust what the CLI reports.
          if (message.session_id && message.session_id !== handle.threadId) handle.threadId = message.session_id;
          for (const event of normalizeClaudeMessage(message, handle.state)) {
            this.emitEvent({ ...event, threadId: handle.threadId });
          }
        }
        if (this.handle === handle) {
          // The subprocess is gone; drop the handle so the next send reopens via resume instead
          // of pushing messages into a queue nothing drains.
          this.handle = null;
          this.emitEvent({ kind: "status", state: "exit", detail: "Claude セッションが終了しました" });
          this.emitEvent({ kind: "turn-completed", threadId: handle.threadId });
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        if (this.handle === handle) {
          this.handle = null;
          this.emitEvent({ kind: "error", message: `Claude セッションでエラーが発生しました: ${detail}` });
          this.emitEvent({ kind: "status", state: "exit", detail });
          this.emitEvent({ kind: "turn-completed", threadId: handle.threadId });
        }
      }
    })();

    this.emitEvent({ kind: "status", state: "ready" });

    // Fast mode is a flag setting, not an Options field; control requests work immediately.
    if (tier === FAST_TIER.id) {
      await this.applyFast(true);
    }
    return threadId;
  }

  async applyFast(enabled) {
    try {
      await this.handle?.query.applyFlagSettings({ fastMode: enabled });
    } catch (error) {
      this.emitEvent({ kind: "error", message: `Fast mode を設定できませんでした: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  async bootstrap(context) {
    try {
      const sdk = await this.loadSdk();
      const settings = this.getSettings();
      // A short-lived probe session provides the model list and account identity via control
      // requests, which answer immediately — do NOT await a stream message here: in streaming-input
      // mode the CLI defers system/init until the first user message, so that await never returns.
      const queue = createInputQueue();
      const probe = sdk.query({ prompt: queue.stream(), options: this.baseOptions(settings) });
      let models = [];
      let accountLabel = "CLAUDE";
      try {
        const infos = await probe.supportedModels();
        models = (infos || []).map(normalizeClaudeModel);
        const account = await probe.accountInfo().catch(() => null);
        if (account?.email) accountLabel = account.email;
      } finally {
        queue.close();
        probe.close();
      }
      const threads = await this.listThreads().catch(() => ({ data: [] }));
      return {
        available: true,
        models,
        threads: threads.data,
        accountLabel,
        workspace: context?.workspace || "",
      };
    } catch (error) {
      return {
        available: false,
        reason: error instanceof Error ? error.message : String(error),
        models: [],
        threads: [],
        accountLabel: "",
      };
    }
  }

  async startThread({ model, effort, tier }) {
    const threadId = await this.openThread({ model, effort, tier });
    return { threadId };
  }

  async sendMessage({ threadId, text, model, effort, tier, activeTurnId }) {
    if (!this.handle || this.handle.threadId !== threadId) {
      await this.openThread({ resume: threadId, model, effort, tier });
    }
    const handle = this.handle;
    // Settings changed since the last message travel as control requests before the turn.
    if (model && model !== handle.model) {
      await handle.query.setModel(model);
      handle.model = model;
    }
    if (effort && effort !== handle.effort) {
      await handle.query.applyFlagSettings({ effortLevel: effort }).catch(() => undefined);
      handle.effort = effort;
    }
    handle.queue.push({
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
      ...(activeTurnId ? { priority: "now" } : {}),
    });
    const turnId = `claude-turn-${Date.now()}`;
    this.emitEvent({ kind: "turn-started", threadId, turnId });
    return { turnId };
  }

  async updatePower({ threadId, model, effort, tier }) {
    const handle = this.handle;
    if (!handle || handle.threadId !== threadId) return {};
    if (model && model !== handle.model) {
      await handle.query.setModel(model);
      handle.model = model;
    }
    if (effort && effort !== handle.effort) {
      await handle.query.applyFlagSettings({ effortLevel: effort }).catch(() => undefined);
      handle.effort = effort;
    }
    const nextTier = tier || null;
    if (nextTier !== handle.tier) {
      await this.applyFast(nextTier === FAST_TIER.id);
      handle.tier = nextTier;
    }
    return {};
  }

  async interrupt({ threadId }) {
    if (!this.handle || this.handle.threadId !== threadId) return {};
    await this.handle.query.interrupt();
    return {};
  }

  async resumeThread(threadId) {
    const sdk = await this.loadSdk();
    await this.openThread({ resume: threadId });
    let messages = [];
    try {
      const transcript = await sdk.getSessionMessages(threadId);
      messages = (transcript || [])
        .map((entry, index) => {
          const message = entry.message || entry;
          const role = message.role || entry.type;
          if (role !== "user" && role !== "assistant") return null;
          const content = message.content;
          const text = typeof content === "string"
            ? content
            : Array.isArray(content)
              ? content.filter((block) => block && block.type === "text").map((block) => block.text).join("")
              : "";
          if (!text) return null;
          return { id: entry.uuid || `history-${index}`, role, text };
        })
        .filter(Boolean);
    } catch {
      messages = [];
    }
    // openThread assigned a session id; resumed sessions keep their id, forks would change it.
    return { threadId: this.handle?.threadId || threadId, messages };
  }

  async listThreads() {
    const sdk = await this.loadSdk();
    const settings = this.getSettings();
    const sessions = await sdk.listSessions({ limit: 30 });
    const workspace = settings.workspace ? path.resolve(settings.workspace) : null;
    const data = (sessions || [])
      .filter((info) => !workspace || !info.cwd || path.resolve(info.cwd) === workspace)
      .map(normalizeClaudeSession);
    return { data };
  }

  async voiceStart() {
    throw new Error("Claude Code は音声入力に対応していません（Codex ターゲットでのみ利用できます）");
  }

  async voiceAudio() {
    throw new Error("Claude Code は音声入力に対応していません");
  }

  async voiceStop() {
    return {};
  }

  stop() {
    void this.closeHandle();
    for (const [id, pending] of this.pendingApprovals) {
      pending.resolve({ behavior: "deny", message: "Codicon が終了しました。", decisionClassification: "user_reject" });
      this.emitEvent({ kind: "approval-dismissed", id });
    }
    this.pendingApprovals.clear();
  }
}

module.exports = {
  ClaudeAgent,
  claudePermissionOptions,
  createThreadState,
  describeTool,
  filterSessionSuggestions,
  normalizeClaudeMessage,
  normalizeClaudeModel,
  normalizeClaudeSession,
};
