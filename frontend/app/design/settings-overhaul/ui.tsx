"use client";

// G201 preview primitives. HAND-AUTHORED STAND-INS: the row, group and page
// chrome here do not exist as production components yet (SettingsPage.tsx
// keeps its SectionHeader / IconChip private and builds everything inline).
// If Kevin picks a direction, these become the production hub components and
// this preview should switch to importing them. Production pieces that DO
// exist are imported in sections.tsx (Toggle, ConfirmDialog, SheetFrame,
// PayPeriodSettingsSheet, YourPlanCard, CoverPlanSourcesCard, TUTORIAL_FLOWS).

import { createContext, useContext, type ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

export type VariantId = "a" | "b" | "c";
export type PState = "ready" | "attention" | "relay" | "empty";
export type Mode = "light" | "dark";

export type Provider = { id: "google" | "apple"; label: string; detail: string; primary?: boolean };

export type Model = {
  state: PState;
  name: string;
  email: string;
  providers: Provider[];
  accounts: number;
  native: boolean;
  hasIncome: boolean;
  notifBlocked: boolean;
};

export function buildModel(state: PState): Model {
  const relay = state === "relay";
  const empty = state === "empty";
  const google: Provider = { id: "google", label: "Google", detail: "sam@example.com", primary: true };
  const apple: Provider = { id: "apple", label: "Apple", detail: "s••••@icloud.com" };
  return {
    state,
    name: relay ? "" : "Sam Patel",
    email: relay ? "x7k2p9q@privaterelay.appleid.com" : "sam@example.com",
    providers: relay
      ? [{ id: "apple", label: "Apple", detail: "Uses Hide My Email", primary: true }]
      : empty
        ? [google]
        : [google, apple],
    accounts: empty ? 0 : 3,
    native: !empty,
    hasIncome: !empty,
    notifBlocked: state === "attention",
  };
}

export type Ctx = {
  variant: VariantId;
  state: PState;
  mode: Mode;
  model: Model;
  href: (page: string, extra?: Record<string, string>) => string;
  openSheet: (id: string) => void;
  payLabel: string;
};

export const PreviewCtx = createContext<Ctx>(null as unknown as Ctx);
export const usePreview = () => useContext(PreviewCtx);

export const INK = "text-slate-900 dark:text-slate-100";
export const SOFT = "text-slate-600 dark:text-slate-400";
export const CARD = "glass-card overflow-hidden rounded-2xl";
const RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500";
const ROW_BASE = `flex min-h-[52px] w-full items-center gap-3 px-4 py-3 text-left transition-opacity active:opacity-70 ${RING}`;
const SEP = "border-t border-slate-100 first:border-t-0 dark:border-slate-700";

/** Canvas section: heading and one orientation sentence on the canvas, then
 * whatever bounded control sits under it. Never draws a card by itself. */
export function Group({ title, intro, children, id }: { title: string; intro?: string; children: ReactNode; id?: string }) {
  return (
    <section aria-labelledby={`${id ?? title}-h`} className="mt-8">
      <h2 id={`${id ?? title}-h`} className={`text-base font-bold ${INK}`}>{title}</h2>
      {intro && <p className={`mt-1 text-[13px] leading-5 ${SOFT}`}>{intro}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function List({ children }: { children: ReactNode }) {
  return <div className={CARD}>{children}</div>;
}

function Value({ value, dot }: { value?: string; dot?: boolean }) {
  if (!value) return null;
  return (
    <span className={`flex min-w-0 max-w-[52%] items-center justify-end gap-1.5 text-right text-[13px] leading-snug ${SOFT}`}>
      {dot && <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-amber-500 dark:bg-amber-400" />}
      <span>{value}</span>
    </span>
  );
}

/** One row, one link. Trailing value is part of the accessible name. */
export function NavRow({ page, label, value, helper, dot, extra }: { page: string; label: string; value?: string; helper?: string; dot?: boolean; extra?: Record<string, string> }) {
  const { href } = usePreview();
  return (
    <div className={SEP}>
      <Link href={href(page, extra)} className={ROW_BASE}>
        <span className="min-w-0 flex-1">
          <span className={`block text-sm font-semibold ${INK}`}>{label}</span>
          {helper && <span className={`mt-0.5 block text-xs leading-snug ${SOFT}`}>{helper}</span>}
        </span>
        <Value value={value} dot={dot} />
        <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-slate-400 dark:text-slate-500" />
      </Link>
    </div>
  );
}

export function SheetRow({ sheet, label, value, helper }: { sheet: string; label: string; value?: string; helper?: string }) {
  const { openSheet } = usePreview();
  return (
    <div className={SEP}>
      <button type="button" onClick={() => openSheet(sheet)} className={ROW_BASE}>
        <span className="min-w-0 flex-1">
          <span className={`block text-sm font-semibold ${INK}`}>{label}</span>
          {helper && <span className={`mt-0.5 block text-xs leading-snug ${SOFT}`}>{helper}</span>}
        </span>
        <Value value={value} />
        <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-slate-400 dark:text-slate-500" />
      </button>
    </div>
  );
}

export function ExternalRow({ to, label, helper }: { to: string; label: string; helper?: string }) {
  return (
    <div className={SEP}>
      <Link href={to} className={ROW_BASE}>
        <span className="min-w-0 flex-1">
          <span className={`block text-sm font-semibold ${INK}`}>{label}</span>
          {helper && <span className={`mt-0.5 block text-xs leading-snug ${SOFT}`}>{helper}</span>}
        </span>
        <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-slate-400 dark:text-slate-500" />
      </Link>
    </div>
  );
}

/** Drill-in page frame: back control, h1, one orientation sentence. */
export function PageFrame({ title, intro, back = "Account", children }: { title: string; intro?: string; back?: string; children: ReactNode }) {
  const { href } = usePreview();
  return (
    <div>
      <Link href={href("hub")} className={`-ml-2 inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-sm font-medium text-indigo-700 dark:text-indigo-300 ${RING.replace("focus-visible:ring-inset ", "")}`}>
        <ChevronLeft size={18} aria-hidden="true" />
        {back}
      </Link>
      <h1 className={`mt-2 text-xl font-bold ${INK}`}>{title}</h1>
      {intro && <p className={`mt-1 text-[13px] leading-5 ${SOFT}`}>{intro}</p>}
      {children}
    </div>
  );
}
