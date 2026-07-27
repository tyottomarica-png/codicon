import { angleFromAxes, annularSectorPath, sectorFromAxes } from "./radial";

describe("radial input", () => {
  it("maps cardinal directions clockwise from the top", () => {
    expect(angleFromAxes(0, -1)).toBeCloseTo(0);
    expect(angleFromAxes(1, 0)).toBeCloseTo(90);
    expect(angleFromAxes(0, 1)).toBeCloseTo(180);
    expect(angleFromAxes(-1, 0)).toBeCloseTo(270);
  });

  it("selects three model sectors and honors the deadzone", () => {
    expect(sectorFromAxes(0, -1, 3)).toBe(0);
    expect(sectorFromAxes(1, 0.3, 3)).toBe(1);
    expect(sectorFromAxes(-1, 0.3, 3)).toBe(2);
    expect(sectorFromAxes(0.1, 0.1, 3)).toBeNull();
  });

  it("creates a closed annular SVG path", () => {
    expect(annularSectorPath(50, 100, -60, 60)).toMatch(/^M .+ Z$/);
  });
});
