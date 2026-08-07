import { useEffect, useRef, useState } from "react";
import type { CodiconSettings, ControllerAction, ControllerStatus, GamepadSnapshot } from "../types/codicon";

export type { GamepadSnapshot } from "../types/codicon";

type GamepadActions = {
  onWheelOpen(): void;
  onWheelPreview(modelIndex: number | null, effortIndex: number | null): void;
  onWheelCommit(): void;
  onWheelCancel(): void;
  onPrimary(): void;
  onCancel(): void;
  onFocusComposer(): void;
  onNewThread(): void;
  onSettings(): void;
  onPushToTalkStart(): void;
  onPushToTalkStop(): void;
  onFastToggle(): void;
  /** Optional: the target cycle itself happens in the main process; this is for UI feedback. */
  onSwitchTarget?(): void;
};

const EMPTY_SNAPSHOT: GamepadSnapshot = { connected: false, id: "", left: [0, 0], right: [0, 0] };

const PREVIEW_STATUS: ControllerStatus = {
  available: false,
  reason: "Design preview runs without the Electron main process",
  connected: false,
  id: "",
  backgroundEvents: false,
};

export type ControllerState = {
  snapshot: GamepadSnapshot;
  status: ControllerStatus;
};

/**
 * Bridges the main process controller reader to the session callbacks.
 *
 * The polling deliberately does not live here. `navigator.getGamepads()` only reports to a focused
 * document and Chromium throttles background renderers, so a hook that polled would stop the
 * moment you switched to Codex or Claude Code. The main process reads the device over SDL and
 * sends already-debounced semantic actions; this hook only dispatches them.
 */
export function useGamepad(
  settings: CodiconSettings | null,
  modelCount: number,
  effortCount: number,
  actions: GamepadActions,
): ControllerState {
  const [snapshot, setSnapshot] = useState<GamepadSnapshot>(EMPTY_SNAPSHOT);
  const [status, setStatus] = useState<ControllerStatus>(PREVIEW_STATUS);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  // The ring sizes come from the loaded model list, which only the renderer knows.
  useEffect(() => {
    window.codicon?.setControllerContext({ modelCount, effortCount });
  }, [modelCount, effortCount]);

  useEffect(() => {
    const codicon = window.codicon;
    if (!codicon) return;

    const dispatch = (action: ControllerAction) => {
      const handlers = actionsRef.current;
      switch (action.type) {
        case "wheel/open": handlers.onWheelOpen(); break;
        case "wheel/preview": handlers.onWheelPreview(action.modelIndex, action.effortIndex); break;
        case "wheel/commit": handlers.onWheelCommit(); break;
        case "wheel/cancel": handlers.onWheelCancel(); break;
        case "primary": handlers.onPrimary(); break;
        case "cancel": handlers.onCancel(); break;
        case "focusComposer": handlers.onFocusComposer(); break;
        case "newThread": handlers.onNewThread(); break;
        case "settings": handlers.onSettings(); break;
        case "pushToTalk/start": handlers.onPushToTalkStart(); break;
        case "pushToTalk/stop": handlers.onPushToTalkStop(); break;
        case "fastToggle": handlers.onFastToggle(); break;
        case "switchTarget": handlers.onSwitchTarget?.(); break;
      }
    };

    const unsubscribeActions = codicon.onControllerActions((batch) => batch.forEach(dispatch));
    const unsubscribeSnapshot = codicon.onControllerSnapshot(setSnapshot);
    const unsubscribeStatus = codicon.onControllerStatus(setStatus);
    void codicon.controllerStatus().then(setStatus).catch(() => undefined);

    return () => {
      unsubscribeActions();
      unsubscribeSnapshot();
      unsubscribeStatus();
    };
  }, []);

  // Disabling the controller in Settings is enforced in the main process; mirror it here so the
  // status bar stops claiming a controller is live.
  useEffect(() => {
    if (settings && !settings.controllerEnabled) setSnapshot(EMPTY_SNAPSHOT);
  }, [settings]);

  return { snapshot, status };
}
