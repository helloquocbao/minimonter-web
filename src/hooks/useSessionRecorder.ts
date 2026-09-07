import { useCallback, useRef, useState } from "react";
import { haversineMeters, type LatLng } from "../lib/geo";

/** Ignore GPS jitter: a fix reporting a "jump" smaller than this doesn't count toward distance. */
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

  const start = useCallback(() => {
    if (!("geolocation" in navigator)) {
      throw new Error("Thiết bị không hỗ trợ định vị GPS.");
    }

    setPath([]);
    setDistanceMeters(0);
    startTimeRef.current = Date.now();
    setIsRecording(true);

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const next: LatLng = { lat: position.coords.latitude, lng: position.coords.longitude };
        setPath((prev) => {
          const last = prev[prev.length - 1];
          if (last) {
            const step = haversineMeters(last, next);
            if (step < MIN_STEP_METERS) return prev;
            setDistanceMeters((d) => d + step);
          }
          return [...prev, next];
        });
      },
      (error) => console.error("Geolocation error:", error.message),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    );
  }, []);

  const stop = useCallback((): RecordedSession | null => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setIsRecording(false);

    if (path.length === 0) return null;

    return {
      path,
      distanceMeters: Math.round(distanceMeters),
      durationSeconds: Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000)),
      startedAt: path[0],
    };
  }, [path, distanceMeters]);

  return { isRecording, path, distanceMeters, start, stop };
}
