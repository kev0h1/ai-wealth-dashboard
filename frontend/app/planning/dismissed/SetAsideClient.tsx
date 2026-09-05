"use client";

// /planning/dismissed — "Set aside". Real page behind Variant C ("undo
// log") from the /design/dismissed round: a timeline of set-aside events,
// each reversible with a large 44px circular undo control. See
// app/design/dismissed/VariantC.tsx for the source of truth this was
// promoted from; that route stays as a design reference and is
// untouched by this page.
//
// Two genuinely distinct provenances (GET /dismissed-series):
//   "user"   rows: dismissed_recurring, restored via the existing
//            /cashflow/restore-recurring endpoint (the same one Planning's
//            own undo-dismiss flow calls), re-dismissed on undo via
//            /cashflow/dismiss-recurring (also Planning's existing door)
//            so the round-trip is symmetrical.
//   "engine" rows: engine_vetoed_recurring, the recurring judge's own
//            vetoes with a real reason sentence. "Bring back" is a user
//            override (POST /dismissed-series/override), which has no
//            reverse endpoint, so that toast never offers undo.
//
// Delete (both provenances) is a separate, quiet, secondary control:
// POST /dismissed-series/hide {hidden:true} removes the row from this
// list only, the underlying exclusion continues unaffected (it was
// already excluded). hidden:false is the undo. Never rendered in red —
// nothing on this page is a genuine financial risk, per DESIGN.md.
//
// The 60-day age cutoff is server-side (GET /dismissed-series already
// filters), this page renders whatever it's given and never re-derives
// that rule client-side.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Undo2 } from "lucide-react";
import { goBack } from "@/lib/goBack";
import { api, DismissedUserRow, DismissedEngineRow } from "@/lib/api";
import { BankBadge } from "@/components/AccountMiniCard";
import { bankBadgeProps } from "./bankBadge";
import Spinner from "@/components/Spinner";
import BottomNav from "@/components/BottomNav";

type Row =
  | ({ provenance: "user" } & DismissedUserRow)
  | ({ provenance: "engine" } & DismissedEngineRow);

type Toast = { text: string; undo?: () => void };

function formatMoney(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  const fixed = Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(2);
  return `£${fixed}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso.length > 10 ? iso : `${iso}T00:00:00`);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function formatRelative(iso: string): string {
  const d = new Date(iso.length > 10 ? iso : `${iso}T00:00:00`);
  const days = Math.round((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  return formatDate(iso);
}

/** Shared with the page header. Empty-state wording matches the
 *  /design/dismissed empty fixture verbatim. */
function verdictLine(count: number): string {
  if (count === 0) {
    return "Nothing is set aside. Every recurring payment and bill Sorted has spotted is included in your projections.";
  }
  if (count === 1) return "1 payment is set aside, excluded from your projections.";
  return `${count} payments are set aside, excluded from your projections.`;
}

// Honesty note (from VariantC): user rows don't have a real "set aside"
// timestamp (dismissed_recurring stores only the key), so their spine
// label reads "Last seen" against the transaction-derived date, never
// "Set aside" — only engine rows, which do store vetoed_at, get that
// label. Either can be null (unenriched series), in which case the label
// is simply omitted rather than showing a fabricated date.
function spineLabel(row: Row): string | null {
  if (row.provenance === "engine") {
    return row.vetoed_at ? `Set aside ${formatRelative(row.vetoed_at)}` : null;
  }
  return row.last_seen ? `Last seen ${formatDate(row.last_seen)}` : null;
}

export default function SetAsideClient() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function load() {
    setError(false);
    api.dismissedSeries()
      .then((data) => {
        const merged: Row[] = [
          ...data.user.map((r) => ({ ...r, provenance: "user" as const })),
          ...data.engine.map((r) => ({ ...r, provenance: "engine" as const })),
        ];
        setRows(merged);
      })
      .catch(() => setError(true));
  }

  useEffect(() => { load(); }, []);

  function showToast(text: string, undo?: () => void) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ text, undo });
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }

  function restore(row: Row & { provenance: "user" }) {
    setRows((prev) => (prev ? prev.filter((r) => r.key !== row.key) : prev));
    api.restoreRecurring(row.key).catch(() => {});
    showToast(
      `${row.display_name ?? row.key} back in your projections from the next refresh.`,
      () => {
        setRows((prev) => (prev ? [row, ...prev] : prev));
        api.dismissRecurring(row.key).catch(() => {});
      }
    );
  }

  function bringBack(row: Row & { provenance: "engine" }) {
    setRows((prev) => (prev ? prev.filter((r) => r.key !== row.key) : prev));
    api.overrideDismissedSeries(row.key).catch(() => {});
    // No undo here — POST /dismissed-series/override has no reverse
    // endpoint, offering one would be a false affordance.
    showToast(`${row.display_name ?? row.key} back in your projections from the next refresh.`);
  }

  function hideRow(row: Row) {
    setRows((prev) => (prev ? prev.filter((r) => r.key !== row.key) : prev));
    api.hideDismissedSeries(row.key, row.provenance, true).catch(() => {});
    showToast("Removed from this list. It stays out of your projections.", () => {
      setRows((prev) => (prev ? [row, ...prev] : prev));
      api.hideDismissedSeries(row.key, row.provenance, false).catch(() => {});
    });
  }

  const loading = rows == null && !error;

  return (
    <div className="min-h-dvh pb-[calc(9rem+env(safe-area-inset-bottom,0px))] lg:pb-8" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      <div className="px-4 pt-6 pb-2 max-w-[430px] lg:max-w-2xl mx-auto">
        <button
          onClick={() => goBack(router, "/upcoming")}
          className="flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-300 active:opacity-70 transition-[transform,opacity] mb-5"
        >
          <ChevronLeft size={15} />
          Back
        </button>

        <h1 className="text-[20px] font-bold text-slate-900 dark:text-white">Set aside</h1>
        {!loading && !error && (
          <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
            {verdictLine(rows!.length)}
            {rows!.length > 0 ? " Undo any of them below." : ""}
          </p>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Spinner size={32} />
          </div>
        ) : error ? (
          <div className="mt-5 glass-card rounded-2xl p-5">
            <p className="text-sm text-slate-700 dark:text-slate-200">
              Couldn&apos;t load what&apos;s set aside, pull back and try again.
            </p>
            <button
              onClick={load}
              className="mt-3 min-h-[44px] px-4 -ml-4 text-sm font-semibold text-indigo-600 dark:text-indigo-400 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              Retry
            </button>
          </div>
        ) : rows!.length > 0 ? (
          <div className="mt-5 relative">
            {/* Spine */}
            <div className="absolute left-[15px] top-2 bottom-2 w-px bg-slate-200 dark:bg-slate-700" aria-hidden />

            <div className="flex flex-col gap-3">
              {rows!.map((row) => {
                const badge = bankBadgeProps(row.bank, 26);
                const name = row.display_name ?? row.key;
                const label = spineLabel(row);
                const subtitle = [row.cadence_label, badge.altText].filter(Boolean).join(" · ");
                return (
                  <div key={`${row.provenance}-${row.key}`} className="relative pl-9">
                    <div className="absolute left-[11px] top-1.5 w-[9px] h-[9px] rounded-full bg-slate-300 dark:bg-slate-600 ring-4 ring-[#f0f2f7] dark:ring-[#0f172a]" aria-hidden />
                    {label && <p className="text-[11px] text-slate-400 dark:text-slate-500 mb-1">{label}</p>}

                    <div className="glass-card rounded-2xl p-3.5">
                      <div className="flex items-center gap-2.5">
                        <BankBadge {...badge} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
                            {name}
                          </p>
                          {subtitle && (
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                              {subtitle}
                            </p>
                          )}
                        </div>
                        {row.typical_amount != null && (
                          <span className="money text-sm font-semibold text-slate-800 dark:text-slate-100 shrink-0 mr-1">
                            {formatMoney(row.typical_amount)}
                          </span>
                        )}
                        <button
                          onClick={() => (row.provenance === "user" ? restore(row) : bringBack(row))}
                          aria-label={
                            row.provenance === "user"
                              ? `Undo, bring ${name} back into projections`
                              : `Bring ${name} back into projections`
                          }
                          className="shrink-0 w-11 h-11 rounded-full bg-indigo-50 dark:bg-indigo-500/15 flex items-center justify-center active:scale-90 transition-transform"
                        >
                          <Undo2 size={17} className="text-indigo-600 dark:text-indigo-300" />
                        </button>
                      </div>

                      {row.provenance === "engine" && row.reason && (
                        <p className="mt-2.5 pt-2.5 border-t border-slate-50 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                          {row.reason}
                        </p>
                      )}

                      {/* Delete: quiet secondary control, deliberately not
                          styled like the primary restore/bring-back
                          affordance above and never red — deleting only
                          hides this row, the exclusion it represents was
                          already in effect. */}
                      <div className="mt-2.5 pt-2.5 border-t border-slate-50 dark:border-slate-700 flex justify-end">
                        <button
                          onClick={() => hideRow(row)}
                          aria-label={`Delete, remove ${name} from this list`}
                          className="min-h-[44px] px-2 -my-2.5 text-xs font-medium text-slate-400 dark:text-slate-500 active:opacity-60 transition-opacity"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>

      {toast && (
        <div className="fixed left-0 right-0 z-50 flex justify-center pointer-events-none" style={{ bottom: "calc(env(safe-area-inset-bottom) + 16px)" }}>
          <div className="pointer-events-auto flex items-center gap-3 rounded-2xl bg-slate-900 dark:bg-slate-700 text-white px-4 py-3 shadow-xl max-w-[90%]">
            <p className="text-xs leading-snug">{toast.text}</p>
            {toast.undo && (
              <button
                onClick={() => { toast.undo!(); setToast(null); }}
                className="shrink-0 text-xs font-semibold text-indigo-300 min-h-[32px] px-1"
              >
                Undo
              </button>
            )}
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  );
}
