// Amply's mark: a bold capital A whose crossbar is a lightning bolt, on the signature pink tile.

const BOLT = "M8.5 29.5 L20 23 L24.5 30 L39.5 21.5";

export function AMark({ size = 40, className = "" }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} className={`shrink-0 ${className}`} aria-hidden>
      <rect width="48" height="48" rx="13" fill="#ffa3cf" />
      {/* the A */}
      <path d="M12.5 38 L24 9.5 L35.5 38" fill="none" stroke="#111" strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* lightning-bolt crossbar: a pink gap cuts the legs, then a black zig-zag */}
      <path d={BOLT} fill="none" stroke="#ffa3cf" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" />
      <path d={BOLT} fill="none" stroke="#111" strokeWidth="4.6" strokeLinecap="round" strokeLinejoin="miter" strokeMiterlimit="10" />
    </svg>
  );
}

/** "Amply" wordmark: the A tile, then "mply". `compact` hides the letters on small screens. */
export function Wordmark({ size = 40, dark = false, compact = false }: { size?: number; dark?: boolean; compact?: boolean }) {
  return (
    <span className="inline-flex items-end" aria-label="Amply">
      <AMark size={size} className="-rotate-6 drop-shadow-[0_3px_6px_#0002]" />
      <span
        className={`-ml-0.5 leading-none font-black tracking-tighter ${dark ? "text-white" : "text-ink"} ${compact ? "hidden sm:inline" : ""}`}
        style={{ fontSize: size * 0.78, paddingBottom: size * 0.09 }}
      >
        mply
      </span>
    </span>
  );
}
