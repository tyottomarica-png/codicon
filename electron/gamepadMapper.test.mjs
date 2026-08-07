import mapper from "./gamepadMapper.cjs";

const { createControllerMapper, sectorFromAxes, angleFromAxes } = mapper;

const BINDINGS = {
  primary: 0,
  cancel: 1,
  focusComposer: 2,
  newThread: 3,
  powerWheel: 4,
  pushToTalk: 5,
  fastMode: 11,
  settings: 9,
};

const CONFIG = { bindings: BINDINGS, deadzone: 0.42, modelCount: 3, effortCount: 5, enabled: true };

/** Build one standard-mapped pad with the named buttons held and the given stick positions. */
function pad({ held = [], left = [0, 0], right = [0, 0] } = {}) {
  const buttons = Array.from({ length: 17 }, (_, index) => ({ pressed: held.includes(index), value: held.includes(index) ? 1 : 0 }));
  return [{ id: "Test Controller", index: 0, connected: true, mapping: "standard", buttons, axes: [left[0], left[1], right[0], right[1]] }];
}

const types = (result) => result.actions.map((action) => action.type);

describe("gamepad sector math", () => {
  // Pinned against src/lib/radial.test.ts so the main-process copy cannot drift from the renderer's.
  it("matches the renderer's radial helper", () => {
    expect(angleFromAxes(0, -1)).toBeCloseTo(0);
    expect(angleFromAxes(1, 0)).toBeCloseTo(90);
    expect(angleFromAxes(0, 1)).toBeCloseTo(180);
    expect(angleFromAxes(-1, 0)).toBeCloseTo(270);
    expect(sectorFromAxes(0, -1, 3)).toBe(0);
    expect(sectorFromAxes(1, 0.3, 3)).toBe(1);
    expect(sectorFromAxes(-1, 0.3, 3)).toBe(2);
    expect(sectorFromAxes(0.1, 0.1, 3)).toBeNull();
  });
});

describe("controller mapper", () => {
  it("reports nothing while no controller is present", () => {
    const controller = createControllerMapper();
    const result = controller.update([], CONFIG);
    expect(result.actions).toEqual([]);
    expect(result.snapshot.connected).toBe(false);
  });

  it("ignores unconnected entries and prefers a standard mapping", () => {
    const controller = createControllerMapper();
    const nonStandard = { id: "odd", connected: true, mapping: "", buttons: [], axes: [] };
    const standard = pad()[0];
    const result = controller.update([null, nonStandard, standard], CONFIG);
    expect(result.snapshot.id).toBe("Test Controller");
  });

  it("fires nothing on the frame a controller appears", () => {
    const controller = createControllerMapper();
    // Whatever the driver reports on enumeration is a baseline, not a press.
    const first = controller.update(pad({ held: [BINDINGS.powerWheel, BINDINGS.primary] }), CONFIG);
    expect(first.actions).toEqual([]);
    expect(first.snapshot.connected).toBe(true);
    expect(first.haptic).toBe(false);
    // Still held on the next poll, so still no edge.
    expect(types(controller.update(pad({ held: [BINDINGS.powerWheel, BINDINGS.primary] }), CONFIG))).toEqual([]);
    // A genuine release-then-press is an edge.
    controller.update(pad(), CONFIG);
    expect(types(controller.update(pad({ held: [BINDINGS.primary] }), CONFIG))).toEqual(["primary"]);
  });

  it("re-seeds after a disconnect so reconnecting does not replay held buttons", () => {
    const controller = createControllerMapper();
    controller.update(pad(), CONFIG);
    controller.update([], CONFIG);
    expect(types(controller.update(pad({ held: [BINDINGS.primary] }), CONFIG))).toEqual([]);
  });

  it("re-seeds when a different controller takes over", () => {
    const controller = createControllerMapper();
    controller.update(pad(), CONFIG);
    const replacement = pad({ held: [BINDINGS.primary] });
    replacement[0].id = "Second Controller";
    expect(types(controller.update(replacement, CONFIG))).toEqual([]);
    expect(types(controller.update(replacement, CONFIG))).toEqual([]);
  });

  it("fires an edge-triggered action once per press", () => {
    const controller = createControllerMapper();
    controller.update(pad(), CONFIG);
    expect(types(controller.update(pad({ held: [BINDINGS.primary] }), CONFIG))).toEqual(["primary"]);
    expect(types(controller.update(pad({ held: [BINDINGS.primary] }), CONFIG))).toEqual([]);
    expect(types(controller.update(pad(), CONFIG))).toEqual([]);
  });

  it("opens, previews, and commits the power wheel", () => {
    const controller = createControllerMapper();
    controller.update(pad(), CONFIG);

    const opened = controller.update(pad({ held: [BINDINGS.powerWheel] }), CONFIG);
    expect(types(opened)).toContain("wheel/open");
    expect(opened.haptic).toBe(true);

    const previewed = controller.update(pad({ held: [BINDINGS.powerWheel], left: [1, 0.3] }), CONFIG);
    expect(previewed.actions).toContainEqual({ type: "wheel/preview", modelIndex: 1, effortIndex: null });

    // The same stick position must not re-emit.
    expect(types(controller.update(pad({ held: [BINDINGS.powerWheel], left: [1, 0.3] }), CONFIG))).toEqual([]);

    expect(types(controller.update(pad(), CONFIG))).toEqual(["wheel/commit"]);
  });

  it("suppresses the ordinary buttons while the wheel is held", () => {
    const controller = createControllerMapper();
    controller.update(pad(), CONFIG);
    controller.update(pad({ held: [BINDINGS.powerWheel] }), CONFIG);
    const result = controller.update(pad({ held: [BINDINGS.powerWheel, BINDINGS.primary, BINDINGS.newThread] }), CONFIG);
    expect(types(result)).not.toContain("primary");
    expect(types(result)).not.toContain("newThread");
  });

  it("cancels the wheel with B instead of interrupting the turn", () => {
    const controller = createControllerMapper();
    controller.update(pad(), CONFIG);
    controller.update(pad({ held: [BINDINGS.powerWheel] }), CONFIG);
    expect(types(controller.update(pad({ held: [BINDINGS.powerWheel, BINDINGS.cancel] }), CONFIG))).toEqual(["wheel/cancel"]);
    // Wheel is closed now, so releasing the shoulder button must not also commit.
    expect(types(controller.update(pad(), CONFIG))).toEqual([]);
  });

  it("sends cancel when the wheel is closed", () => {
    const controller = createControllerMapper();
    controller.update(pad(), CONFIG);
    expect(types(controller.update(pad({ held: [BINDINGS.cancel] }), CONFIG))).toEqual(["cancel"]);
  });

  it("toggles fast mode from the right stick click", () => {
    const controller = createControllerMapper();
    controller.update(pad(), CONFIG);
    expect(types(controller.update(pad({ held: [BINDINGS.fastMode] }), CONFIG))).toEqual(["fastToggle"]);
  });

  it("starts and stops Push to Talk", () => {
    const controller = createControllerMapper();
    controller.update(pad(), CONFIG);
    expect(types(controller.update(pad({ held: [BINDINGS.pushToTalk] }), CONFIG))).toEqual(["pushToTalk/start"]);
    expect(types(controller.update(pad(), CONFIG))).toEqual(["pushToTalk/stop"]);
  });

  it("still stops Push to Talk when the wheel opens mid-hold", () => {
    const controller = createControllerMapper();
    controller.update(pad(), CONFIG);
    controller.update(pad({ held: [BINDINGS.pushToTalk] }), CONFIG);
    controller.update(pad({ held: [BINDINGS.pushToTalk, BINDINGS.powerWheel] }), CONFIG);
    const released = controller.update(pad({ held: [BINDINGS.powerWheel] }), CONFIG);
    expect(types(released)).toContain("pushToTalk/stop");
  });

  it("stops Push to Talk when the controller disappears mid-hold", () => {
    const controller = createControllerMapper();
    controller.update(pad(), CONFIG);
    controller.update(pad({ held: [BINDINGS.pushToTalk] }), CONFIG);
    expect(types(controller.update([], CONFIG))).toEqual(["pushToTalk/stop"]);
  });

  it("cancels an open wheel when the controller disappears", () => {
    const controller = createControllerMapper();
    controller.update(pad(), CONFIG);
    controller.update(pad({ held: [BINDINGS.powerWheel] }), CONFIG);
    expect(types(controller.update([], CONFIG))).toEqual(["wheel/cancel"]);
  });

  it("does not start Push to Talk on the same frame the wheel opens", () => {
    const controller = createControllerMapper();
    controller.update(pad(), CONFIG);
    const together = controller.update(pad({ held: [BINDINGS.pushToTalk, BINDINGS.powerWheel] }), CONFIG);
    expect(types(together)).toEqual(["wheel/open"]);
  });

  it("releases held state on reset", () => {
    const controller = createControllerMapper();
    controller.update(pad(), CONFIG);
    controller.update(pad({ held: [BINDINGS.pushToTalk] }), CONFIG);
    controller.update(pad({ held: [BINDINGS.pushToTalk, BINDINGS.powerWheel] }), CONFIG);
    expect(controller.reset().map((action) => action.type)).toEqual(["wheel/cancel", "pushToTalk/stop"]);
    expect(controller.reset()).toEqual([]);
  });

  it("honours a custom deadzone", () => {
    const controller = createControllerMapper();
    const wide = { ...CONFIG, deadzone: 0.9 };
    controller.update(pad(), wide);
    controller.update(pad({ held: [BINDINGS.powerWheel] }), wide);
    // Half deflection clears the default deadzone but not this one, so nothing is previewed.
    expect(types(controller.update(pad({ held: [BINDINGS.powerWheel], left: [0.5, 0] }), wide))).toEqual([]);
    const full = controller.update(pad({ held: [BINDINGS.powerWheel], left: [1, 0] }), wide);
    expect(full.actions).toContainEqual({ type: "wheel/preview", modelIndex: 1, effortIndex: null });
  });
});
