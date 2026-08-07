// OS-level controller reader for the Electron main process.
//
// The renderer cannot do this job. The Web Gamepad API only reports to a focused document, and
// Chromium additionally throttles timers in background windows, so a renderer-side poll stops the
// moment you switch to Codex or Claude Code. SDL reads the device directly and, with the
// background-events hint, keeps delivering input while another application owns the foreground.

const { EventEmitter } = require("node:events");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createControllerMapper, EMPTY_SNAPSHOT } = require("./gamepadMapper.cjs");

const POLL_HZ = 60;
const SNAPSHOT_HZ = 20;
const AXIS_EPSILON = 0.01;

// SDL hints are read from the environment at SDL_Init, which happens when the native binding is
// first required. These must therefore be set before the dynamic import below.
function applySdlEnvironment() {
  // We want the joystick subsystem only. Letting SDL bring up a real video backend would have it
  // create its own Cocoa/X11 event loop alongside Electron's for no benefit.
  if (!process.env.SDL_VIDEODRIVER) process.env.SDL_VIDEODRIVER = "dummy";
  if (!process.env.SDL_AUDIODRIVER) process.env.SDL_AUDIODRIVER = "dummy";
  // The whole point of this module: deliver controller input while Codicon is not the front app.
  process.env.SDL_JOYSTICK_ALLOW_BACKGROUND_EVENTS = "1";
}

function axesChanged(previous, next) {
  return (
    Math.abs(previous[0] - next[0]) > AXIS_EPSILON ||
    Math.abs(previous[1] - next[1]) > AXIS_EPSILON
  );
}

function snapshotChanged(previous, next) {
  if (previous.connected !== next.connected || previous.id !== next.id) return true;
  return axesChanged(previous.left, next.left) || axesChanged(previous.right, next.right);
}

class GamepadSource extends EventEmitter {
  /**
   * @param {() => object} getConfig Supplies the live bindings, deadzone, and ring sizes.
   */
  constructor(getConfig) {
    super();
    this.getConfig = getConfig;
    this.mapper = createControllerMapper();
    this.manager = null;
    this.timer = null;
    this.starting = null;
    this.lastSnapshot = EMPTY_SNAPSHOT;
    this.lastSnapshotAt = 0;
    this.status = {
      available: false,
      reason: "not started",
      connected: false,
      id: "",
      backgroundEvents: false,
    };
  }

  async start() {
    if (this.manager) return this.status;
    if (this.starting) return this.starting;
    this.starting = this.#load().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  async #load() {
    applySdlEnvironment();
    try {
      // gamepad-node ships as ESM; main.cjs is CommonJS, so it has to come in through import().
      // Resolved from this file so a packaged asar still finds it next to the app's node_modules.
      const entry = require.resolve("gamepad-node/index.js", { paths: [path.join(__dirname, "..")] });
      const gamepadNode = await import(pathToFileURL(entry).href);
      // Deliberately not installNavigatorShim(): that patches globalThis.navigator and starts its
      // own timer. We own the poll loop so its cadence matches the mapper's edge detection.
      this.manager = new gamepadNode.GamepadManager();
      const sdl = gamepadNode.getSdl();
      this.#setStatus({
        available: Boolean(sdl?.info?.initialized?.controller),
        reason: sdl?.info?.initialized?.controller ? "" : "SDL controller subsystem unavailable",
        backgroundEvents: process.env.SDL_JOYSTICK_ALLOW_BACKGROUND_EVENTS === "1",
      });
      this.#startPolling();
    } catch (error) {
      // A missing SDL binary or an unsupported platform must not take the app down; the renderer
      // falls back to the focus-limited Web Gamepad API and the UI says so.
      this.#setStatus({ available: false, reason: error instanceof Error ? error.message : String(error) });
    }
    return this.status;
  }

  #startPolling() {
    if (this.timer) return;
    this.timer = setInterval(() => this.#tick(), Math.round(1000 / POLL_HZ));
    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  #tick() {
    if (!this.manager) return;
    const config = this.getConfig();
    if (!config || config.enabled === false) {
      const actions = this.mapper.reset();
      if (actions.length) this.emit("actions", actions);
      // Only announce the transition; repeating the empty snapshot 60×/s would re-render the UI
      // continuously for as long as the controller stays disabled.
      if (this.lastSnapshot.connected) this.#emitSnapshot(EMPTY_SNAPSHOT, true);
      return;
    }
    let pads = [];
    try {
      this.manager.poll();
      pads = this.manager.getGamepads();
    } catch (error) {
      this.#setStatus({ available: false, reason: error instanceof Error ? error.message : String(error) });
      this.stop();
      return;
    }
    const { actions, snapshot, haptic, gamepad } = this.mapper.update(pads, config);
    if (snapshot.connected !== this.status.connected || snapshot.id !== this.status.id) {
      this.#setStatus({ connected: snapshot.connected, id: snapshot.id });
    }
    if (actions.length) this.emit("actions", actions);
    if (haptic) this.#pulse(gamepad);
    this.#emitSnapshot(snapshot, false);
  }

  #pulse(gamepad) {
    try {
      const actuator = gamepad?.vibrationActuator;
      const effect = actuator?.playEffect?.("dual-rumble", { duration: 38, strongMagnitude: 0.14, weakMagnitude: 0.34 });
      if (effect && typeof effect.catch === "function") effect.catch(() => undefined);
    } catch {
      // Rumble is cosmetic; a controller without haptics must not interrupt the poll loop.
    }
  }

  // Stick positions only drive a visualisation, so they go out at a rate a human can see rather
  // than once per poll. Without this the renderer would re-render 60 times a second forever.
  #emitSnapshot(snapshot, force) {
    const now = Date.now();
    const due = now - this.lastSnapshotAt >= 1000 / SNAPSHOT_HZ;
    if (!force && !(snapshotChanged(this.lastSnapshot, snapshot) && due)) return;
    this.lastSnapshot = snapshot;
    this.lastSnapshotAt = now;
    this.emit("snapshot", snapshot);
  }

  #setStatus(patch) {
    this.status = { ...this.status, ...patch };
    this.emit("status", this.status);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    try {
      this.manager?.destroy?.();
    } catch {
      // Teardown races with process exit; nothing useful to report here.
    }
    this.manager = null;
    this.lastSnapshot = EMPTY_SNAPSHOT;
  }
}

module.exports = { GamepadSource, POLL_HZ, SNAPSHOT_HZ };
