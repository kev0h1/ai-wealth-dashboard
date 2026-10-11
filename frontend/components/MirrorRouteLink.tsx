"use client";

// A quiet route from Spend back to the Mirror (G242). Informational, so no
// Penny gradient. Two placements share one component: a row after the
// categories, and a small pill under the page title.
import { ChevronRight } from "lucide-react";
import PennyMark from "@/components/PennyMark";

export type MirrorRouteVariant = "row" | "pill" | "outlined";

export default function MirrorRouteLink({ variant, href = "/mirror", onNavigate }: { variant: MirrorRouteVariant; href?: string; onNavigate?: () => void }) {
  const common = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 transition-[opacity,background-color] active:opacity-70";
  const click = onNavigate
    ? { onClick: (e: React.MouseEvent) => { e.preventDefault(); onNavigate(); } }
    : {};
  if (variant === "pill") {
    return (
      <a href={href} {...click} className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800 ${common}`}>
        <PennyMark size={13} className="text-slate-500 dark:text-slate-400" />
        How your money behaves
      </a>
    );
  }
  if (variant === "outlined") {
    return (
      <a href={href} {...click} className={`flex min-h-[44px] items-center justify-between rounded-xl border border-slate-200 px-4 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800/60 ${common}`}>
        <span>How your money behaves</span>
        <ChevronRight size={15} className="text-slate-400 dark:text-slate-500" aria-hidden="true" />
      </a>
    );
  }
  return (
    <a href={href} {...click} className={`flex min-h-[44px] items-center justify-between px-1 text-[13px] font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 ${common}`}>
      <span>How your money behaves</span>
      <ChevronRight size={15} className="text-slate-400 dark:text-slate-500" aria-hidden="true" />
    </a>
  );
}
