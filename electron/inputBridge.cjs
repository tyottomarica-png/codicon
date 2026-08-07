// Delivers a keystroke plan to the agent the user already has open.
//
// This is the "direct control" path: instead of Codicon owning a session, a controller press is
// translated into the keys you would have typed yourself, exactly like the physical Codex Micro
// macropad does. That means synthesising input into another application, so the guardrails here
// are structural rather than advisory:
//
//   1. Off by default. Nothing is ever sent until the user turns the mode on in Settings.
//   2. Every dispatch traces to a physical controller edge. There is no timer, retry or queue in
//      this module — one press, one dispatch, or nothing.
//   3. The frontmost application is re-checked immediately before sending, and the keys go
//      nowhere unless it is still the agent app the plan was built for. Alt-tabbing to a browser
//      or a password manager mid-press cancels the send instead of typing into it.
//   4. A minimum interval between dispatches, so a stuck button cannot become a stream of input.
//   5. Clipboard mode needs no OS permission at all and is the default when the user opts in:
//      Codicon puts the command on the clipboard and the user pastes it. Typing is the opt-in
//      step beyond that, and requires macOS Accessibility, requested through the normal prompt.

const MIN_DISPATCH_INTERVAL_MS = 250;

// Named keys the planner may emit, mapped to the backend's vocabulary.
const KEY_NAMES = new Set(["enter", "escape", "tab", "up", "down", "left", "right", "backspace"]);

class InputBridge {
  /**
   * @param {object} options
   * @param {() => object} options.getSettings
   * @param {() => { bundleId: string, agent: string|null, name?: string }} options.getFrontApp
   * @param {{ writeText(text: string): void }} options.clipboard
   * @param {{ isTrustedAccessibilityClient(prompt: boolean): boolean }} options.systemPreferences
   */
  constructor(options) {
    this.getSettings = options.getSettings;
    this.getFrontApp = options.getFrontApp;
    // Injected rather than required: it keeps the OS surface explicit and lets the gating be
    // tested without Electron.
    this.clipboard = options.clipboard;
    this.systemPreferences = options.systemPreferences;
    this.robot = undefined; // undefined = not tried yet, null = unavailable
    this.lastDispatchAt = 0;
    this.lastResult = null;
  }

  /** Lazily load the optional native backend; its absence only disables "type" mode. */
  loadRobot() {
    if (this.robot !== undefined) return this.robot;
    try {
      // Optional dependency: clipboard mode works fine without it.
      this.robot = require("@jitsi/robotjs");
    } catch {
      this.robot = null;
    }
    return this.robot;
  }

  /** True once macOS has granted Accessibility. `prompt` opens the system dialog once. */
  isTrusted(prompt = false) {
    if (process.platform !== "darwin") return true;
    try {
      return Boolean(this.systemPreferences?.isTrustedAccessibilityClient(prompt));
    } catch {
      return false;
    }
  }

  status() {
    const mode = this.getSettings().directControl?.mode || "off";
    return {
      mode,
      typingAvailable: Boolean(this.loadRobot()),
      accessibilityTrusted: this.isTrusted(false),
      platform: process.platform,
      lastResult: this.lastResult,
    };
  }

  /**
   * Send a plan to the frontmost agent application.
   *
   * @param {object} plan from keystrokePlan.planKeystrokes
   * @param {{ provider: string }} context the backend the plan was built for
   * @returns {{ sent: boolean, mode: string, reason?: string, preview: string }}
   */
  dispatch(plan, context) {
    const preview = plan?.preview || "";
    const settings = this.getSettings();
    const mode = settings.directControl?.mode || "off";
    const record = (result) => {
      this.lastResult = { ...result, at: Date.now() };
      return result;
    };

    if (mode === "off") return record({ sent: false, mode, preview, reason: "ダイレクト操作はオフです" });
    if (!plan?.supported) return record({ sent: false, mode, preview, reason: plan?.reason || "送信できない操作です" });

    const now = Date.now();
    if (now - this.lastDispatchAt < MIN_DISPATCH_INTERVAL_MS) {
      return record({ sent: false, mode, preview, reason: "連続送信を抑制しました" });
    }

    // Re-check the target at the moment of sending: the plan may have been built a second ago
    // while a different application is frontmost now.
    const front = this.getFrontApp();
    if (!front || front.agent !== context.provider) {
      return record({
        sent: false,
        mode,
        preview,
        reason: `前面が ${context.provider} ではありません（${front?.name || "不明"}）`,
      });
    }

    if (mode === "clipboard") {
      this.clipboard.writeText(plan.steps.filter((step) => step.kind === "text").map((step) => step.value).join(""));
      this.lastDispatchAt = now;
      return record({ sent: true, mode, preview, reason: "クリップボードにコピーしました（⌘V で貼り付け）" });
    }

    const robot = this.loadRobot();
    if (!robot) {
      return record({ sent: false, mode, preview, reason: "入力モジュールが見つかりません（npm install @jitsi/robotjs）" });
    }
    if (!this.isTrusted(false)) {
      return record({ sent: false, mode, preview, reason: "macOS のアクセシビリティ許可が必要です" });
    }

    try {
      for (const step of plan.steps) {
        if (step.kind === "text") robot.typeString(step.value);
        else if (KEY_NAMES.has(step.name)) robot.keyTap(step.name, step.modifiers || []);
      }
      this.lastDispatchAt = now;
      return record({ sent: true, mode, preview });
    } catch (error) {
      return record({ sent: false, mode, preview, reason: error instanceof Error ? error.message : String(error) });
    }
  }
}

module.exports = { InputBridge, MIN_DISPATCH_INTERVAL_MS };
