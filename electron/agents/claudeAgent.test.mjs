import adapter from "./claudeAgent.cjs";

const { claudePermissionOptions, createThreadState, describeTool, filterSessionSuggestions, normalizeClaudeMessage, normalizeClaudeModel, normalizeClaudeSession } = adapter;

function feed(messages) {
  // Pin the prefix so expectations stay deterministic; production uses a random one per thread.
  const state = createThreadState("t0");
  return messages.flatMap((message) => normalizeClaudeMessage(message, state));
}

describe("claude message normalization", () => {
  it("streams deltas and closes them with the completed message under one item id", () => {
    const events = feed([
      { type: "stream_event", parent_tool_use_id: null, event: { type: "message_start" } },
      { type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } } },
      { type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", delta: { type: "text_delta", text: "lo" } } },
      { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "Hello" }] } },
    ]);
    expect(events).toEqual([
      { kind: "message-delta", itemId: "claude-t0-0", delta: "Hel" },
      { kind: "message-delta", itemId: "claude-t0-0", delta: "lo" },
      { kind: "message-completed", itemId: "claude-t0-0", text: "Hello" },
    ]);
  });

  it("gives successive assistant messages distinct item ids", () => {
    const events = feed([
      { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "first" }] } },
      { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "second" }] } },
    ]);
    expect(events[0].itemId).not.toBe(events[1].itemId);
  });

  it("emits running activities for tool use and closes them from tool results", () => {
    const events = feed([
      {
        type: "assistant",
        parent_tool_use_id: null,
        message: { content: [{ type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "npm test" } }] },
      },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", is_error: false }] } },
    ]);
    expect(events[0]).toEqual({ kind: "activity", id: "toolu_1", type: "commandExecution", title: "COMMAND", detail: "npm test", status: "running" });
    expect(events[1]).toEqual({ kind: "activity-status", id: "toolu_1", status: "completed" });
  });

  it("marks failed tool results as failed", () => {
    const events = feed([
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_9", is_error: true }] } },
    ]);
    expect(events[0].status).toBe("failed");
  });

  it("ignores subagent traffic", () => {
    expect(feed([
      { type: "stream_event", parent_tool_use_id: "toolu_parent", event: { type: "content_block_delta", delta: { type: "text_delta", text: "x" } } },
      { type: "assistant", parent_tool_use_id: "toolu_parent", message: { content: [{ type: "text", text: "hidden" }] } },
    ])).toEqual([]);
  });

  it("completes the turn on result and surfaces errors", () => {
    expect(feed([{ type: "result", subtype: "success", is_error: false }])).toEqual([{ kind: "turn-completed" }]);
    const failed = feed([{ type: "result", subtype: "error_during_execution", errors: ["boom"] }]);
    expect(failed[0]).toEqual({ kind: "turn-completed" });
    expect(failed[1].kind).toBe("error");
    expect(failed[1].message).toContain("boom");
  });

  it("treats session idle as a backup turn completion", () => {
    expect(feed([{ type: "system", subtype: "session_state_changed", state: "idle" }])).toEqual([{ kind: "turn-completed" }]);
    expect(feed([{ type: "system", subtype: "session_state_changed", state: "running" }])).toEqual([]);
  });
});

describe("claude tool descriptions", () => {
  it("maps common tools to the rail vocabulary", () => {
    expect(describeTool("Bash", { command: "ls" })).toMatchObject({ title: "COMMAND", detail: "ls" });
    expect(describeTool("Edit", { file_path: "/a/b.ts" })).toMatchObject({ title: "FILES", detail: "/a/b.ts" });
    expect(describeTool("WebSearch", { query: "electron" })).toMatchObject({ title: "SEARCH" });
    expect(describeTool("mcp__github__create_issue", { title: "x" }).title).toBe("TOOL");
  });
});

describe("claude option mapping", () => {
  it("maps Codicon permission presets onto SDK modes", () => {
    expect(claudePermissionOptions("read-only")).toEqual({ permissionMode: "plan" });
    expect(claudePermissionOptions("auto")).toEqual({ permissionMode: "default" });
    expect(claudePermissionOptions("full")).toEqual({ permissionMode: "bypassPermissions", allowDangerouslySkipPermissions: true });
  });

  it("normalizes ModelInfo including effort and fast support", () => {
    const model = normalizeClaudeModel({
      value: "claude-fable-5",
      displayName: "Fable 5",
      description: "Most capable",
      supportsEffort: true,
      supportedEffortLevels: ["high", "xhigh", "max"],
      supportsFastMode: false,
    });
    expect(model.efforts.map((option) => option.id)).toEqual(["high", "xhigh", "max"]);
    expect(model.tiers).toEqual([]);
    const fastable = normalizeClaudeModel({ value: "claude-opus-5", displayName: "Opus", supportsFastMode: true });
    expect(fastable.tiers).toEqual([{ id: "fast", name: "Fast" }]);
    expect(fastable.efforts.length).toBe(5);
  });

  it("normalizes session infos into thread summaries", () => {
    const thread = normalizeClaudeSession({ sessionId: "abc", summary: "Fix the build", lastModified: 123, cwd: "/repo" });
    expect(thread).toMatchObject({ id: "abc", preview: "Fix the build", updatedAt: 123, cwd: "/repo" });
  });

  it("only forwards session-scoped permission suggestions", () => {
    // "Allow for this session" must never persist rules into settings files.
    const filtered = filterSessionSuggestions([
      { type: "addRules", rules: [{ toolName: "Bash" }], behavior: "allow", destination: "session" },
      { type: "addRules", rules: [{ toolName: "Bash" }], behavior: "allow", destination: "userSettings" },
      { type: "addRules", rules: [{ toolName: "Bash" }], behavior: "allow", destination: "projectSettings" },
    ]);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].destination).toBe("session");
    expect(filterSessionSuggestions(undefined)).toEqual([]);
  });
});
