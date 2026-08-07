import adapter from "./codexAgent.cjs";

const { classifyCodexRequest, messagesFromCodexThread, normalizeCodexModel, normalizeCodexNotification } = adapter;

describe("codex notification normalization", () => {
  it("maps the turn lifecycle", () => {
    expect(normalizeCodexNotification({ method: "turn/started", params: { turn: { id: "t1" } } }))
      .toEqual([{ kind: "turn-started", turnId: "t1" }]);
    expect(normalizeCodexNotification({ method: "turn/completed", params: {} }))
      .toEqual([{ kind: "turn-completed" }]);
  });

  it("maps agent message streaming", () => {
    expect(normalizeCodexNotification({ method: "item/agentMessage/delta", params: { itemId: "i1", delta: "he" } }))
      .toEqual([{ kind: "message-delta", itemId: "i1", delta: "he" }]);
    expect(normalizeCodexNotification({ method: "item/completed", params: { item: { id: "i1", type: "agentMessage", text: "hey" } } }))
      .toEqual([{ kind: "message-completed", itemId: "i1", text: "hey" }]);
    // A started agentMessage is not yet displayable content.
    expect(normalizeCodexNotification({ method: "item/started", params: { item: { id: "i1", type: "agentMessage" } } }))
      .toEqual([]);
  });

  it("maps tool items to activities", () => {
    expect(normalizeCodexNotification({ method: "item/started", params: { item: { id: "c1", type: "commandExecution", command: "ls" } } }))
      .toEqual([{ kind: "activity", id: "c1", type: "commandExecution", title: "COMMAND", detail: "ls", status: "running" }]);
    expect(normalizeCodexNotification({ method: "item/completed", params: { item: { id: "f1", type: "fileChange", changes: [{}, {}] } } }))
      .toEqual([{ kind: "activity", id: "f1", type: "fileChange", title: "FILES", detail: "2 changes", status: "completed" }]);
  });

  it("maps voice and error events", () => {
    expect(normalizeCodexNotification({ method: "thread/realtime/transcript/delta", params: { role: "user", delta: "a" } }))
      .toEqual([{ kind: "voice-transcript-delta", delta: "a" }]);
    expect(normalizeCodexNotification({ method: "thread/realtime/transcript/delta", params: { role: "assistant", delta: "a" } }))
      .toEqual([]);
    expect(normalizeCodexNotification({ method: "error", params: { message: "x" } }))
      .toEqual([{ kind: "error", message: "x" }]);
  });
});

describe("codex request classification", () => {
  it("classifies approvals with human titles", () => {
    const approval = classifyCodexRequest({ id: 5, method: "item/commandExecution/requestApproval", params: { command: "rm -rf dist" } });
    expect(approval.action).toBe("approval");
    expect(approval.event).toMatchObject({ kind: "approval", id: 5, command: "rm -rf dist" });
    expect(classifyCodexRequest({ id: 6, method: "item/fileChange/requestApproval", params: {} }).event.title).toContain("ファイル変更");
  });

  it("classifies user input questions", () => {
    const question = classifyCodexRequest({ id: 7, method: "item/tool/requestUserInput", params: { questions: [{ id: "q1" }] } });
    expect(question.action).toBe("question");
    expect(question.event.questions).toEqual([{ id: "q1" }]);
  });

  it("auto-responds to elicitation and dynamic tool calls", () => {
    expect(classifyCodexRequest({ id: 8, method: "mcpServer/elicitation/request", params: {} }).action).toBe("respond");
    expect(classifyCodexRequest({ id: 9, method: "item/tool/call", params: {} }).action).toBe("respond");
  });

  it("rejects unknown requests instead of leaving them pending", () => {
    const unknown = classifyCodexRequest({ id: 10, method: "future/unknown", params: {} });
    expect(unknown).toMatchObject({ action: "reject", code: -32601 });
  });
});

describe("codex data mapping", () => {
  it("normalizes model entries", () => {
    const model = normalizeCodexModel({
      id: "gpt-x", model: "gpt-x", displayName: "X",
      supportedReasoningEfforts: [{ reasoningEffort: "low", description: "l" }],
      defaultReasoningEffort: "low",
      serviceTiers: [{ id: "priority", name: "Fast", description: "" }],
      defaultServiceTier: null, isDefault: true,
    });
    expect(model.efforts).toEqual([{ id: "low", description: "l" }]);
    expect(model.tiers).toEqual([{ id: "priority", name: "Fast" }]);
  });

  it("extracts chat history from a resumed thread", () => {
    const messages = messagesFromCodexThread({
      thread: {
        turns: [{
          items: [
            { id: "u1", type: "userMessage", content: [{ type: "text", text: "hi" }] },
            { id: "a1", type: "agentMessage", text: "hello" },
            { id: "c1", type: "commandExecution", command: "ls" },
          ],
        }],
      },
    });
    expect(messages).toEqual([
      { id: "u1", role: "user", text: "hi" },
      { id: "a1", role: "assistant", text: "hello" },
    ]);
  });
});
