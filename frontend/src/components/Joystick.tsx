import { useCallback, useRef, useState } from "react";

interface JoystickProps {
  onChange: (direction: { x: number; y: number } | null) => void;
}

const RADIUS = 44; // px — half of the base's diameter, also the knob's max travel distance

/**
 * Virtual on-screen joystick — drag the knob in any direction to drive continuous movement
 * (see useJoystickMovement). Reports a normalized {x, y} vector (y-up, matching lat/lng north-
 * positive convention) while held, and null on release. Pointer Events so it works uniformly
 * for touch, mouse, and pen.
 */
export function Joystick({ onChange }: JoystickProps) {
  const baseRef = useRef<HTMLDivElement | null>(null);
  const activePointerId = useRef<number | null>(null);
  const [knobOffset, setKnobOffset] = useState({ x: 0, y: 0 });

  const updateFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const base = baseRef.current;
      if (!base) return;
      const rect = base.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      let dx = clientX - centerX;
      let dy = clientY - centerY;
      const dist = Math.hypot(dx, dy);
      if (dist > RADIUS) {
        dx = (dx / dist) * RADIUS;
        dy = (dy / dist) * RADIUS;
      }

      setKnobOffset({ x: dx, y: dy });
      // Screen y grows downward; lat grows northward (up) — flip so pushing the knob up means
      // "move north", matching the player's mental model of the map.
      onChange({ x: dx / RADIUS, y: -dy / RADIUS });
    },
    [onChange]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      activePointerId.current = e.pointerId;
      e.currentTarget.setPointerCapture(e.pointerId);
      updateFromPointer(e.clientX, e.clientY);
    },
    [updateFromPointer]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (activePointerId.current !== e.pointerId) return;
      updateFromPointer(e.clientX, e.clientY);
    },
    [updateFromPointer]
  );

  const release = useCallback(() => {
    activePointerId.current = null;
    setKnobOffset({ x: 0, y: 0 });
    onChange(null);
  }, [onChange]);

  return (
    <div
      ref={baseRef}
      className="joystick-base"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={release}
      onPointerCancel={release}
    >
      <div
        className="joystick-knob"
        style={{ transform: `translate(${knobOffset.x}px, ${knobOffset.y}px)` }}
      />
    </div>
  );
}
