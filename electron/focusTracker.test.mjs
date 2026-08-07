import tracker from "./focusTracker.cjs";

const { agentFromAppBundle, agentFromCommand, agentFromGlobalScan, agentFromTtyProcesses, classifyApp, resolveTarget } = tracker;

describe("focus heuristics", () => {
  it("classifies terminals, IDEs, and everything else", () => {
    expect(classifyApp({ bundleId: "com.apple.Terminal", name: "Terminal" })).toBe("terminal");
    expect(classifyApp({ bundleId: "com.googlecode.iterm2", name: "iTerm2" })).toBe("terminal");
    expect(classifyApp({ bundleId: "com.microsoft.VSCode", name: "Code" })).toBe("ide");
    expect(classifyApp({ bundleId: "com.todesktop.230313mzl4w4u92", name: "Cursor" })).toBe("ide");
    expect(classifyApp({ bundleId: "com.apple.Safari", name: "Safari" })).toBe("other");
    // Linux WM_CLASS goes through the name field with no bundle id.
    expect(classifyApp({ bundleId: "", name: "kitty" })).toBe("terminal");
  });

  it("treats the agents' own desktop apps as direct signals", () => {
    expect(classifyApp({ bundleId: "com.anthropic.claudefordesktop", name: "Claude" })).toBe("agent-app");
    expect(agentFromAppBundle("com.anthropic.claudefordesktop")).toBe("claude");
    expect(agentFromAppBundle("com.apple.Safari")).toBeNull();
  });

  it("matches the invoked command word, not substrings", () => {
    expect(agentFromCommand("claude")).toBe("claude");
    expect(agentFromCommand("/opt/homebrew/bin/codex app-server --stdio")).toBe("codex");
    expect(agentFromCommand("node /usr/local/bin/claude --resume abc")).toBe("claude");
    expect(agentFromCommand("node /opt/claude/cli.js")).toBe("claude");
    expect(agentFromCommand("vim claude-notes.md")).toBeNull();
    expect(agentFromCommand("less /tmp/codex.log")).toBeNull();
    expect(agentFromCommand("git clone https://example.com/claude repo")).toBeNull();
    expect(agentFromCommand("")).toBeNull();
  });

  it("prefers the foreground process on a tty", () => {
    expect(agentFromTtyProcesses([
      { stat: "Ss", command: "-zsh" },
      { stat: "S", command: "node /usr/local/bin/codex" },
      { stat: "S+", command: "claude" },
    ])).toBe("claude");
  });

  it("falls back to a background match when nothing is foreground", () => {
    expect(agentFromTtyProcesses([
      { stat: "Ss", command: "-zsh" },
      { stat: "S", command: "codex resume" },
    ])).toBe("codex");
    expect(agentFromTtyProcesses([{ stat: "Ss+", command: "-zsh" }])).toBeNull();
  });

  it("only counts terminal-foreground rows in the global scan", () => {
    // A claude running in a terminal tab is decisive.
    expect(agentFromGlobalScan([
      { tty: "ttys001", stat: "Ss", command: "-zsh" },
      { tty: "ttys001", stat: "S+", command: "claude" },
    ])).toBe("claude");
    // Codicon's own children have no tty and must never count — otherwise the scan would always
    // see both agents and stay permanently inconclusive.
    expect(agentFromGlobalScan([
      { tty: "??", stat: "S", command: "codex app-server --stdio" },
      { tty: "??", stat: "S", command: "/path/claude --input-format stream-json" },
      { tty: "ttys002", stat: "S+", command: "codex" },
    ])).toBe("codex");
    // Two different agents both interactive → cannot know which tab the user is on.
    expect(agentFromGlobalScan([
      { tty: "ttys001", stat: "S+", command: "claude" },
      { tty: "ttys002", stat: "S+", command: "codex" },
    ])).toBeNull();
    // Background (no '+') rows are not evidence of the active tab.
    expect(agentFromGlobalScan([{ tty: "ttys001", stat: "S", command: "claude" }])).toBeNull();
    // Linux pts ttys count too.
    expect(agentFromGlobalScan([{ tty: "pts/3", stat: "S+", command: "codex" }])).toBe("codex");
  });

  it("resolves the target with manual override and sticky fallback", () => {
    expect(resolveTarget({ mode: "manual", manual: "claude", detected: "codex", lastDetected: "codex" }))
      .toEqual({ target: "claude", source: "manual" });
    expect(resolveTarget({ mode: "auto", manual: "codex", detected: "claude", lastDetected: null }))
      .toEqual({ target: "claude", source: "auto" });
    expect(resolveTarget({ mode: "auto", manual: "codex", detected: null, lastDetected: "claude" }))
      .toEqual({ target: "claude", source: "sticky" });
    expect(resolveTarget({ mode: "auto", manual: "codex", detected: null, lastDetected: null }))
      .toEqual({ target: "codex", source: "fallback" });
  });
});
