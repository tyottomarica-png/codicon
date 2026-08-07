import planner from "./keystrokePlan.cjs";

const { describePlan, planKeystrokes } = planner;

const plan = (provider, action, value) => planKeystrokes({ provider, action, value });

describe("claude keystroke plans", () => {
  it("sets the model with an inline argument", () => {
    const result = plan("claude", "model", "opus[1m]");
    expect(result.supported).toBe(true);
    expect(result.steps).toEqual([{ kind: "text", value: "/model opus[1m]" }, { kind: "key", name: "enter" }]);
    expect(result.confidence).toBe("verified");
  });

  it("accepts every effort level the CLI advertises, including ultracode and auto", () => {
    for (const effort of ["low", "medium", "high", "xhigh", "max", "ultracode", "auto"]) {
      expect(plan("claude", "effort", effort).supported).toBe(true);
    }
    // An effort the CLI does not know must not be typed at it.
    const bad = plan("claude", "effort", "insane");
    expect(bad.supported).toBe(false);
    expect(bad.reason).toContain("insane");
  });

  it("normalises the fast toggle to on/off", () => {
    expect(plan("claude", "fast", "on").preview).toBe("/fast on⏎");
    expect(plan("claude", "fast", null).preview).toBe("/fast off⏎");
  });

  it("starts a fresh conversation with /clear", () => {
    expect(plan("claude", "newChat").steps[0]).toEqual({ kind: "text", value: "/clear" });
  });

  it("refuses a model plan with nothing selected", () => {
    expect(plan("claude", "model", "").supported).toBe(false);
  });
});

describe("codex keystroke plans", () => {
  it("can only open the model picker, never choose a row", () => {
    const result = plan("codex", "model", "gpt-5.6-sol");
    expect(result.supported).toBe(true);
    // The value is deliberately absent: /model takes no inline argument upstream.
    expect(result.steps).toEqual([{ kind: "text", value: "/model" }, { kind: "key", name: "enter" }]);
    expect(result.steps.some((step) => step.kind === "text" && step.value.includes("sol"))).toBe(false);
    expect(result.reason).toContain("ピッカー");
  });

  it("reports effort and fast as unsupported rather than typing something wrong", () => {
    expect(plan("codex", "effort", "high").supported).toBe(false);
    expect(plan("codex", "fast", "on").supported).toBe(false);
  });

  it("starts a fresh conversation with /new", () => {
    expect(plan("codex", "newChat").steps[0]).toEqual({ kind: "text", value: "/new" });
  });
});

describe("shared plans", () => {
  it("interrupts with escape on both backends", () => {
    for (const provider of ["claude", "codex"]) {
      expect(plan(provider, "interrupt").steps).toEqual([{ kind: "key", name: "escape" }]);
    }
  });

  it("sends a prompt as literal text", () => {
    const result = plan("claude", "prompt", "  Review the diff  ");
    expect(result.steps).toEqual([{ kind: "text", value: "Review the diff" }, { kind: "key", name: "enter" }]);
  });

  it("refuses a prompt that would be read as a slash command", () => {
    // A Skill whose text starts with "/" would silently run an arbitrary command in the target.
    const result = plan("claude", "prompt", "/clear");
    expect(result.supported).toBe(false);
    expect(result.reason).toContain("/");
    expect(plan("claude", "prompt", "   ").supported).toBe(false);
  });

  it("rejects an unknown provider", () => {
    expect(plan("gemini", "model", "x").supported).toBe(false);
  });

  it("describes plans for the confirmation UI", () => {
    expect(describePlan(plan("claude", "model", "sonnet"))).toBe("/model sonnet⏎");
    expect(describePlan(plan("codex", "fast", "on"))).toContain("/fast");
  });
});
