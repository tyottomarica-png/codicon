export type Point = { x: number; y: number };

export function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

export function angleFromAxes(x: number, y: number): number {
  return normalizeDegrees((Math.atan2(y, x) * 180) / Math.PI + 90);
}

export function magnitudeFromAxes(x: number, y: number): number {
  return Math.min(1, Math.hypot(x, y));
}

export function sectorFromAxes(x: number, y: number, count: number, deadzone = 0.42): number | null {
  if (count < 1 || magnitudeFromAxes(x, y) < deadzone) return null;
  const angle = angleFromAxes(x, y);
  return Math.floor((angle + 180 / count) / (360 / count)) % count;
}

export function polarPoint(radius: number, degrees: number): Point {
  const radians = ((degrees - 90) * Math.PI) / 180;
  return { x: radius * Math.cos(radians), y: radius * Math.sin(radians) };
}

export function annularSectorPath(innerRadius: number, outerRadius: number, startDegrees: number, endDegrees: number): string {
  const outerStart = polarPoint(outerRadius, endDegrees);
  const outerEnd = polarPoint(outerRadius, startDegrees);
  const innerStart = polarPoint(innerRadius, startDegrees);
  const innerEnd = polarPoint(innerRadius, endDegrees);
  const span = normalizeDegrees(endDegrees - startDegrees);
  const largeArc = span > 180 ? 1 : 0;
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 0 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerStart.x} ${innerStart.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 1 ${innerEnd.x} ${innerEnd.y}`,
    "Z",
  ].join(" ");
}

export function effortLabel(value: string): string {
  const labels: Record<string, string> = {
    minimal: "MIN",
    low: "LOW",
    medium: "MED",
    high: "HIGH",
    xhigh: "XHIGH",
    ultra: "ULTRA",
  };
  return labels[value.toLowerCase()] || value.toUpperCase();
}
