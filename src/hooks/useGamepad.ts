import { useEffect, useRef, useState } from "react";
import { sectorFromAxes } from "../lib/radial";
import type { CodiconSettings } from "../types/codicon";

export type GamepadSnapshot = {
  connected: boolean;
  id: string;
  left: [number, number];
  right: [number, number];
};

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
};

const EMPTY_SNAPSHOT: GamepadSnapshot = { connected: false, id: "", left: [0, 0], right: [0, 0] };

function pulse(gamepad: Gamepad | null): void {
  const actuator = gamepad?.vibrationActuator as GamepadHapticActuator | null | undefined;
  actuator?.playEffect?.("dual-rumble", { duration: 38, strongMagnitude: 0.14, weakMagnitude: 0.34 }).catch(() => undefined);
}

export function useGamepad(settings: CodiconSettings | null, modelCount: number, effortCount: number, actions: GamepadActions): GamepadSnapshot {
  const [snapshot, setSnapshot] = useState<GamepadSnapshot>(EMPTY_SNAPSHOT);
  const actionsRef = useRef(actions);
  const previousButtons = useRef<boolean[]>([]);
  const wheelOpen = useRef(false);
  const previousPreview = useRef("null:null");
  actionsRef.current = actions;

  useEffect(() => {
    if (!settings?.controllerEnabled) {
      setSnapshot(EMPTY_SNAPSHOT);
      return;
    }
    let animationFrame = 0;
    const tick = () => {
      const gamepad = [...navigator.getGamepads()].find((candidate): candidate is Gamepad => Boolean(candidate?.connected && candidate.mapping === "standard"))
        || [...navigator.getGamepads()].find((candidate): candidate is Gamepad => Boolean(candidate?.connected))
        || null;
      if (!gamepad) {
        if (wheelOpen.current) actionsRef.current.onWheelCancel();
        wheelOpen.current = false;
        previousButtons.current = [];
        setSnapshot((current) => (current.connected ? EMPTY_SNAPSHOT : current));
        animationFrame = requestAnimationFrame(tick);
        return;
      }
      const pressed = gamepad.buttons.map((button) => button.pressed);
      const wasPressed = previousButtons.current;
      const justPressed = (index: number) => pressed[index] && !wasPressed[index];
      const justReleased = (index: number) => !pressed[index] && wasPressed[index];
      const binding = settings.bindings;
      const left: [number, number] = [gamepad.axes[0] || 0, gamepad.axes[1] || 0];
      const right: [number, number] = [gamepad.axes[2] || 0, gamepad.axes[3] || 0];

      if (justPressed(binding.powerWheel)) {
        wheelOpen.current = true;
        previousPreview.current = "null:null";
        actionsRef.current.onWheelOpen();
        pulse(gamepad);
      }
      if (wheelOpen.current && pressed[binding.powerWheel]) {
        const modelIndex = sectorFromAxes(left[0], left[1], modelCount, settings.deadzone);
        const effortIndex = sectorFromAxes(right[0], right[1], effortCount, settings.deadzone);
        const previewKey = `${modelIndex}:${effortIndex}`;
        if (previewKey !== previousPreview.current) {
          previousPreview.current = previewKey;
          actionsRef.current.onWheelPreview(modelIndex, effortIndex);
          if (modelIndex !== null || effortIndex !== null) pulse(gamepad);
        }
      }
      if (wheelOpen.current && justReleased(binding.powerWheel)) {
        wheelOpen.current = false;
        actionsRef.current.onWheelCommit();
        pulse(gamepad);
      }
      if (justPressed(binding.fastMode)) {
        actionsRef.current.onFastToggle();
        pulse(gamepad);
      }
      if (justPressed(binding.cancel)) {
        if (wheelOpen.current) {
          wheelOpen.current = false;
          actionsRef.current.onWheelCancel();
        } else actionsRef.current.onCancel();
      }
      if (!wheelOpen.current) {
        if (justPressed(binding.primary)) actionsRef.current.onPrimary();
        if (justPressed(binding.focusComposer)) actionsRef.current.onFocusComposer();
        if (justPressed(binding.newThread)) actionsRef.current.onNewThread();
        if (justPressed(binding.settings)) actionsRef.current.onSettings();
        if (justPressed(binding.pushToTalk)) actionsRef.current.onPushToTalkStart();
        if (justReleased(binding.pushToTalk)) actionsRef.current.onPushToTalkStop();
      }
      previousButtons.current = pressed;
      setSnapshot({ connected: true, id: gamepad.id, left, right });
      animationFrame = requestAnimationFrame(tick);
    };
    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [settings, modelCount, effortCount]);

  return snapshot;
}
