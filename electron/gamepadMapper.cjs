// Pure controller state machine shared by the main-process gamepad reader.
//
// It holds no Electron, SDL, or DOM references so it can be unit tested directly and so the
// edge-detection stays identical no matter which source feeds it: the native SDL reader in the
// main process, or the Web Gamepad API in browser preview mode.
//
// The sector math is intentionally a copy of src/lib/radial.ts. The renderer needs it in
// TypeScript for the SVG wheel and the main process cannot import a TS module, so the two are
// pinned together by matching test expectations in gamepadMapper.test.mjs and radial.test.ts.

const DEFAULT_DEADZONE = 0.42;

function normalizeDegrees(value) {
  return ((value % 360) + 360) % 360;
}

function angleFromAxes(x, y) {
  return normalizeDegrees((Math.atan2(y, x) * 180) / Math.PI + 90);
}

function magnitudeFromAxes(x, y) {
  return Math.min(1, Math.hypot(x, y));
}

function sectorFromAxes(x, y, count, deadzone = DEFAULT_DEADZONE) {
  if (count < 1 || magnitudeFromAxes(x, y) < deadzone) return null;
  const angle = angleFromAxes(x, y);
  return Math.floor((angle + 180 / count) / (360 / count)) % count;
}

const EMPTY_SNAPSHOT = { connected: false, id: "", left: [0, 0], right: [0, 0] };

// Prefer a controller the source could map to the standard layout; the bindings are indices into
// that layout. Anything else is a best-effort fallback so an unmapped pad still shows as present.
function pickGamepad(gamepads) {
  const candidates = (gamepads || []).filter((pad) => pad && pad.connected);
  return candidates.find((pad) => pad.mapping === "standard") || candidates[0] || null;
}

function axisPair(pad, xIndex, yIndex) {
  return [pad.axes?.[xIndex] || 0, pad.axes?.[yIndex] || 0];
}

function createControllerMapper() {
  let previousButtons = [];
  let previousId = null;
  let wheelOpen = false;
  let skillsOpen = false;
  let previousPreview = "null:null";
  let previousSkillPreview = "null";
  let pushToTalkActive = false;

  // Releasing Push to Talk must always be delivered, even if the reader stops seeing the pad
  // mid-hold, otherwise the microphone stays open with no way to close it from the controller.
  function releasePushToTalk(actions) {
    if (!pushToTalkActive) return;
    pushToTalkActive = false;
    actions.push({ type: "pushToTalk/stop" });
  }

  function closeWheel(actions, reason) {
    if (!wheelOpen) return;
    wheelOpen = false;
    previousPreview = "null:null";
    actions.push({ type: reason });
  }

  function closeSkills(actions, reason) {
    if (!skillsOpen) return;
    skillsOpen = false;
    previousSkillPreview = "null";
    actions.push({ type: reason });
  }

  return {
    /**
     * Fold one poll of the raw gamepad list into semantic actions.
     *
     * @returns {{ actions: Array<object>, snapshot: object, haptic: boolean, gamepad: object|null }}
     */
    update(gamepads, config) {
      const actions = [];
      const { bindings, modelCount, effortCount } = config;
      const skillCount = Math.max(1, Number(config.skillCount) || 1);
      const deadzone = typeof config.deadzone === "number" ? config.deadzone : DEFAULT_DEADZONE;
      const gamepad = pickGamepad(gamepads);

      if (!gamepad) {
        closeWheel(actions, "wheel/cancel");
        closeSkills(actions, "skills/cancel");
        releasePushToTalk(actions);
        previousButtons = [];
        previousId = null;
        return { actions, snapshot: EMPTY_SNAPSHOT, haptic: false, gamepad: null };
      }

      const pressed = (gamepad.buttons || []).map((button) => Boolean(button && button.pressed));
      const id = gamepad.id || "";

      // The first sample from a newly attached controller has no predecessor to compare against.
      // Treating it as a frame of fresh presses would fire whatever the driver reports on
      // enumeration — enough to open the power ring and commit a random model and effort. Adopt
      // the state as the baseline instead and start detecting edges from the next poll.
      if (previousId !== id) {
        previousId = id;
        previousButtons = pressed;
        return { actions, snapshot: { connected: true, id, left: axisPair(gamepad, 0, 1), right: axisPair(gamepad, 2, 3) }, haptic: false, gamepad };
      }

      const wasPressed = previousButtons;
      const justPressed = (index) => Boolean(pressed[index]) && !wasPressed[index];
      const justReleased = (index) => !pressed[index] && Boolean(wasPressed[index]);
      const left = axisPair(gamepad, 0, 1);
      const right = axisPair(gamepad, 2, 3);
      let haptic = false;

      if (justPressed(bindings.powerWheel)) {
        wheelOpen = true;
        previousPreview = "null:null";
        actions.push({ type: "wheel/open" });
        haptic = true;
      }
      if (wheelOpen && pressed[bindings.powerWheel]) {
        const modelIndex = sectorFromAxes(left[0], left[1], modelCount, deadzone);
        const effortIndex = sectorFromAxes(right[0], right[1], effortCount, deadzone);
        const previewKey = `${modelIndex}:${effortIndex}`;
        if (previewKey !== previousPreview) {
          previousPreview = previewKey;
          actions.push({ type: "wheel/preview", modelIndex, effortIndex });
          if (modelIndex !== null || effortIndex !== null) haptic = true;
        }
      }
      if (wheelOpen && justReleased(bindings.powerWheel)) {
        wheelOpen = false;
        previousPreview = "null:null";
        actions.push({ type: "wheel/commit" });
        haptic = true;
      }
      // Skills ring: the Codex Micro joystick flick, mapped to a held trigger + left stick.
      if (bindings.skillsRing !== undefined && !wheelOpen) {
        if (justPressed(bindings.skillsRing)) {
          skillsOpen = true;
          previousSkillPreview = "null";
          actions.push({ type: "skills/open" });
          haptic = true;
        }
        if (skillsOpen && pressed[bindings.skillsRing]) {
          const skillIndex = sectorFromAxes(left[0], left[1], skillCount, deadzone);
          const key = `${skillIndex}`;
          if (key !== previousSkillPreview) {
            previousSkillPreview = key;
            actions.push({ type: "skills/preview", skillIndex });
            if (skillIndex !== null) haptic = true;
          }
        }
        if (skillsOpen && justReleased(bindings.skillsRing)) {
          skillsOpen = false;
          previousSkillPreview = "null";
          actions.push({ type: "skills/commit" });
          haptic = true;
        }
      }
      if (justPressed(bindings.fastMode)) {
        actions.push({ type: "fastToggle" });
        haptic = true;
      }
      if (justPressed(bindings.cancel)) {
        if (wheelOpen) closeWheel(actions, "wheel/cancel");
        else if (skillsOpen) closeSkills(actions, "skills/cancel");
        else actions.push({ type: "cancel" });
      }
      if (!wheelOpen && !skillsOpen) {
        if (justPressed(bindings.primary)) actions.push({ type: "primary" });
        if (justPressed(bindings.focusComposer)) actions.push({ type: "focusComposer" });
        if (justPressed(bindings.newThread)) actions.push({ type: "newThread" });
        if (justPressed(bindings.settings)) actions.push({ type: "settings" });
        if (bindings.switchTarget !== undefined && justPressed(bindings.switchTarget)) {
          actions.push({ type: "switchTarget" });
          haptic = true;
        }
        if (justPressed(bindings.pushToTalk) && !pushToTalkActive) {
          pushToTalkActive = true;
          actions.push({ type: "pushToTalk/start" });
        }
      }
      // Deliberately outside the wheel guard: opening the wheel mid-hold must not swallow the
      // release that closes the microphone.
      if (justReleased(bindings.pushToTalk)) releasePushToTalk(actions);

      previousButtons = pressed;
      return {
        actions,
        snapshot: { connected: true, id: gamepad.id || "", left, right },
        haptic,
        gamepad,
      };
    },

    /** Drop all edge state, e.g. when the controller is disabled in Settings. */
    reset() {
      const actions = [];
      closeWheel(actions, "wheel/cancel");
      closeSkills(actions, "skills/cancel");
      releasePushToTalk(actions);
      previousButtons = [];
      previousId = null;
      return actions;
    },
  };
}

module.exports = {
  DEFAULT_DEADZONE,
  EMPTY_SNAPSHOT,
  angleFromAxes,
  createControllerMapper,
  magnitudeFromAxes,
  normalizeDegrees,
  pickGamepad,
  sectorFromAxes,
};
