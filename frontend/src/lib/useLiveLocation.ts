import { useCallback, useEffect, useRef, useState } from "react";

// Live device location for the map. Asked for only when the driver taps "Use my location" (PRD §10:
// request location at the point it's useful). Positions stay in the browser; the app only sends the current
// coordinates with a search, and nothing is stored. If permission was granted before, it resumes automatically.

export type LocationStatus = "off" | "asking" | "on" | "denied" | "unavailable";

export interface LiveLocation {
  lat: number;
  lng: number;
  accuracy: number; // metres
}

const PREF_KEY = "amply_live_location";

function remember(on: boolean) {
  try {
    if (on) localStorage.setItem(PREF_KEY, "on");
    else localStorage.removeItem(PREF_KEY);
  } catch {
    /* storage unavailable */
  }
}

export function useLiveLocation() {
  const [status, setStatus] = useState<LocationStatus>("off");
  const [position, setPosition] = useState<LiveLocation | null>(null);
  const watchId = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (watchId.current !== null) navigator.geolocation?.clearWatch(watchId.current);
    watchId.current = null;
    setStatus("off");
    remember(false);
  }, []);

  const start = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setStatus("unavailable");
      return;
    }
    if (watchId.current !== null) return;
    setStatus("asking");
    watchId.current = navigator.geolocation.watchPosition(
      (p) => {
        setPosition({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy });
        setStatus("on");
        remember(true);
      },
      (err) => {
        if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
        watchId.current = null;
        setStatus(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable");
        if (err.code === err.PERMISSION_DENIED) remember(false);
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
    );
  }, []);

  // Resume automatically only if the driver turned it on before and the browser still allows it.
  useEffect(() => {
    let wanted = false;
    try {
      wanted = localStorage.getItem(PREF_KEY) === "on";
    } catch {
      /* ignore */
    }
    if (!wanted || !navigator.permissions?.query) return;
    navigator.permissions
      .query({ name: "geolocation" })
      .then((s) => {
        if (s.state === "granted") start();
      })
      .catch(() => {});
  }, [start]);

  useEffect(
    () => () => {
      if (watchId.current !== null) navigator.geolocation?.clearWatch(watchId.current);
    },
    [],
  );

  return { status, position, start, stop };
}

/** Straight-line distance in metres. */
export function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}
