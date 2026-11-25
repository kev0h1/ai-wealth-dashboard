"use client";

import { useEffect, useMemo, useRef } from "react";
import UpcomingAccountsCard from "@/components/upcoming/UpcomingAccountsCard";
import UpcomingAttentionDay from "@/components/upcoming/UpcomingAttentionDay";
import type { UpcomingRowModel } from "@/components/upcoming/UpcomingRow";
import type { UpcomingAccountSummary } from "@/lib/upcomingAccounts";
import { FINE_FOLD_KEY } from "@/lib/upcomingAccountStatus";
import type { Plan } from "@/lib/upcomingPlans";

export type UpcomingScreenView = "payments" | "accounts";

export interface UpcomingScreenProps {
  view: UpcomingScreenView;
  rows: UpcomingRowModel[];
  accounts: UpcomingAccountSummary[];
  plans: Plan[];
  /** Production's account window label, for example "Payments through Sun 29 Nov". */
  periodLabel: string;
  /** The fixture's calendar day, used only for the production Today/Tomorrow heading treatment. */
  todayIso?: string;
  plansStatus?: "loading" | "error" | "ready";
  onOpenRow?: (row: UpcomingRowModel) => void;
  onDismissRow?: (row: UpcomingRowModel) => void;
  onOpenAccount?: (account: UpcomingAccountSummary) => void;
  onRetryPlans?: () => void;
}

function dateHeading(iso: string, todayIso?: string) {
  const date = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  const label = new Intl.DateTimeFormat("en-GB", {
    weekday: "short", day: "numeric", month: "short", timeZone: "UTC",
  }).format(date);
  if (!todayIso) return label;

  const today = new Date(`${todayIso.slice(0, 10)}T12:00:00Z`);
  const daysAway = Math.round((date.getTime() - today.getTime()) / 86_400_000);
  return daysAway === 0 ? `Today · ${label}` : daysAway === 1 ? `Tomorrow · ${label}` : label;
}

/**
 * Production Upcoming sections, rendered independently for the two phone
 * stories. Financial projection is supplied by the fixture owner; this
 * component only groups rows and presents the existing production surfaces.
 */
export default function UpcomingScreen({
  view,
  rows,
  accounts,
  plans,
  periodLabel,
  todayIso,
  plansStatus = "ready",
  onOpenRow = () => {},
  onDismissRow = () => {},
  onOpenAccount = () => {},
  onRetryPlans = () => {},
}: UpcomingScreenProps) {
  const accountsRef = useRef<HTMLElement>(null);
  const groupedRows = useMemo(() => {
    const groups = new Map<string, UpcomingRowModel[]>();
    for (const row of rows) {
      const key = row.expectedDate.slice(0, 10);
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [rows]);

  // UpcomingAccountsCard intentionally keeps "fine" rows folded in normal
  // use. The dedicated account story should show those genuine readings, so
  // open its own disclosure locally after the renderer has restored session
  // state. Its toggle persists to sessionStorage, so restore that exact value
  // immediately after the synchronous click while its local state stays open.
  useEffect(() => {
    if (view !== "accounts") return;
    const frame = window.requestAnimationFrame(() => {
      const fold = accountsRef.current?.querySelector<HTMLButtonElement>("[data-fine-fold][aria-expanded='false']");
      let storage: Storage | null = null;
      let previous: string | null = null;
      try {
        storage = window.sessionStorage;
        previous = storage.getItem(FINE_FOLD_KEY);
      } catch {}
      try {
        fold?.click();
      } finally {
        if (storage) {
          try {
            if (previous === null) storage.removeItem(FINE_FOLD_KEY);
            else storage.setItem(FINE_FOLD_KEY, previous);
          } catch {}
        }
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [view, accounts]);

  if (view === "accounts") {
    return (
      <section ref={accountsRef} data-c22-upcoming-view="accounts" data-c22-upcoming-accounts className="space-y-3">
        <UpcomingAccountsCard
          accounts={accounts}
          periodLabel={periodLabel}
          plans={plans}
          plansStatus={plansStatus}
          onRetry={onRetryPlans}
          onOpen={onOpenAccount}
        />
        {accounts.length > 0 && (
          <p data-upcoming-payments-note className="px-1 text-xs leading-5 text-slate-600 dark:text-slate-300">
            Payments can take a day or two to appear, so a very recent one may not be counted yet.
          </p>
        )}
      </section>
    );
  }

  return (
    <section data-c22-upcoming-view="payments" data-c22-upcoming-payments className="space-y-3" aria-labelledby="c22-upcoming-ledger-heading">
      <div className="flex items-end justify-between gap-3 px-1">
        <h2 id="c22-upcoming-ledger-heading" className="text-sm font-semibold text-slate-800 dark:text-slate-100">Upcoming</h2>
        <p className="text-xs text-slate-600 dark:text-slate-400">Covered payments stay folded</p>
      </div>
      {groupedRows.map(([dayKeyIso, dayRows]) => (
        <UpcomingAttentionDay
          key={dayKeyIso}
          dayKeyIso={dayKeyIso}
          heading={dateHeading(dayKeyIso, todayIso)}
          rows={dayRows}
          onOpen={onOpenRow}
          onDismiss={onDismissRow}
        />
      ))}
    </section>
  );
}
