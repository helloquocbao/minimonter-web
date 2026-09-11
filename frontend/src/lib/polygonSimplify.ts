import { haversineMeters, type LatLng } from "./geo";

/** How close the walk's end point must be to its start point to count as "closed" — generous
 *  enough to absorb ordinary GPS drift (consumer GPS is commonly accurate to ~5-10m, worse near
 *  tall buildings) without letting a walk that clearly never looped back through. */
export const LOOP_CLOSURE_TOLERANCE_METERS = 20;

/** On-chain polygon vertex cap (mirrors TerraSession.MAX_POLYGON_POINTS) — a raw GPS path can
 *  easily have hundreds of points, so it must be simplified down to at most this many before
 *  submitting, to keep gas (Shoelace area, point-in-polygon, polygon-polygon intersection all
 *  scale with vertex count) bounded on the Creditcoin side. 32 is what a measured Claim can
 *  afford comfortably (~678k gas with several neighbouring chunks — see
 *  contracts/scripts/measure-polygon-gas.ts) and is enough detail for a walked loop to actually
 *  trace the street it followed instead of getting flattened into a coarse blob. */
export const MAX_POLYGON_POINTS = 32;
export const MIN_POLYGON_POINTS = 3;

export function isLoopClosed(path: LatLng[]): boolean {
  if (path.length < 2) return false;
  return haversineMeters(path[0], path[path.length - 1]) <= LOOP_CLOSURE_TOLERANCE_METERS;
}

function perpendicularDistanceMeters(point: LatLng, lineStart: LatLng, lineEnd: LatLng): number {
  // Work in a local flat approximation (meters), same one the contract itself uses, so
  // simplification decisions are consistent with what's actually being submitted on-chain.
  const toXY = (p: LatLng) => ({
    x: (p.lng - lineStart.lng) * 111_320 * Math.cos((lineStart.lat * Math.PI) / 180),
    y: (p.lat - lineStart.lat) * 111_320,
  });
  const a = toXY(lineStart);
  const b = toXY(lineEnd);
  const c = toXY(point);

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(c.x - a.x, c.y - a.y);

  // Cross-product magnitude / segment length = perpendicular distance from c to line a-b.
  const cross = Math.abs((c.x - a.x) * dy - (c.y - a.y) * dx);
  return cross / Math.sqrt(lengthSquared);
}

/** Ramer-Douglas-Peucker polyline simplification — recursively keeps only the point that
 *  deviates most from the current chord (if beyond `epsilonMeters`), discarding everything
 *  that's "close enough" to a straight line. Standard technique for reducing GPS path point
 *  count while preserving the overall shape. */
function douglasPeucker(points: LatLng[], epsilonMeters: number): LatLng[] {
  if (points.length <= 2) return points;

  let maxDist = 0;
  let maxIndex = 0;
  const start = points[0];
  const end = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistanceMeters(points[i], start, end);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }

  if (maxDist <= epsilonMeters) return [start, end];

  const left = douglasPeucker(points.slice(0, maxIndex + 1), epsilonMeters);
  const right = douglasPeucker(points.slice(maxIndex), epsilonMeters);
  return [...left.slice(0, -1), ...right];
}

/**
 * Simplifies a raw GPS path down to at most `maxPoints` vertices for on-chain submission.
 * Assumes the path is already (approximately) a closed loop — the caller is responsible for
 * checking {isLoopClosed} first. Drops the final point (which is expected to coincide with the
 * first, within GPS tolerance) so the resulting polygon is expressed exactly once around,
 * matching TerraSession's "implicitly closed, don't repeat the first point" contract.
 *
 * Increases epsilon and retries if Douglas-Peucker alone doesn't get under maxPoints (dense,
 * noisy paths can need a coarser tolerance) — then falls back to uniform decimation as a last
 * resort so this always terminates with a valid, capped polygon.
 */
export function simplifyLoopForChain(rawPath: LatLng[], maxPoints: number = MAX_POLYGON_POINTS): LatLng[] {
  const openLoop = rawPath.slice(0, -1); // drop the closing point that mirrors the start
  if (openLoop.length <= maxPoints) return openLoop;

  let epsilon = 2; // meters — start fine-grained
  let simplified = douglasPeucker(openLoop, epsilon);
  let guard = 0;
  while (simplified.length > maxPoints && guard < 20) {
    epsilon *= 1.6;
    simplified = douglasPeucker(openLoop, epsilon);
    guard++;
  }

  if (simplified.length > maxPoints) {
    // Fallback: uniform decimation guarantees termination even for pathological inputs.
    const stride = Math.ceil(simplified.length / maxPoints);
    simplified = simplified.filter((_, i) => i % stride === 0).slice(0, maxPoints);
  }

  return simplified;
}
