import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./auth";

// Live device location for the map. Asked for only when the driver taps "Use my location" (PRD §10:
// request location at the point it's useful). Positions stay in the browser; the app only sends the current
// coordinates with a search, and nothing is stored. If permission was granted before, it resumes automatically.

export type LocationStatus = "off" | "asking" | "on" | "denied" | "unavailable";

export interface LiveLocation {
  lat: number;
  lng: number;
  accuracy: number; // metres
}

// The "keep location on" choice is remembered per account, so logging in as someone else on the same browser
// never turns location on automatically.
const prefKey = (userId: string) => `amply_live_location:${userId}`;

function remember(userId: string | undefined, on: boolean) {
  if (!userId) return;
  try {
    if (on) localStorage.setItem(prefKey(userId), "on");
    else localStorage.removeItem(prefKey(userId));
  } catch {
    /* storage unavailable */
  }
}

export function useLiveLocation() {
  const { user } = useAuth();
  const userId = user?.id;
  const [status, setStatus] = useState<LocationStatus>("off");
  const [position, setPosition] = useState<LiveLocation | null>(null);
  const watchId = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (watchId.current !== null) navigator.geolocation?.clearWatch(watchId.current);
    watchId.current = null;
    setStatus("off");
    remember(userId, false);
  }, [userId]);

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
        remember(userId, true);
      },
      (err) => {
        if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
        watchId.current = null;
        setStatus(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable");
        if (err.code === err.PERMISSION_DENIED) remember(userId, false);
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
    );
  }, [userId]);

  // Resume automatically only if the driver turned it on before and the browser still allows it.
  useEffect(() => {
    if (!userId) return;
    let wanted = false;
    try {
      localStorage.removeItem("amply_live_location"); // old browser-wide setting
      wanted = localStorage.getItem(prefKey(userId)) === "on";
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
  }, [start, userId]);

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
