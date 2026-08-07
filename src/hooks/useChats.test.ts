import { chatStatus, deriveTitle, reconcileSlots } from "./useChats";
import type { Chat } from "./useChats";

function makeChat(patch: Partial<Chat> = {}): Chat {
  return {
    id: "chat-1",
    provider: "claude",
    threadId: "t1",
    title: "",
    slot: 0,
    effort: "high",
    tier: null,
    messages: [],
    activity: [],
    approval: null,
    inputRequest: null,
    activeTurnId: null,
    unread: false,
    error: null,
    ...patch,
  };
}

describe("Agent Key status", () => {
  it("is idle for a quiet chat", () => {
    expect(chatStatus(makeChat())).toBe("idle");
  });

  it("distinguishes thinking from running by tool activity", () => {
    expect(chatStatus(makeChat({ activeTurnId: "turn-1" }))).toBe("thinking");
    expect(chatStatus(makeChat({
      activeTurnId: "turn-1",
      activity: [{ id: "a", type: "commandExecution", title: "COMMAND", detail: "npm test", status: "running" }],
    }))).toBe("running");
    // A finished tool call leaves the turn merely thinking again.
    expect(chatStatus(makeChat({
      activeTurnId: "turn-1",
      activity: [{ id: "a", type: "commandExecution", title: "COMMAND", detail: "npm test", status: "completed" }],
    }))).toBe("thinking");
  });

  it("ranks waiting above every other state", () => {
    const approval = { id: 1, title: "t", command: "c", reason: "r" };
    // Waiting must win even mid-turn and even when the chat also has an error.
    expect(chatStatus(makeChat({ approval, activeTurnId: "turn-1" }))).toBe("waiting");
    expect(chatStatus(makeChat({ approval, error: "boom" }))).toBe("waiting");
    expect(chatStatus(makeChat({ inputRequest: { id: 2, questions: [] } }))).toBe("waiting");
  });

  it("shows done only while output is unread", () => {
    expect(chatStatus(makeChat({ unread: true }))).toBe("done");
    expect(chatStatus(makeChat({ unread: false }))).toBe("idle");
  });

  it("surfaces errors when nothing needs an answer", () => {
    expect(chatStatus(makeChat({ error: "boom" }))).toBe("error");
    // An error must not mask an in-flight turn's progress.
    expect(chatStatus(makeChat({ error: "boom", activeTurnId: "turn-1" }))).toBe("error");
  });
});

describe("chat titles", () => {
  it("prefers an explicit title", () => {
    expect(deriveTitle(makeChat({ title: "Release prep" }))).toBe("Release prep");
  });

  it("falls back to the first line of the first user message", () => {
    expect(deriveTitle(makeChat({
      messages: [
        { id: "a", role: "assistant", text: "hello" },
        { id: "u", role: "user", text: "Fix the build\nsecond line" },
      ],
    }))).toBe("Fix the build");
  });

  it("truncates long prompts and handles empty chats", () => {
    const long = "x".repeat(60);
    expect(deriveTitle(makeChat({ messages: [{ id: "u", role: "user", text: long }] })).length).toBeLessThanOrEqual(34);
    expect(deriveTitle(makeChat())).toBe("New chat");
  });
});

describe("slot reconciliation", () => {
  const models = [
    { id: "opus", model: "opus", displayName: "Opus", description: "", efforts: [], defaultEffort: null, tiers: [], defaultTier: null, isDefault: true },
    { id: "sonnet", model: "sonnet", displayName: "Sonnet", description: "", efforts: [], defaultEffort: null, tiers: [], defaultTier: null, isDefault: false },
  ];

  it("keeps slots that still resolve", () => {
    const slots = [{ key: "opus", label: "OPUS", modelId: "opus", color: "#fff" }];
    expect(reconcileSlots(slots, models)).toEqual(slots);
  });

  it("repoints slots whose model disappeared", () => {
    const slots = [{ key: "sonnet", label: "SONNET", modelId: "gone-model", color: "#fff" }];
    // The key matches a real model semantically, so it wins over positional fallback.
    expect(reconcileSlots(slots, models)[0].modelId).toBe("sonnet");
  });

  it("leaves slots untouched when no models are known yet", () => {
    const slots = [{ key: "a", label: "A", modelId: "x", color: "#fff" }];
    expect(reconcileSlots(slots, [])).toEqual(slots);
  });
});
