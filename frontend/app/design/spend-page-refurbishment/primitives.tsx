import type { ButtonHTMLAttributes, ReactNode } from "react";
import { getCategoryColour } from "@/lib/categories";
import { getCategoryIcon } from "@/lib/categoryIcons";

const SHORT_DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const SHORT_MONTH = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" });

function utcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function formatPeriod(start: string, end: string): string {
  return `${SHORT_DATE.format(utcDate(start))} to ${SHORT_DATE.format(utcDate(end))}`;
}

export function formatMonth(iso: string): string {
  return SHORT_MONTH.format(utcDate(iso));
}

export function formatGbp(value: number): string {
  const sign = value < 0 ? "−" : "";
  const amount = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }).format(Math.abs(value));
  return `${sign}£${amount}`;
}

export function Currency({ value, className = "" }: { value: number; className?: string }) {
  return <span className={`font-mono tabular-nums ${className}`}>{formatGbp(value)}</span>;
}

export function Surface({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:shadow-none ${className}`}>{children}</section>;
}

export function CategoryChip({
  category,
  colours,
  size = 36,
}: {
  category: string;
  colours?: Record<string, string>;
  size?: number;
}) {
  const colour = getCategoryColour(category, colours);
  const Icon = getCategoryIcon(category);
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-xl"
      style={{ backgroundColor: `${colour}26`, height: size, width: size }}
    >
      <Icon size={size >= 32 ? 16 : 14} style={{ color: colour }} />
    </span>
  );
}

/** Amber appears only in this small dot. The accompanying words stay neutral. */
export function AttentionMark({ children }: { children?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500 dark:bg-amber-400" />
      {children}
    </span>
  );
}

type ActionControlProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  tone?: "primary" | "secondary" | "quiet";
};

export function ActionControl({ tone = "secondary", className = "", children, ...props }: ActionControlProps) {
  const tones = {
    primary: "bg-indigo-600 text-white [@media(hover:hover)]:hover:bg-indigo-700",
    secondary: "border border-slate-200 bg-white text-slate-700 [@media(hover:hover)]:hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:[@media(hover:hover)]:hover:bg-slate-700",
    quiet: "text-slate-600 [@media(hover:hover)]:hover:bg-slate-100 dark:text-slate-300 dark:[@media(hover:hover)]:hover:bg-slate-700",
  } as const;
  return (
    <button
      type="button"
      className={`inline-flex min-h-11 touch-manipulation items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold [-webkit-tap-highlight-color:transparent] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white motion-safe:transition-[transform,background-color] motion-safe:duration-150 motion-reduce:transition-none active:scale-95 motion-reduce:active:scale-100 disabled:pointer-events-none disabled:opacity-50 dark:focus-visible:ring-offset-slate-800 ${tones[tone]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function SectionHeading({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3">
      <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">{children}</h2>
      {action}
    </div>
  );
}
