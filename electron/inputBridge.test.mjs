import bridgeModule from "./inputBridge.cjs";
import plannerModule from "./keystrokePlan.cjs";

const { InputBridge } = bridgeModule;
const { planKeystrokes } = plannerModule;

let copied;

function makeBridge({ mode = "clipboard", agent = "claude", robot = null, trusted = true } = {}) {
  copied = [];
  const bridge = new InputBridge({
    getSettings: () => ({ directControl: { mode } }),
    getFrontApp: () => ({ agent, name: "Claude", bundleId: "com.anthropic.claudefordesktop" }),
    clipboard: { writeText: (value) => copied.push(value) },
    systemPreferences: { isTrustedAccessibilityClient: () => trusted },
  });
  bridge.robot = robot; // skip the optional require
  return bridge;
}

const modelPlan = () => planKeystrokes({ provider: "claude", action: "model", value: "opus" });

describe("input bridge gating", () => {
  it("sends nothing while the mode is off", () => {
    const bridge = makeBridge({ mode: "off" });
    const result = bridge.dispatch(modelPlan(), { provider: "claude" });
    expect(result.sent).toBe(false);
    expect(copied).toEqual([]);
  });

  it("refuses an unsupported plan instead of typing something wrong", () => {
    const bridge = makeBridge();
    const bad = planKeystrokes({ provider: "codex", action: "effort", value: "high" });
    expect(bridge.dispatch(bad, { provider: "codex" }).sent).toBe(false);
  });

  it("cancels when the frontmost app is no longer the intended agent", () => {
    // The user alt-tabbed between choosing on the ring and releasing the trigger.
    const bridge = makeBridge({ agent: null });
    const result = bridge.dispatch(modelPlan(), { provider: "claude" });
    expect(result.sent).toBe(false);
    expect(result.reason).toContain("前面");
    expect(copied).toEqual([]);
  });

  it("cancels when the frontmost agent belongs to the other backend", () => {
    const bridge = makeBridge({ agent: "codex" });
    expect(bridge.dispatch(modelPlan(), { provider: "claude" }).sent).toBe(false);
  });

  it("rate limits so a stuck button cannot stream input", () => {
    const bridge = makeBridge();
    expect(bridge.dispatch(modelPlan(), { provider: "claude" }).sent).toBe(true);
    const second = bridge.dispatch(modelPlan(), { provider: "claude" });
    expect(second.sent).toBe(false);
    expect(second.reason).toContain("抑制");
  });
});

describe("clipboard mode", () => {
  it("copies only the literal text, never the key names", () => {
    const bridge = makeBridge();
    bridge.dispatch(modelPlan(), { provider: "claude" });
    expect(copied).toEqual(["/model opus"]);
  });
});

describe("type mode", () => {
  it("replays text and named keys in order", () => {
    const typed = [];
    const robot = {
      typeString: (value) => typed.push(`text:${value}`),
      keyTap: (name) => typed.push(`key:${name}`),
    };
    const bridge = makeBridge({ mode: "type", robot });
    const result = bridge.dispatch(modelPlan(), { provider: "claude" });
    expect(result.sent).toBe(true);
    expect(typed).toEqual(["text:/model opus", "key:enter"]);
  });

  it("refuses to type without the Accessibility grant", () => {
    const robot = { typeString: () => { throw new Error("should not be called"); }, keyTap: () => undefined };
    const bridge = makeBridge({ mode: "type", robot, trusted: false });
    const result = bridge.dispatch(modelPlan(), { provider: "claude" });
    expect(result.sent).toBe(false);
    expect(result.reason).toContain("アクセシビリティ");
  });

  it("reports a missing native module instead of failing silently", () => {
    const bridge = makeBridge({ mode: "type", robot: null });
    const result = bridge.dispatch(modelPlan(), { provider: "claude" });
    expect(result.sent).toBe(false);
    expect(result.reason).toContain("robotjs");
  });

  it("drops key names the planner never emits", () => {
    const typed = [];
    const robot = { typeString: (v) => typed.push(v), keyTap: (n) => typed.push(`key:${n}`) };
    const bridge = makeBridge({ mode: "type", robot });
    bridge.dispatch({ supported: true, preview: "x", steps: [{ kind: "key", name: "eject" }] }, { provider: "claude" });
    expect(typed).toEqual([]);
  });
});
