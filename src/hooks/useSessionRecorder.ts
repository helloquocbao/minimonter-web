import { useCallback, useRef, useState } from "react";
import { haversineMeters, type LatLng } from "../lib/geo";

/** Ignore GPS/joystick jitter: a fix reporting a "jump" smaller than this doesn't count toward
 *  distance. */
const MIN_STEP_METERS = 3;

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
    isRecordingRef.current = true;
    setIsRecording(true);

    if (!("geolocation" in navigator)) {
      // No GPS available (e.g. desktop dev/demo) — the virtual joystick can still drive
      // movement via pushManualPosition below.
      return;
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        pushPosition({ lat: position.coords.latitude, lng: position.coords.longitude });
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
