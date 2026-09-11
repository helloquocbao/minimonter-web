import { useCallback, useEffect, useRef, useState } from "react";
import type { LatLng } from "./geo";

/** Average walking pace — matches the anti-cheat speed cap's ballpark (see
 *  MAX_SPEED_METERS_PER_SECOND in TerraChainGame.sol) so joystick-driven test/demo movement
 *  produces sessions the contract would actually accept. */
const SIMULATED_SPEED_METERS_PER_SECOND = 1.4;
const TICK_MS = 200;

/** Moves a lat/lng point by a given distance/bearing, using the same flat-earth approximation
 *  the contract itself uses (METERS_PER_DEGREE in TerraChainGame.sol) so joystick movement lines
 *  up with what the game considers "how far you walked". */
function moveBy(point: LatLng, dx: number, dy: number): LatLng {
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLng = 111_320 * Math.cos((point.lat * Math.PI) / 180);
  return {
    lat: point.lat + dy / metersPerDegreeLat,
    lng: point.lng + dx / metersPerDegreeLng,
  };
}

/**
 * Drives continuous movement from a joystick's held direction vector (x, y in [-1, 1], y-up).
 * While a direction is held, ticks every TICK_MS and reports a new point moved at
 * SIMULATED_SPEED_METERS_PER_SECOND along that heading — same shape of updates a real GPS walk
 * would produce, just synthetic. Call `setDirection` continuously while dragging and
 * `setDirection(null)` on release.
 */
export function useJoystickMovement(origin: LatLng, onMove: (next: LatLng) => void) {
  const directionRef = useRef<{ x: number; y: number } | null>(null);
  const positionRef = useRef<LatLng>(origin);
  const intervalRef = useRef<number | null>(null);

  // Keep the simulated position in sync whenever the caller's own notion of "current position"
  // changes for an unrelated reason (e.g. a fresh real GPS fix arrives).
  useEffect(() => {
    positionRef.current = origin;
  }, [origin.lat, origin.lng]);

  const setDirection = useCallback((direction: { x: number; y: number } | null) => {
    directionRef.current = direction;
  }, []);

  useEffect(() => {
    intervalRef.current = window.setInterval(() => {
      const dir = directionRef.current;
      if (!dir) return;
      const magnitude = Math.hypot(dir.x, dir.y);
      if (magnitude < 0.05) return;

      const distance = SIMULATED_SPEED_METERS_PER_SECOND * (TICK_MS / 1000);
      const dx = (dir.x / magnitude) * distance;
      const dy = (dir.y / magnitude) * distance;

      const next = moveBy(positionRef.current, dx, dy);
      positionRef.current = next;
      onMove(next);
    }, TICK_MS);

    return () => {
      if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    };
  }, [onMove]);

  return { setDirection };
}

export { SIMULATED_SPEED_METERS_PER_SECOND };
