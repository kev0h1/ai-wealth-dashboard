"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronDown, Trash2, Receipt } from "lucide-react";
import { api, Basket } from "@/lib/api";

function money(amount: number | null, currency = "GBP") {
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(amount);
}

export default function ReceiptsPage() {
  const router = useRouter();
  const [baskets, setBaskets] = useState<Basket[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  useEffect(() => {
    api.listBaskets()
      .then(setBaskets)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function remove(id: string) {
    setBaskets((prev) => prev.filter((b) => b.id !== id));
    if (expanded === id) setExpanded(null);
    setPendingDeleteId(null);
    try { await api.deleteBasket(id); } catch {}
  }

  return (
    <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a]">
      <div className="sticky top-0 z-10 bg-[#f0f2f7]/90 dark:bg-[#0f172a]/90 backdrop-blur-sm border-b border-slate-200/60 dark:border-slate-700/60 safe-top">
        <div className="flex items-center gap-1 px-2 py-2">
          <button
            onClick={() => router.back()}
            className="w-11 h-11 flex items-center justify-center rounded-full text-slate-500 dark:text-slate-400 active:bg-slate-100 dark:active:bg-slate-800"
            aria-label="Back"
          >
            <ChevronLeft size={22} />
          </button>
          <h1 className="flex-1 text-lg font-bold text-slate-900 dark:text-slate-100">Receipts</h1>
          {!loading && baskets.length > 0 && (
            <span className="text-sm text-slate-500 dark:text-slate-400 pr-3">
              {baskets.length} total
            </span>
          )}
        </div>
      </div>

      <div className="px-4 py-4 pb-28 space-y-2">
        {loading ? (
          <>
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-16 bg-white dark:bg-slate-800 rounded-2xl shadow-sm animate-pulse" />
            ))}
          </>
        ) : baskets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-900/30 flex items-center justify-center mb-4">
              <Receipt size={24} className="text-emerald-500 dark:text-emerald-400" />
            </div>
            <p className="text-base font-semibold text-slate-700 dark:text-slate-200 mb-1">No receipts yet</p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4 max-w-[260px]">
              Scan a receipt from the Insights page to start tracking grocery prices.
            </p>
            <button
              onClick={() => router.back()}
              className="text-sm font-semibold text-emerald-600 dark:text-emerald-400"
            >
              Go back
            </button>
          </div>
        ) : (
          <ul className="space-y-2">
            {baskets.map((b) => {
              const open = expanded === b.id;
              return (
                <li
                  key={b.id}
                  className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden"
                >
                  <div className="flex items-center gap-2 p-3">
                    <button
                      onClick={() => setExpanded(open ? null : b.id)}
                      className="flex-1 flex items-center gap-2 min-w-0 text-left"
                      aria-expanded={open}
                    >
                      <ChevronDown
                        size={15}
                        className={`text-slate-400 flex-shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">
                          {b.shop || "Receipt"}
                          <span className="ml-1.5 text-[11px] font-normal text-slate-500 dark:text-slate-400">
                            {b.item_count} item{b.item_count === 1 ? "" : "s"}
                          </span>
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {b.purchased_at ? (
                            <>
                              {b.purchased_at}
                              {b.date_estimated && <span className="italic"> · estimated</span>}
                            </>
                          ) : (
                            "Date unknown"
                          )}
                        </p>
                      </div>
                    </button>
                    <span className="text-sm font-bold text-slate-900 dark:text-slate-100 num flex-shrink-0">
                      {money(b.total, b.currency)}
                    </span>
                    <button
                      onClick={() => setPendingDeleteId(b.id)}
                      className="p-2.5 -mr-1 text-slate-300 dark:text-slate-600 hover:text-rose-500 dark:hover:text-rose-400 active:scale-90 transition-transform flex-shrink-0"
                      aria-label="Delete receipt"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  {open && (
                    <ul className="px-3 pb-3 pt-0 space-y-1 border-t border-slate-100 dark:border-slate-700">
                      {b.items.map((it, i) => (
                        <li key={i} className="flex items-center justify-between gap-2 pt-1.5">
                          <div className="min-w-0">
                            <p className="text-[11px] text-slate-700 dark:text-slate-300 truncate">
                              {it.qty > 1 && (
                                <span className="text-slate-500 dark:text-slate-400">{it.qty}× </span>
                              )}
                              {it.name}
                            </p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">{it.category}</p>
                          </div>
                          <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300 num flex-shrink-0">
                            {money(it.line_price ?? it.unit_price, b.currency)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {pendingDeleteId !== null && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setPendingDeleteId(null)}
        >
          <div
            className="w-full max-w-md mx-4 mb-8 bg-white dark:bg-slate-800 rounded-2xl p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 mb-1">Delete receipt?</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">This can&apos;t be undone.</p>
            <div className="flex gap-2">
              <button
                onClick={() => setPendingDeleteId(null)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-600 dark:text-slate-300 active:bg-slate-50 dark:active:bg-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={() => remove(pendingDeleteId)}
                className="flex-1 py-2.5 rounded-xl bg-rose-500 text-sm font-semibold text-white active:bg-rose-600"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
