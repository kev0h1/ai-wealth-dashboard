import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Check, Circle, X } from "lucide-react";
import PennyMark from "@/components/PennyMark";
import type { StatusTone } from "./fixtures";

const NUMBER = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const NUMBER_WITH_PENCE = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function Currency({ value, pence = false, className = "" }: { value: number; pence?: boolean; className?: string }) {
  const display = (pence ? NUMBER_WITH_PENCE : NUMBER).format(value);
  return <span className={`font-mono tabular-nums ${className}`}>{display}</span>;
}

/** A compact status cue. Amber and emerald stay in this mark, never in prose or money. */
export function Signifier({ tone, label }: { tone: StatusTone; label?: string }) {
  if (tone === "penny") {
    return (
      <span className="inline-flex h-6 items-center gap-1 rounded-full bg-gradient-to-br from-indigo-600 to-violet-600 px-2 text-[10px] font-semibold uppercase tracking-wide text-white">
        <PennyMark size={11} />
        {label ?? "Penny"}
      </span>
    );
  }

  if (tone === "positive") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 dark:text-slate-300">
        <Check size={14} aria-hidden="true" className="text-emerald-600 dark:text-emerald-400" />
        {label}
      </span>
    );
  }

  if (tone === "watch") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 dark:text-slate-300">
        <Circle size={8} fill="currentColor" aria-hidden="true" className="text-amber-500 dark:text-amber-400" />
        {label}
      </span>
    );
  }

  return label ? <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{label}</span> : null;
}

export function DismissButton({
  label = "Hide this card",
  className = "",
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "children" | "aria-label"> & { label?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      className={`group flex h-11 w-11 touch-manipulation items-center justify-center rounded-full [-webkit-tap-highlight-color:transparent] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white active:scale-95 transition-transform duration-150 motion-reduce:transition-none dark:focus-visible:ring-offset-slate-800 ${className}`}
      {...props}
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-900/[0.06] bg-slate-900/[0.05] text-slate-500 [@media(hover:hover)]:group-hover:bg-slate-900/[0.09] dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-300 dark:[@media(hover:hover)]:group-hover:bg-white/[0.11]">
        <X size={14} aria-hidden="true" />
      </span>
    </button>
  );
}

type ActionKind = "primary" | "secondary" | "quiet";

const ACTION_STYLES: Record<ActionKind, string> = {
  primary: "bg-indigo-600 text-white [@media(hover:hover)]:hover:bg-indigo-700",
  secondary: "border border-slate-200 bg-white text-slate-700 [@media(hover:hover)]:hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:[@media(hover:hover)]:hover:bg-slate-700",
  quiet: "text-slate-600 [@media(hover:hover)]:hover:bg-slate-100 dark:text-slate-300 dark:[@media(hover:hover)]:hover:bg-slate-700",
};

export function ActionButton({
  kind = "primary",
  className = "",
  children,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & { kind?: ActionKind }) {
  return (
    <button
      type="button"
      className={`inline-flex min-h-11 touch-manipulation items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold [-webkit-tap-highlight-color:transparent] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white active:scale-95 transition-[transform,background-color] duration-150 motion-reduce:transition-none disabled:pointer-events-none disabled:opacity-50 dark:focus-visible:ring-offset-slate-800 ${ACTION_STYLES[kind]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function PreviewCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 ${className}`}>{children}</section>;
}
