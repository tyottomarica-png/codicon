// Watches which application owns the foreground and infers whether the user is currently working
// in a Claude Code or a Codex context, so the controller can drive the matching backend without
// being told ("auto" target mode).
//
// Detection is layered by cost and reliability:
//   1. Frontmost app (cheap, no permissions on macOS via lsappinfo).
//   2. If the frontmost app is a terminal: the tty of its ACTIVE tab (macOS: one AppleScript per
//      terminal app, which triggers the one-time Automation prompt), then the foreground process
//      group on that tty. This is precise — it sees the tab you are looking at.
//   3. If the frontmost app is an IDE (VS Code, Cursor) or the tty is unavailable: a global scan
//      for running claude/codex processes. Only decisive when it is unambiguous.
// Anything below tier 2 is best-effort; the UI always shows how the target was chosen and manual
// override wins. The pure heuristics are exported for unit tests.

const { execFile } = require("node:child_process");
const { EventEmitter } = require("node:events");

const TERMINAL_BUNDLES = new Set([
  "com.apple.Terminal",
  "com.googlecode.iterm2",
  "com.mitchellh.ghostty",
  "dev.warp.Warp-Stable",
  "dev.warp.Warp",
  "com.github.wez.wezterm",
  "net.kovidgoyal.kitty",
  "org.alacritty",
  "co.zeit.hyper",
]);

const IDE_BUNDLES = new Set([
  "com.microsoft.VSCode",
  "com.microsoft.VSCodeInsiders",
  "com.vscodium",
  "com.todesktop.230313mzl4w4u92", // Cursor
  "dev.zed.Zed",
]);

// Apps that ARE one of the agents: being frontmost is a direct, unambiguous signal.
const AGENT_APP_BUNDLES = new Map([
  ["com.anthropic.claudefordesktop", "claude"],
  ["com.anthropic.claude", "claude"],
  ["com.openai.codex", "codex"],
]);

const TERMINAL_CLASSES_LINUX = new Set([
  "gnome-terminal-server", "konsole", "xterm", "alacritty", "kitty", "wezterm", "ghostty",
  "xfce4-terminal", "terminator", "tilix", "st", "urxvt", "foot",
]);

function classifyApp({ bundleId, name }) {
  const id = bundleId || "";
  const lowerName = (name || "").toLowerCase();
  if (AGENT_APP_BUNDLES.has(id)) return "agent-app";
  if (TERMINAL_BUNDLES.has(id) || TERMINAL_CLASSES_LINUX.has(lowerName)) return "terminal";
  if (IDE_BUNDLES.has(id) || lowerName === "code" || lowerName === "cursor") return "ide";
  return "other";
}

function agentFromAppBundle(bundleId) {
  return AGENT_APP_BUNDLES.get(bundleId || "") || null;
}

/**
 * Decide which agent a process invocation belongs to.
 * Only the invoked program is examined — the first token, plus the second when the first is a JS
 * runtime — so "claude" appearing in an unrelated argument ("vim claude-notes.md") never counts,
 * while "/usr/local/bin/claude", "node /opt/claude/cli.js", and "claude --resume" all do.
 */
function agentFromCommand(command) {
  const text = String(command || "");
  const tokens = text.trim().split(/\s+/);
  const candidates = [tokens[0] || "", /^(node|bun|deno)$/.test(baseName(tokens[0] || "")) ? tokens[1] || "" : ""];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const base = baseName(candidate);
    if (base === "claude") return "claude";
    if (base === "codex") return "codex";
    // npm-style installs invoke "node …/claude/cli.js": look for the agent as a path segment.
    const segments = candidate.split("/");
    if (segments.includes("claude")) return "claude";
    if (segments.includes("codex")) return "codex";
  }
  return null;
}

function baseName(pathLike) {
  const parts = String(pathLike).split("/");
  return parts[parts.length - 1] || "";
}

/**
 * Pick the agent from a tty's process list. Prefers the foreground process group ('+' in stat);
 * falls back to any match so a claude paused under a pager still counts.
 */
function agentFromTtyProcesses(processes) {
  const matched = processes
    .map((proc) => ({ agent: agentFromCommand(proc.command), foreground: /\+/.test(proc.stat || "") }))
    .filter((entry) => entry.agent);
  const foreground = matched.find((entry) => entry.foreground);
  if (foreground) return foreground.agent;
  return matched.length ? matched[0].agent : null;
}

/**
 * Global fallback: consider only interactive terminal foreground processes — rows with a real tty
 * and '+' in stat. This is what keeps Codicon's OWN children out of the picture: the codex
 * app-server and claude subprocesses Codicon spawns have no controlling tty (`??`), and counting
 * them would make the scan permanently ambiguous. Only decisive when every candidate agrees.
 */
function agentFromGlobalScan(rows) {
  const agents = new Set(
    rows
      .filter((row) => /^(ttys|pts)/.test(String(row.tty || "").replace("/dev/", "")) && /\+/.test(row.stat || ""))
      .map((row) => agentFromCommand(row.command))
      .filter(Boolean),
  );
  return agents.size === 1 ? [...agents][0] : null;
}

/**
 * Final target resolution. Manual mode always wins; auto falls back to the last confident
 * detection so a glance at Slack does not bounce the target around.
 */
function resolveTarget({ mode, manual, detected, lastDetected }) {
  if (mode === "manual") return { target: manual, source: "manual" };
  if (detected) return { target: detected, source: "auto" };
  if (lastDetected) return { target: lastDetected, source: "sticky" };
  return { target: manual, source: "fallback" };
}

function run(command, args, timeout = 1500) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout, encoding: "utf8" }, (error, stdout, stderr) => {
      resolve(error ? { ok: false, stdout: "", stderr: String(stderr || error.message || "") } : { ok: true, stdout, stderr: "" });
    });
  });
}

// One AppleScript per terminal app, asking for the tty of the tab the user is looking at.
const MAC_TTY_SCRIPTS = {
  "com.apple.Terminal": 'tell application "Terminal" to tty of selected tab of front window',
  "com.googlecode.iterm2": 'tell application "iTerm2" to tty of current session of current window',
};

class FocusTracker extends EventEmitter {
  /**
   * @param {{ getMode: () => { mode: string, manual: string }, intervalMs?: number }} options
   */
  constructor(options) {
    super();
    this.getMode = options.getMode;
    this.intervalMs = options.intervalMs || 1200;
    this.timer = null;
    this.polling = false;
    this.lastDetected = null;
    this.state = { target: "codex", source: "fallback", app: "", detected: null };
    // Automation permission is granted per (Codicon → terminal app) pair, so a denial for
    // Terminal.app must not stop us asking iTerm2. Track refusals per bundle id.
    this.appleScriptDenied = new Set();
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.poll(), this.intervalMs);
    if (typeof this.timer.unref === "function") this.timer.unref();
    void this.poll();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async poll() {
    // A poll awaits several subprocesses whose combined worst case exceeds the interval; without
    // this guard a slow poll's stale result would land after a fresh one and flip the target back.
    if (this.polling) return;
    this.polling = true;
    try {
      const { mode, manual } = this.getMode();
      let detected = null;
      let app = "";
      try {
        if (mode !== "manual") {
          const front = process.platform === "darwin" ? await this.frontAppDarwin() : await this.frontAppLinux();
          app = front?.name || "";
          detected = front ? await this.detectAgent(front) : null;
          if (detected) this.lastDetected = detected;
        }
      } catch {
        detected = null;
      }
      const resolved = resolveTarget({ mode, manual, detected, lastDetected: this.lastDetected });
      const next = { ...resolved, app, detected };
      const changed = next.target !== this.state.target || next.source !== this.state.source || next.app !== this.state.app;
      this.state = next;
      if (changed) this.emit("change", this.state);
    } finally {
      this.polling = false;
    }
  }

  async frontAppDarwin() {
    const front = await run("lsappinfo", ["front"]);
    const asn = front.stdout.trim();
    if (!front.ok || !asn) return null;
    const info = await run("lsappinfo", ["info", "-only", "name,bundleid", asn]);
    if (!info.ok) return null;
    // Observed format: first line `"Claude" ASN:0x0-0x155155: (in front)`, then `bundleID="..."`.
    const name = /^"([^"]*)"/.exec(info.stdout.trim())?.[1] || "";
    const bundleId = /bundleID="([^"]*)"/.exec(info.stdout)?.[1] || "";
    return { name, bundleId };
  }

  async frontAppLinux() {
    const active = await run("xprop", ["-root", "_NET_ACTIVE_WINDOW"]);
    const windowId = /window id # (0x[0-9a-f]+)/i.exec(active.stdout || "")?.[1];
    if (!windowId) return null;
    const details = await run("xprop", ["-id", windowId, "_NET_WM_PID", "WM_CLASS"]);
    if (!details.ok) return null;
    const pid = /_NET_WM_PID\(CARDINAL\) = (\d+)/.exec(details.stdout)?.[1] || null;
    const wmClass = /WM_CLASS\(STRING\) = "([^"]*)"/.exec(details.stdout)?.[1] || "";
    return { name: wmClass, bundleId: "", pid: pid ? Number(pid) : null };
  }

  async detectAgent(front) {
    const kind = classifyApp(front);
    if (kind === "agent-app") return agentFromAppBundle(front.bundleId);
    if (kind === "terminal") {
      const byTty = await this.agentFromActiveTty(front);
      if (byTty) return byTty;
    }
    if (kind === "terminal" || kind === "ide") {
      return this.agentFromScan(front);
    }
    return null;
  }

  async agentFromActiveTty(front) {
    if (process.platform === "darwin") {
      const script = MAC_TTY_SCRIPTS[front.bundleId];
      if (!script || this.appleScriptDenied.has(front.bundleId)) return null;
      // Generous timeout: the FIRST call shows the macOS Automation consent dialog and does not
      // return until the user answers. Treating that wait as a failure would permanently poison
      // detection for this terminal the moment the dialog appeared.
      const output = await run("osascript", ["-e", script], 30000);
      if (!output.ok) {
        // Only an explicit refusal (-1743 "Not authorised to send Apple events") is permanent.
        if (/-1743|Not authori[sz]ed/i.test(output.stderr)) this.appleScriptDenied.add(front.bundleId);
        return null;
      }
      const tty = output.stdout.trim().replace("/dev/", "");
      if (!tty) return null;
      const list = await run("ps", ["-t", tty, "-o", "stat=,command="]);
      if (!list.ok) return null;
      const processes = list.stdout.split("\n").filter(Boolean).map((line) => {
        const match = /^\s*(\S+)\s+(.*)$/.exec(line);
        return match ? { stat: match[1], command: match[2] } : null;
      }).filter(Boolean);
      return agentFromTtyProcesses(processes);
    }
    if (front.pid) {
      // Linux: foreground process group of the terminal's descendants.
      const list = await run("ps", ["-e", "-o", "pid=,ppid=,stat=,command="]);
      if (!list.ok) return null;
      const rows = list.stdout.split("\n").filter(Boolean).map((line) => {
        const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
        return match ? { pid: Number(match[1]), ppid: Number(match[2]), stat: match[3], command: match[4] } : null;
      }).filter(Boolean);
      const descendants = new Set([front.pid]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const row of rows) {
          if (descendants.has(row.ppid) && !descendants.has(row.pid)) {
            descendants.add(row.pid);
            grew = true;
          }
        }
      }
      return agentFromTtyProcesses(rows.filter((row) => descendants.has(row.pid) && row.pid !== front.pid));
    }
    return null;
  }

  async agentFromScan() {
    const list = await run("ps", ["ax", "-o", "tty=,stat=,command="]);
    if (!list.ok) return null;
    const rows = list.stdout.split("\n").filter(Boolean).map((line) => {
      const match = /^\s*(\S+)\s+(\S+)\s+(.*)$/.exec(line);
      return match ? { tty: match[1], stat: match[2], command: match[3] } : null;
    }).filter(Boolean);
    return agentFromGlobalScan(rows);
  }
}

module.exports = {
  FocusTracker,
  agentFromAppBundle,
  agentFromCommand,
  agentFromGlobalScan,
  agentFromTtyProcesses,
  classifyApp,
  resolveTarget,
};
