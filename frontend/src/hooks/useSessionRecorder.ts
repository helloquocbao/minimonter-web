import { useCallback, useRef, useState } from "react";
import { haversineMeters, type LatLng } from "../lib/geo";

/** Ignore GPS/joystick jitter: a fix reporting a "jump" smaller than this doesn't count toward
 *  distance. */
const MIN_STEP_METERS = 3;

/** Discard GPS fixes the device itself reports as this imprecise (in metres). A low-confidence
 *  fix is the main cause of a walked loop coming out as a jagged, zig-zagging mess that doesn't
 *  follow the street: the phone briefly "teleports" sideways by tens of metres, and those bogus
 *  points survive simplification because they look like genuine sharp turns. Consumer GPS is
 *  usually 5-10m outdoors, so 25m is a generous cut-off that only rejects clearly bad data. */
const MAX_ACCEPTABLE_ACCURACY_METERS = 25;

/** Upper bound on plausible walking/jogging speed between two consecutive fixes. Anything faster
 *  is a GPS glitch rather than movement, and dropping it prevents a single spike from distorting
 *  the shape (and inflating the distance the contract is asked to trust). */
const MAX_PLAUSIBLE_SPEED_METERS_PER_SECOND = 8;

export interface RecordedSession {
  path: LatLng[];
  distanceMeters: number;
  durationSeconds: number;
  startedAt: LatLng;
}

export function useSessionRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [path, setPath] = useState<LatLng[]>([]);
  const [distanceMeters, setDistanceMeters] = useState(0);
  const watchIdRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const isRecordingRef = useRef(false);
  /** Timestamp of the last accepted fix, used for the speed-plausibility filter. */
  const lastFixAtRef = useRef<number>(0);
  const lastFixRef = useRef<LatLng | null>(null);

  /** Shared by both the real GPS watcher and the virtual joystick — appends a point to the
   *  path and accumulates distance, ignoring sub-MIN_STEP_METERS jitter either way. */
  const pushPosition = useCallback((next: LatLng) => {
    setPath((prev) => {
      const last = prev[prev.length - 1];
      if (last) {
        const step = haversineMeters(last, next);
        if (step < MIN_STEP_METERS) return prev;
        setDistanceMeters((d) => d + step);
      }
      return [...prev, next];
    });
  }, []);

  const start = useCallback(() => {
    setPath([]);
    setDistanceMeters(0);
    startTimeRef.current = Date.now();
    lastFixAtRef.current = 0;
    lastFixRef.current = null;
    isRecordingRef.current = true;
    setIsRecording(true);

    if (!("geolocation" in navigator)) {
      // No GPS available (e.g. desktop dev/demo) — the virtual joystick can still drive
      // movement via pushManualPosition below.
      return;
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        const next: LatLng = { lat: latitude, lng: longitude };

        // Drop fixes the device flags as low-confidence — these are what turn a smooth walk
        // into a spiky polygon that ignores the road it followed.
        if (typeof accuracy === "number" && accuracy > MAX_ACCEPTABLE_ACCURACY_METERS) return;

        // Drop physically impossible jumps between consecutive fixes (tunnel exits, urban
        // canyon reflections) for the same reason.
        const now = position.timestamp ?? Date.now();
        const previous = lastFixRef.current;
        if (previous && lastFixAtRef.current) {
          const seconds = Math.max(0.001, (now - lastFixAtRef.current) / 1000);
          const speed = haversineMeters(previous, next) / seconds;
          if (speed > MAX_PLAUSIBLE_SPEED_METERS_PER_SECOND) return;
        }

        lastFixRef.current = next;
        lastFixAtRef.current = now;
        pushPosition(next);
      },
      (error) => console.error("Geolocation error:", error.message),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    );
  }, [pushPosition]);

  /** Feed a simulated position from the virtual joystick — only has an effect while a session
   *  is actively recording. Lets the joystick stand in for real GPS movement (dev/demo, or any
   *  time the player wants to steer without physically walking). Reads isRecordingRef instead
   *  of the isRecording state to avoid this callback's identity changing every start/stop. */
  const pushManualPosition = useCallback(
    (next: LatLng) => {
      if (!isRecordingRef.current) return;
      pushPosition(next);
    },
    [pushPosition]
  );

  const stop = useCallback((): RecordedSession | null => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    isRecordingRef.current = false;
    setIsRecording(false);

    if (path.length === 0) return null;

    return {
      path,
      distanceMeters: Math.round(distanceMeters),
      durationSeconds: Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000)),
      startedAt: path[0],
    };
  }, [path, distanceMeters]);

  return { isRecording, path, distanceMeters, start, stop, pushManualPosition };
}
