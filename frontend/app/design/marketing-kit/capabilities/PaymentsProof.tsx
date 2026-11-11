"use client";

import { useEffect, useState } from "react";
import type { PlannedExpense, PlannedImpact } from "@/lib/api";
import PlanOneOffSheet from "@/components/PlanOneOffSheet";
import UpcomingDetailFlow, { type PaymentDetail } from "@/components/upcoming/UpcomingDetailFlow";
import UpcomingAttentionDay from "@/components/upcoming/UpcomingAttentionDay";
import MoneyText from "@/components/MoneyText";
import {
  BOILER_SERVICE,
  CAPABILITY_ACCOUNTS,
  plannedRow,
  UPCOMING_ROWS,
  UPDATED_BOILER_SERVICE,
} from "./payment-fixtures";

export type PaymentsProofKind = "upcoming-list" | "upcoming-create" | "upcoming-saved" | "upcoming-edit" | "upcoming-updated";

function seedFor(kind: PaymentsProofKind): PlannedExpense | null {
  if (kind === "upcoming-saved" || kind === "upcoming-edit") return BOILER_SERVICE;
  if (kind === "upcoming-updated") return UPDATED_BOILER_SERVICE;
  return null;
}

/**
 * An API-free host for the shipped one-off and planned-payment experiences.
 * Each write updates only React fixture state. It never reaches a bank or the
 * app API, while retaining the production form, row and detail-flow boundary.
 */
export default function PaymentsProof({ kind, theme }: { kind: PaymentsProofKind; theme: "light" | "dark" }) {
  const [planned, setPlanned] = useState<PlannedExpense | null>(() => seedFor(kind));
  const [createOpen, setCreateOpen] = useState(kind === "upcoming-create");
  const [editing, setEditing] = useState(kind === "upcoming-edit");

  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    root.classList.toggle("dark", theme === "dark");
    return () => { root.classList.toggle("dark", wasDark); };
  }, [theme]);

  const addOneOff = async (params: { name: string; amount: number; date: string; account_id?: string }) => {
    const created: PlannedExpense = {
      id: "alex-boiler-service",
      name: params.name,
      amount: params.amount,
      date: params.date,
      account_id: params.account_id ?? null,
    };
    setPlanned(created);
    const impact: PlannedImpact = { safe_to_spend_before: 312, safe_to_spend_after: 222, state_after: "comfortable" };
    return { planned: created, impact };
  };

  const updatePlanned = async (_id: string, patch: { name?: string; amount?: number; date?: string; account_id?: string | null }) => {
    const next: PlannedExpense = { ...(planned ?? BOILER_SERVICE), ...patch };
    setPlanned(next);
    return next;
  };

  const payment: PaymentDetail | null = planned ? {
    id: planned.id,
    model: plannedRow(planned),
    editor: { name: planned.name, amount: planned.amount, expected_date: planned.date, type: "bill" },
    planned: { id: planned.id, name: planned.name, amount: planned.amount, date: planned.date, account_id: planned.account_id ?? null },
  } : null;

  return (
    <div className={theme === "dark" ? "dark" : ""} data-capability-proof={kind} style={{ width: 390, color: theme === "dark" ? "#f1f5f9" : "#0f172a" }}>
      <section aria-label="Upcoming payments example" className="space-y-4">
        <header className="px-1"><p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">Upcoming</p><h2 className="mt-0.5 text-lg font-bold text-slate-950 dark:text-white">Payments on the way</h2></header>
        {[...UPCOMING_ROWS, ...(planned ? [plannedRow(planned)] : [])].map((row) => <UpcomingAttentionDay
          key={row.rowKey}
          dayKeyIso={row.expectedDate}
          heading={new Date(row.expectedDate + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
          rows={[row]}
          onOpen={() => { if (row.rowKey === planned?.id) setEditing(true); }}
          onDismiss={() => { if (row.rowKey === planned?.id) setPlanned(null); }}
        />)}
        {!planned && <button type="button" data-payment-create onClick={() => setCreateOpen(true)} className="min-h-11 w-full rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50 active:scale-95 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800">Plan a one-off payment</button>}
        {kind === "upcoming-updated" && <p role="status" className="px-1 text-xs font-medium text-slate-600 dark:text-slate-300"><MoneyText text="Boiler service updated to £95 on 26 Nov." unmasked /></p>}
      </section>

      {createOpen && <PlanOneOffSheet
        accounts={CAPABILITY_ACCOUNTS}
        onClose={() => setCreateOpen(false)}
        onSaved={(created) => { if (created) setPlanned(created); }}
        operations={{ addPlanned: addOneOff }}
      />}

      {editing && payment && <UpcomingDetailFlow
        initialView={{ kind: "edit-payment", id: payment.id }}
        onClose={() => setEditing(false)}
        accounts={CAPABILITY_ACCOUNTS}
        summaries={[]}
        plans={[]}
        plansStatus="ready"
        allocations={[]}
        payments={[payment]}
        periodLabel="Payments through Mon 30 Nov"
        periodStart={new Date("2026-11-01T12:00:00Z")}
        onRefresh={async () => {}}
        onDismiss={() => {}}
        onDeletePlanned={() => { setPlanned(null); setEditing(false); }}
        services={{ planned: { updatePlanned } }}
      />}
    </div>
  );
}
