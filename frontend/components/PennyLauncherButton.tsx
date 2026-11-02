import PennyAppearanceIcon from "@/components/PennyAppearanceIcon";
import PennyMark from "@/components/PennyMark";
import { BRAND_GRADIENT } from "@/lib/brand";
import type { PennyAppearance } from "@/lib/pennyAppearance";

/** Raised mobile adviser door. Its accessible name replaces a visible caption. */
export default function PennyLauncherButton({ appearance, active, open, current, paydayActive, onClick }: {
  appearance: PennyAppearance;
  active: boolean;
  open: boolean;
  current: boolean;
  paydayActive: boolean;
  onClick: () => void;
}) {
  const original = appearance === "original";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Penny"
      aria-current={current ? "page" : undefined}
      aria-pressed={open}
      data-penny-appearance={appearance}
      className={`absolute left-1/2 -translate-x-1/2 -top-7 z-10 size-14 rounded-2xl flex items-center justify-center active:scale-95 transition-transform motion-reduce:transition-none touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-600 ${original ? "" : "border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-[0_10px_18px_rgb(15_23_42/14%)] dark:shadow-none hover:border-indigo-400 dark:hover:border-indigo-300"} ${!original && active ? "ring-2 ring-indigo-500 ring-offset-2 ring-offset-white dark:ring-offset-slate-800" : ""}`}
      style={original ? {
        background: BRAND_GRADIENT,
        boxShadow: active
          ? "0 4px 14px rgba(79,70,229,0.35), 0 0 0 6px rgba(79,70,229,0.18)"
          : "0 4px 14px rgba(79,70,229,0.35)",
      } : undefined}
    >
      <span className="relative flex items-center justify-center">
        {original ? <PennyMark size={22} className="text-white" /> : <PennyAppearanceIcon appearance={appearance} size={26} />}
        {paydayActive && (
          <span
            aria-hidden="true"
            className={`absolute -top-1 -right-1.5 size-2 rounded-full bg-amber-500 ${original ? "" : "ring-2 ring-white dark:ring-slate-800"}`}
            style={original ? { boxShadow: "0 0 0 1.5px rgba(79,70,229,1)" } : undefined}
          />
        )}
      </span>
    </button>
  );
}
