import type { ReactNode } from "react";

const tones = {
  pink: "bg-primary text-ink",
  black: "bg-ink text-white",
  white: "bg-surface text-ink",
  soft: "bg-primary-soft text-primary-ink",
  green: "bg-emerald-200 text-emerald-900",
  yellow: "bg-amber-200 text-amber-900",
};

/** Die-cut sticker: thick white border, slight tilt, straightens on hover. */
export function Sticker({
  children,
  tone = "pink",
  rotate = -4,
  className = "",
}: {
  children: ReactNode;
  tone?: keyof typeof tones;
  rotate?: number;
  className?: string;
}) {
  return (
    <span
      style={{ rotate: `${rotate}deg` }}
      className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs leading-normal font-extrabold tracking-normal whitespace-nowrap shadow-[0_6px_14px_-6px_#0006] ring-[3px] ring-white transition duration-200 select-none hover:scale-110 hover:!rotate-0 ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
