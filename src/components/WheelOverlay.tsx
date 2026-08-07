import { useEffect, useState } from "react";
import { PowerWheel } from "./PowerWheel";
import { SkillsRing } from "./SkillsRing";
import type { WheelOverlayState } from "../types/codicon";

const INITIAL: WheelOverlayState = {
  open: false,
  mode: "power",
  target: "codex",
  slots: [],
  models: [],
  selectedSlot: 0,
  selectedEffort: "medium",
  previewSlot: null,
  previewEffort: null,
  serviceTier: null,
  skills: [],
  previewSkill: null,
};

/**
 * The standalone power-wheel window, shown centred over whichever application is frontmost while
 * LB is held. Purely visual — clicks pass through and every input comes from the controller via
 * the main window's session; this component only mirrors the published state.
 */
export function WheelOverlay() {
  const [state, setState] = useState<WheelOverlayState>(INITIAL);

  // Merge over the defaults rather than replacing: the main process publishes a bare
  // { open: false } when it has nothing cached, and dereferencing the missing arrays used to
  // throw and take the whole overlay window down until the next full publish.
  useEffect(() => window.codicon?.onWheelState((next) => setState((current) => ({ ...current, ...next }))), []);

  const showSkills = state.mode === "skills";
  const slots = state.slots || [];
  const skills = state.skills || [];
  if (showSkills ? !skills.length : !slots.length) return null;

  return (
    <div className={`wheel-overlay ${state.open ? "is-open" : ""}`}>
      <div className={`wheel-overlay-target target-${state.target}`}>{state.target === "claude" ? "CLAUDE CODE" : "CODEX"}</div>
      {showSkills ? (
        <SkillsRing skills={skills} previewSkill={state.previewSkill ?? null} open={state.open} onLaunch={() => undefined} />
      ) : (
      <PowerWheel
        slots={slots}
        models={state.models || []}
        selectedSlot={state.selectedSlot}
        selectedEffort={state.selectedEffort}
        previewSlot={state.previewSlot}
        previewEffort={state.previewEffort}
        open={state.open}
        serviceTier={state.serviceTier}
        onSelectSlot={() => undefined}
        onSelectEffort={() => undefined}
      />
      )}
    </div>
  );
}
