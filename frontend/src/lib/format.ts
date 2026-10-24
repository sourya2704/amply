import type { AvailabilitySource, BookingStatus } from "./types";

export const formatINR = (paise: number) =>
  "₹" + (paise / 100).toLocaleString("en-IN", { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 });

const tz = { timeZone: "Asia/Kolkata" } as const;

export const formatTime = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { ...tz, hour: "numeric", minute: "2-digit" });

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { ...tz, weekday: "short", day: "numeric", month: "short" });

export const formatDateTime = (iso: string) => `${formatDate(iso)}, ${formatTime(iso)}`;

export const formatRange = (start: string, end: string) => `${formatDate(start)} · ${formatTime(start)} – ${formatTime(end)}`;

/** Today's date in IST as YYYY-MM-DD. */
export function todayIST(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return d.toLocaleDateString("en-CA", tz);
}

export const availabilityStyle: Record<AvailabilitySource, { dot: string; chip: string; pin: string }> = {
  live: { dot: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200", pin: "#10b981" },
  schedule: { dot: "bg-brand", chip: "bg-blue-50 text-brand ring-blue-200", pin: "#315CFF" },
  reported: { dot: "bg-cyan", chip: "bg-cyan-50 text-cyan-800 ring-cyan-200", pin: "#19C6D2" },
  stale: { dot: "bg-amber-500", chip: "bg-amber-50 text-amber-800 ring-amber-200", pin: "#f59e0b" },
  unknown: { dot: "bg-slate-400", chip: "bg-slate-100 text-slate-600 ring-slate-200", pin: "#94a3b8" },
};

export const statusStyle: Record<BookingStatus, string> = {
  requested: "bg-amber-50 text-amber-800 ring-amber-200",
  accepted: "bg-blue-50 text-brand ring-blue-200",
  confirmed: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  completed: "bg-slate-800 text-white ring-slate-800",
  rejected: "bg-rose-50 text-rose-700 ring-rose-200",
  cancelled: "bg-slate-100 text-slate-500 ring-slate-200",
};

export const statusLabel: Record<BookingStatus, string> = {
  requested: "Waiting for owner",
  accepted: "Accepted · pay to confirm",
  confirmed: "Confirmed",
  completed: "Completed",
  rejected: "Declined",
  cancelled: "Cancelled",
};

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const KORAMANGALA = { lat: 12.9352, lng: 77.6245 };
