import { useEffect, useState } from "react";
import { PowerWheel } from "./PowerWheel";
import type { WheelOverlayState } from "../types/codicon";

const INITIAL: WheelOverlayState = {
  open: false,
  target: "codex",
  slots: [],
  models: [],
  selectedSlot: 0,
  selectedEffort: "medium",
  previewSlot: null,
  previewEffort: null,
  serviceTier: null,
};

/**
 * The standalone power-wheel window, shown centred over whichever application is frontmost while
 * LB is held. Purely visual — clicks pass through and every input comes from the controller via
 * the main window's session; this component only mirrors the published state.
 */
export function WheelOverlay() {
  const [state, setState] = useState<WheelOverlayState>(INITIAL);

  useEffect(() => window.codicon?.onWheelState(setState), []);

  if (!state.slots.length) return null;

  return (
    <div className={`wheel-overlay ${state.open ? "is-open" : ""}`}>
      <div className={`wheel-overlay-target target-${state.target}`}>{state.target === "claude" ? "CLAUDE CODE" : "CODEX"}</div>
      <PowerWheel
        slots={state.slots}
        models={state.models}
        selectedSlot={state.selectedSlot}
        selectedEffort={state.selectedEffort}
        previewSlot={state.previewSlot}
        previewEffort={state.previewEffort}
        open={state.open}
        serviceTier={state.serviceTier}
        onSelectSlot={() => undefined}
        onSelectEffort={() => undefined}
      />
    </div>
  );
}
