"use client";

import { useRef } from "react";

export interface SegOption {
  value: string;
  label: string;
  accent?: string; // hex; when selected, fill with this colour + white text. Absent → neutral white chip.
  badge?: number;  // optional count badge, top-right
}

interface Props {
  options: (string | SegOption)[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
  className?: string;
}

export default function SegmentedControl({
  options,
  value,
  onChange,
  ariaLabel,
  className = "",
}: Props) {
  const opts = options.map((o): SegOption =>
    typeof o === "string" ? { value: o, label: o } : o
  );

  const containerRef = useRef<HTMLDivElement>(null);

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const idx = opts.findIndex((o) => o.value === value);
    if (idx < 0) return;
    const next =
      e.key === "ArrowLeft"
        ? opts[(idx - 1 + opts.length) % opts.length]
        : opts[(idx + 1) % opts.length];
    onChange(next.value);
    const target = containerRef.current?.querySelector<HTMLElement>(
      `[data-seg-value="${next.value}"]`
    );
    target?.focus();
  }

  return (
    <div
      ref={containerRef}
      role="tablist"
      aria-label={ariaLabel}
      className={`flex glass-tile rounded-xl p-1 gap-1 ${className}`}
      onKeyDown={handleKeyDown}
    >
      {opts.map((o) => {
        const selected = value === o.value;
        const hasAccent = selected && !!o.accent;

        let selectedClasses = "";
        let selectedStyle: React.CSSProperties | undefined;

        if (selected) {
          if (hasAccent) {
            selectedStyle = { background: o.accent, color: "#fff" };
            selectedClasses = "shadow-sm";
          } else {
            selectedClasses =
              "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm";
          }
        } else {
          selectedClasses = "text-slate-600 dark:text-slate-400";
        }

        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={selected}
            data-seg-value={o.value}
            onClick={() => onChange(o.value)}
            style={selectedStyle}
            className={`flex-1 min-h-[44px] py-1.5 px-3 rounded-lg text-xs font-semibold transition-colors relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${selectedClasses}`}
          >
            {o.label}
            {typeof o.badge === "number" && o.badge > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-amber-400 text-amber-950 text-[9px] font-bold flex items-center justify-center">
                {o.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
