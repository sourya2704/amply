import { useEffect, useState } from "react";
import { Check, Zap } from "lucide-react";

// A looping mini-demo of the app for the landing page: a car follows a route to a charger,
// the "charger found" sheet shows the battery filling, and the owner's acceptance pops in.
// Plain SVG + CSS; motion is skipped for people who prefer reduced motion.

const ROUTE = "M70 470 L70 330 L170 330 L170 200 L245 200";
const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function useBattery() {
  const [pct, setPct] = useState(reduced ? 80 : 18);
  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => setPct((p) => (p >= 92 ? 18 : p + 1)), 90);
    return () => clearInterval(id);
  }, []);
  return pct;
}

export default function PhoneDemo() {
  const battery = useBattery();
  return (
    <div className="relative mx-auto w-[280px] sm:w-[300px]" aria-hidden>
      {/* phone frame */}
      <div className="relative overflow-hidden rounded-[2.6rem] border-[10px] border-ink bg-[#f3efe8] shadow-[0_40px_80px_-30px_#0007]">
        <div className="absolute top-2 left-1/2 z-20 h-5 w-24 -translate-x-1/2 rounded-full bg-ink" />

        <svg viewBox="0 0 320 560" className="block h-auto w-full">
          {/* city blocks */}
          {[
            [20, 40, 110, 120],
            [150, 40, 150, 120],
            [20, 210, 110, 90],
            [195, 225, 105, 75],
            [100, 355, 50, 90],
            [195, 355, 105, 110],
            [20, 495, 280, 60],
          ].map(([x, y, w, h], i) => (
            <rect key={i} x={x} y={y} width={w} height={h} rx={10} fill="#e6e0d6" />
          ))}
          <rect x="195" y="355" width="105" height="110" rx="10" fill="#cfe8c9" />
          <ellipse cx="75" cy="100" rx="38" ry="30" fill="#bfe0f2" />
          {/* roads */}
          {["M0 175 H320", "M0 330 H320", "M0 480 H320", "M70 0 V560", "M170 0 V560", "M245 0 V340"].map((d) => (
            <path key={d} d={d} stroke="#ffffff" strokeWidth="14" />
          ))}

          {/* other chargers */}
          {[
            [245, 420, "#a3a3a3"],
            [120, 175, "#ff7ab8"],
            [290, 120, "#10b981"],
          ].map(([x, y, c], i) => (
            <circle key={i} cx={x} cy={y} r="7" fill={c as string} stroke="#fff" strokeWidth="3" />
          ))}

          {/* route */}
          <path d={ROUTE} fill="none" stroke="#111" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" opacity="0.15" />
          <path
            d={ROUTE}
            fill="none"
            stroke="#111"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="420"
            strokeDashoffset={reduced ? 0 : 420}
          >
            {!reduced && <animate attributeName="stroke-dashoffset" values="420;0;0" keyTimes="0;0.7;1" dur="6s" repeatCount="indefinite" />}
          </path>

          {/* destination charger: pink pin with a pulse */}
          <g transform="translate(245 200)">
            {!reduced && (
              <circle r="10" fill="#ffa3cf">
                <animate attributeName="r" values="10;28" dur="1.6s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.7;0" dur="1.6s" repeatCount="indefinite" />
              </circle>
            )}
            <path d="M0 -34 C 14 -34 22 -24 22 -13 C 22 2 0 12 0 12 C 0 12 -22 2 -22 -13 C -22 -24 -14 -34 0 -34 Z" fill="#ffa3cf" stroke="#111" strokeWidth="3" />
            <path d="M2 -26 L-6 -12 H0 L-2 -2 L7 -17 H1 Z" fill="#111" />
          </g>

          {/* the car: arrow points along +x so animateMotion's rotate="auto" faces it forward */}
          <g transform={reduced ? "translate(215 200)" : undefined}>
            <circle r="13" fill="#111" stroke="#fff" strokeWidth="4" />
            <path d="M0 -6 L5 5 L0 2 L-5 5 Z" fill="#fff" transform="rotate(90)" />
            {!reduced && <animateMotion dur="6s" repeatCount="indefinite" rotate="auto" keyPoints="0;1;1" keyTimes="0;0.7;1" calcMode="linear" path={ROUTE} />}
          </g>
        </svg>

        {/* booking accepted toast */}
        <div className="absolute top-10 right-3 left-3 z-10 flex animate-[toast_6s_ease-in-out_infinite] items-center gap-2 rounded-2xl bg-ink px-3 py-2.5 text-xs font-semibold text-white shadow-lg">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary text-ink">
            <Check size={14} strokeWidth={3} />
          </span>
          Ravi accepted your booking · 6:00 PM
        </div>

        {/* bottom sheet */}
        <div className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-white p-4 shadow-[0_-10px_30px_-10px_#0003]">
          <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-line" />
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-sm font-extrabold">Ravi's Home Charger</div>
              <div className="text-[11px] text-muted">0.4 km · CCS2 DC · 30 kW</div>
            </div>
            <div className="text-right">
              <div className="text-base font-extrabold">₹18</div>
              <div className="text-[10px] text-muted">per kWh</div>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full rounded-full bg-primary transition-[width] duration-100" style={{ width: `${battery}%` }} />
            </div>
            <span className="flex w-12 items-center justify-end gap-0.5 text-xs font-extrabold tabular-nums">
              <Zap size={11} fill="currentColor" />
              {battery}%
            </span>
          </div>
          <div className="mt-3 rounded-xl bg-primary py-2.5 text-center text-sm font-extrabold">Charging</div>
        </div>
      </div>
    </div>
  );
}
