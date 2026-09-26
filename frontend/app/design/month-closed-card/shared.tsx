import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, ChevronUp, Circle, X } from "lucide-react";
import MoneyText from "@/components/MoneyText";
import type { CompanionItem } from "@/lib/api";

// G168 — the month-closed ("needle") card has no dismiss on Home and is
// absent from the Penny hub. Fixture shaped exactly like the real item
// backend/app/services/companion.py ~4808-4836 builds (id `needle:<closed_
// end>`, type "needle", headline "Your month closed on {weekday}.", empty
// body, one action routing to /month/story?which=last) — the backend's own
// comment says this card is "invitation only — no figures", so there is no
// real Kevin figure to reuse here, unlike other previews that fork a real
// payload. The weekday below is illustrative only.
export const NEEDLE_ITEM: CompanionItem = {
  id: "needle:2026-08-27",
  type: "needle",
  headline: "Your month closed on Thursday.",
  body: "",
  action: { label: "Here's how it went ›", route: "/month/story?which=last" },
  estimated: false,
};

// Variant C only — reframes the same invitation as a led verdict figure.
// This is a real data-shape GAP: companion.py's needle item carries no
// figure at all today (see the comment above), so this number is
// illustrative, not a real Kevin figure, and is labelled as such in the
// page copy. Chosen as a caution ("over usual") example on purpose, to show
// the Red Is Risk / Amber Lives In The Signifier rule doing its job: the
// figure itself stays ink, the small amber dot on the label is the only
// caution mark.
export const NEEDLE_VERDICT = {
  weekday: "Thursday",
  label: "YOUR MONTH, THURSDAY",
  figureText: "+£136 vs usual",
  caution: true,
  story:
    "Eating out and transport ran higher than usual across the first two weeks, evening out by the end of the month. Everything else tracked close to plan.",
};

export function rowLabelFor(item: CompanionItem): string {
  return `${item.headline.replace(/\.$/, "")} ›`;
}

export function GlassCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`glass-card relative overflow-hidden rounded-2xl p-4 ${className}`}>{children}</div>;
}

/**
 * Dismiss × — the app-wide V2 glass chip (Kevin 2026-08-27, /design/dismiss-x),
 * copied verbatim from components/HomeBrief.tsx's local (unexported)
 * DismissChip, the same pattern every other convention in this file follows
 * (functions like this are re-declared per call site rather than imported,
 * since the production original isn't exported). Home only, per the brief:
 * dismiss removes the whole card, never rendered on Penny.
 */
export function DismissChip({
  label = "Dismiss",
  onClick,
  className = "absolute top-2 right-2 z-10",
}: {
  label?: string;
  onClick?: (e: React.MouseEvent) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`${className} flex h-11 w-11 touch-manipulation items-center justify-center rounded-full [-webkit-tap-highlight-color:transparent] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white active:scale-95 transition-transform duration-150 motion-reduce:transition-none dark:focus-visible:ring-offset-slate-800`}
    >
      <span className="w-7 h-7 flex items-center justify-center rounded-full bg-slate-900/[0.05] dark:bg-white/[0.06] border border-slate-900/[0.06] dark:border-white/10 [@media(hover:hover)]:hover:bg-slate-900/[0.09] dark:[@media(hover:hover)]:hover:bg-white/[0.11] transition-colors duration-150">
        <X size={14} aria-hidden="true" className="text-slate-500 dark:text-slate-300" />
      </span>
    </button>
  );
}

/**
 * Minimise — G164's chevron-up control, copied verbatim (same rationale as
 * DismissChip above). Penny only: collapses the card, never removes it —
 * mirrors the payday plan's owner rule (minimise-only, never dismiss).
 */
export function MinimiseControl({
  onClick,
  className = "absolute top-2 right-2 z-10",
}: {
  onClick?: (e: React.MouseEvent) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label="Minimise"
      onClick={onClick}
      className={`${className} flex h-11 w-11 touch-manipulation items-center justify-center rounded-full [-webkit-tap-highlight-color:transparent] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white active:scale-95 transition-transform duration-150 motion-reduce:transition-none dark:focus-visible:ring-offset-slate-800`}
    >
      <span className="w-7 h-7 flex items-center justify-center rounded-full bg-slate-900/[0.05] dark:bg-white/[0.06] border border-slate-900/[0.06] dark:border-white/10 [@media(hover:hover)]:hover:bg-slate-900/[0.09] dark:[@media(hover:hover)]:hover:bg-white/[0.11] transition-colors duration-150">
        <ChevronUp size={14} aria-hidden="true" className="text-slate-500 dark:text-slate-300" />
      </span>
    </button>
  );
}

/**
 * The collapsed one-line row every variant folds down to on Penny: "Your
 * month closed on Thursday ›", a 44px glass-card tap target consistent with
 * the app's other collapsed-row affordances (e.g. G164's ExecutedRow).
 */
export function CollapsedRow({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={false}
      className="glass-card flex min-h-[44px] w-full touch-manipulation items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left [-webkit-tap-highlight-color:transparent] active:scale-[0.99] transition-transform motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
    >
      <span className="min-w-0 truncate text-[15px] font-semibold leading-snug text-slate-900 dark:text-slate-100">
        {label}
      </span>
      <ChevronRight size={16} aria-hidden="true" className="flex-shrink-0 text-slate-400 dark:text-slate-500" />
    </button>
  );
}

export function ActionLink({ label, route }: { label: string; route: string }) {
  return (
    <Link
      href={route}
      className="inline-block text-[14px] text-indigo-600 dark:text-indigo-400 font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
    >
      {label}
    </Link>
  );
}

/** Amber Lives In The Signifier: a small dot beside a whisper label, never
 * the figure or the label's own colour (DESIGN.md). */
export function AmberDot() {
  return <Circle size={7} fill="currentColor" aria-hidden="true" className="text-amber-500 dark:text-amber-400 flex-shrink-0" />;
}

export function WhisperLabel({ children, caution = false }: { children: ReactNode; caution?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-400 dark:text-slate-500">
      {caution && <AmberDot />}
      {children}
    </span>
  );
}

/**
 * Variant C's led verdict row — Numbers Lead Rule: the figure is the
 * heaviest element, the label whispers above it. Set at DESIGN.md's
 * "Amount-on-card" step (700, 19px) — a card-level money figure one step
 * below Headline/Display, since this leads a card row rather than the
 * page's own hero. The figure stays ink regardless of caution (Red Is Risk
 * / Amber Lives In The Signifier); only the label's small dot carries the
 * caution mark.
 */
export function VerdictFigure({ label, figureText, caution }: { label: string; figureText: string; caution: boolean }) {
  return (
    <div className="min-w-0">
      <WhisperLabel caution={caution}>{label}</WhisperLabel>
      <p className="mt-1 text-[19px] font-bold leading-6 text-slate-900 dark:text-white">
        <MoneyText text={figureText} />
      </p>
    </div>
  );
}
