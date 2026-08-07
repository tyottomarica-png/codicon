// Turns a control-surface action into the literal keys that would drive the agent the user
// already has open, rather than a session Codicon owns.
//
// This module is pure and produces a *plan* — it never sends anything. Codicon shows the plan
// before dispatching so nothing is typed into another application without the user seeing it
// first, and so the whole mapping can be unit tested without an input backend at all.
//
// What each CLI actually accepts was measured, not guessed:
//   Claude Code — `/model <name>`, `/effort <low|medium|high|xhigh|max|ultracode|auto>` and
//   `/fast [on|off]` all take an inline argument (the SDK reports argumentHint for each, and the
//   inline forms were confirmed against a live session).
//   Codex — `supports_inline_args()` in codex-rs/tui/src/slash_command.rs lists exactly which
//   commands take arguments, and Model and Permissions are NOT on it. `/model` opens an
//   interactive picker, so a one-shot string cannot choose a model there.

const CLAUDE_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max", "ultracode", "auto"]);

/** A plan is a list of steps; each is either literal text or a named key. */
function text(value) {
  return { kind: "text", value };
}

function key(name, modifiers) {
  return modifiers?.length ? { kind: "key", name, modifiers } : { kind: "key", name };
}

function submit() {
  return key("enter");
}

/**
 * @param {object} request
 * @param {"claude"|"codex"} request.provider
 * @param {"model"|"effort"|"fast"|"interrupt"|"newChat"|"prompt"} request.action
 * @param {string} [request.value] model id, effort id, "on"/"off", or the prompt text
 * @returns {{ supported: boolean, steps: Array<object>, preview: string, reason?: string,
 *            confidence: "verified"|"inferred"|"unsupported" }}
 */
function planKeystrokes({ provider, action, value }) {
  const unsupported = (reason) => ({ supported: false, steps: [], preview: "", reason, confidence: "unsupported" });

  if (action === "interrupt") {
    // Escape cancels the running turn in both TUIs and in the Claude desktop composer.
    return { supported: true, steps: [key("escape")], preview: "Esc", confidence: "inferred" };
  }

  if (action === "prompt") {
    const body = String(value || "").trim();
    if (!body) return unsupported("送信する内容が空です");
    // A prompt that begins with "/" would be read as a slash command by the target.
    if (body.startsWith("/")) return unsupported("プロンプトが / で始まっています（コマンドと解釈されます）");
    return { supported: true, steps: [text(body), submit()], preview: `${body}⏎`, confidence: "verified" };
  }

  if (provider === "claude") {
    switch (action) {
      case "model": {
        if (!value) return unsupported("モデルが未選択です");
        const line = `/model ${value}`;
        return { supported: true, steps: [text(line), submit()], preview: `${line}⏎`, confidence: "verified" };
      }
      case "effort": {
        if (!CLAUDE_EFFORTS.has(String(value))) return unsupported(`Claude は effort "${value}" を受け付けません`);
        const line = `/effort ${value}`;
        return { supported: true, steps: [text(line), submit()], preview: `${line}⏎`, confidence: "verified" };
      }
      case "fast": {
        const line = `/fast ${value === "on" ? "on" : "off"}`;
        // Verified rejected on the SDK transport ("not available in the Agent SDK"); the
        // interactive CLI is where it applies, which is exactly the target here.
        return { supported: true, steps: [text(line), submit()], preview: `${line}⏎`, confidence: "inferred" };
      }
      case "newChat":
        return { supported: true, steps: [text("/clear"), submit()], preview: "/clear⏎", confidence: "verified" };
      default:
        return unsupported(`未対応の操作: ${action}`);
    }
  }

  if (provider === "codex") {
    switch (action) {
      case "model":
        // Deliberately only opens the picker. Sending arrow keys to land on a specific row would
        // depend on the picker's current ordering and silently select the wrong model when it
        // changes, so Codicon opens it and lets the user choose.
        return {
          supported: true,
          steps: [text("/model"), submit()],
          preview: "/model⏎ （ピッカーが開きます）",
          reason: "Codex の /model は引数を取らないため、選択はピッカーで行う必要があります",
          confidence: "verified",
        };
      case "effort":
        return unsupported("Codex は effort を /model のピッカー内で選ぶ設計です");
      case "fast":
        return unsupported("Codex CLI に /fast は存在しません");
      case "newChat":
        return { supported: true, steps: [text("/new"), submit()], preview: "/new⏎", confidence: "verified" };
      default:
        return unsupported(`未対応の操作: ${action}`);
    }
  }

  return unsupported(`未知のプロバイダ: ${provider}`);
}

/** Human-readable one-liner for the confirmation UI. */
function describePlan(plan) {
  if (!plan.supported) return plan.reason || "この操作は送信できません";
  return plan.preview;
}

module.exports = { CLAUDE_EFFORTS, describePlan, planKeystrokes };
