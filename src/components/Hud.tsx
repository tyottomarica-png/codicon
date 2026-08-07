import { useEffect, useState } from "react";
import { effortLabel } from "../lib/radial";
import type { HudState } from "../types/codicon";

const INITIAL: HudState = {
  connection: "connecting",
  model: "",
  effort: "",
  serviceTier: null,
  busy: false,
  voiceActive: false,
  approvalPending: false,
  controller: false,
};

function activity(state: HudState): { label: string; tone: string } {
  if (state.approvalPending) return { label: "NEEDS APPROVAL", tone: "approval" };
  if (state.voiceActive) return { label: "LISTENING", tone: "voice" };
  if (state.busy) return { label: "WORKING", tone: "busy" };
  if (state.connection === "error") return { label: "OFFLINE", tone: "error" };
  if (state.connection === "connecting") return { label: "CONNECTING", tone: "idle" };
  return { label: "IDLE", tone: "idle" };
}

/**
 * Compact always-on-top overlay. It renders in its own non-focusable window so the state of the
 * Codex turn stays visible while Codex or Claude Code owns the foreground.
 */
export function Hud() {
  const [state, setState] = useState<HudState>(INITIAL);

  useEffect(() => {
    const codicon = window.codicon;
    if (!codicon) return;
    void codicon.hudState().then(setState).catch(() => undefined);
    return codicon.onHudState(setState);
  }, []);

  const { label, tone } = activity(state);

  return (
    <div className={`hud tone-${tone}`}>
      <div className="hud-head">
        <span className="hud-mark">C</span>
        <span className={`hud-activity tone-${tone}`}><i />{label}</span>
        <span className={`hud-pad ${state.controller ? "is-connected" : ""}`} title={state.controller ? "Controller connected" : "No controller"}>⌁</span>
        <button
          className="hud-open"
          title="Bring Codicon to the front"
          onClick={() => window.codicon?.showMainWindow()}
        >
          ⤢
        </button>
      </div>
      <strong className="hud-model">{state.model || "—"}</strong>
      <div className="hud-meta">
        <span>{state.effort ? effortLabel(state.effort) : "—"}</span>
        <span>{state.serviceTier ? "FAST" : "STANDARD"}</span>
      </div>
    </div>
  );
}
