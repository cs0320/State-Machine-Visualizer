import type { Point } from "./nodeGeometry";

/**
 * Point on the curve TransitionEdge draws for a non-self-loop transition (source/target rim
 * points + one perpendicular-offset control point) at parameter `t` (0 = p0, 1 = p1).
 */
export function quadraticBezierPoint(p0: Point, control: Point, p1: Point, t: number): Point {
  const mt = 1 - t;
  return {
    x: mt * mt * p0.x + 2 * mt * t * control.x + t * t * p1.x,
    y: mt * mt * p0.y + 2 * mt * t * control.y + t * t * p1.y,
  };
}

/** Same idea as quadraticBezierPoint, for the two-control-point curve TransitionEdge draws for a self-loop. */
export function cubicBezierPoint(p0: Point, c1: Point, c2: Point, p1: Point, t: number): Point {
  const mt = 1 - t;
  return {
    x: mt * mt * mt * p0.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * p1.x,
    y: mt * mt * mt * p0.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * p1.y,
  };
}

/**
 * Finds the t (0-1) whose point on the curve is closest to `target`, by sampling. Used to
 * constrain a dragged label to a point that's actually on the curve, rather than wherever the
 * pointer happens to be.
 */
export function closestTOnCurve(sample: (t: number) => Point, target: Point, steps = 200): number {
  let bestT = 0.5;
  let bestDistSq = Infinity;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = sample(t);
    const distSq = (p.x - target.x) ** 2 + (p.y - target.y) ** 2;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestT = t;
    }
  }
  return bestT;
}
