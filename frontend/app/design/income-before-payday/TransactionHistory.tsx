"use client";

import { useRef, useState } from "react";
import MoneyText from "@/components/MoneyText";
import type { IncomeSeries, PreviewCategory } from "./fixtures";
import { money, shortDate } from "./fixtures";

type Props = {
  series: IncomeSeries[];
  categories: Record<string, PreviewCategory>;
  hidden: boolean;
  simulateSaveError: boolean;
  onSave: (seriesId: string, category: PreviewCategory) => void;
  onBack: () => void;
};

const categoryOptions: PreviewCategory[] = ["Income", "Transfer", "Shopping", "Other"];

const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950";

function CategoryChip({ category }: { category: PreviewCategory }) {
  const tone = {
    Income: "bg-emerald-50 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300",
    Transfer: "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
    Shopping: "bg-pink-50 text-pink-800 dark:bg-pink-400/10 dark:text-pink-300",
    Other: "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
  }[category];

  return <span className={`inline-flex min-h-8 items-center rounded-lg px-2.5 text-xs font-semibold ${tone}`}>{category}</span>;
}

export default function TransactionHistory({ series, categories, hidden, simulateSaveError, onSave, onBack }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, PreviewCategory>>({});
  const [errorId, setErrorId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const failedOnce = useRef(false);
  const editButtons = useRef<Record<string, HTMLButtonElement | null>>({});

  const openEditor = (item: IncomeSeries) => {
    setEditingId(item.id);
    setDrafts(current => ({ ...current, [item.id]: categories[item.id] ?? "Income" }));
    setErrorId(null);
    setStatus("");
  };

  const apply = (item: IncomeSeries) => {
    if (simulateSaveError && !failedOnce.current) {
      failedOnce.current = true;
      setErrorId(item.id);
      return;
    }
    const category = drafts[item.id] ?? categories[item.id] ?? "Income";
    onSave(item.id, category);
    setEditingId(null);
    setErrorId(null);
    setStatus(`${item.payer} is now categorised as ${category}.`);
    requestAnimationFrame(() => editButtons.current[item.id]?.focus());
  };

  return (
    <section aria-labelledby="transactions-heading" className="mx-auto max-w-3xl pb-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={onBack} className={`inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 active:opacity-70 dark:text-indigo-300 dark:hover:bg-indigo-400/10 ${focus}`}>
          Back to estimate
        </button>
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{series.reduce((total, item) => total + item.history.length, 0)} historical credits</span>
      </div>

      <div className="mt-5 max-w-2xl">
        <h2 id="transactions-heading" tabIndex={-1} className="text-xl font-bold tracking-tight text-slate-950 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-white">Transactions</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">These historical credits sit behind your predicted income. They are not future transactions.</p>
      </div>

      <p aria-live="polite" role="status" className="sr-only">{status}</p>

      <div className="mt-7 space-y-5">
        {series.map(item => {
          const category = categories[item.id] ?? "Income";
          const isEditing = editingId === item.id;
          const draft = drafts[item.id] ?? category;
          const error = errorId === item.id;
          const creditCount = item.history.length;

          return (
            <article key={item.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:shadow-none">
              <div className="p-4 sm:p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="break-words text-base font-bold text-slate-950 dark:text-white">{item.payer}</h3>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className="inline-flex min-h-8 items-center rounded-lg bg-slate-100 px-2.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">{item.accountName}</span>
                      <CategoryChip category={category} />
                    </div>
                  </div>
                  <button ref={node => { editButtons.current[item.id] = node; }} type="button" onClick={() => openEditor(item)} aria-expanded={isEditing} aria-controls={isEditing ? `category-editor-${item.id}` : undefined} className={`shrink-0 rounded-xl px-3 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 active:opacity-70 dark:text-indigo-300 dark:hover:bg-indigo-400/10 ${focus} min-h-11`}>
                    Change category
                  </button>
                </div>

                <div className="mt-5 border-y border-slate-100 dark:border-slate-800">
                  {item.history.map(credit => (
                    <div key={credit.id} className="grid min-h-[68px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-slate-100 py-3 last:border-0 dark:border-slate-800">
                      <div className="min-w-0">
                        <p className="break-words text-sm font-semibold text-slate-900 dark:text-slate-100">{credit.description}</p>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{shortDate(credit.date)} · {item.accountName} · {category}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-emerald-700 dark:text-emerald-300">Credit</p>
                        <p className="mt-0.5 text-sm font-bold tabular-nums text-slate-950 dark:text-white"><MoneyText text={`+${money(credit.amount, hidden)}`} /></p>
                      </div>
                    </div>
                  ))}
                </div>

                {isEditing && (
                  <div id={`category-editor-${item.id}`} className="mt-5 rounded-xl bg-slate-50 p-4 dark:bg-slate-800/70">
                    <fieldset>
                      <legend className="text-sm font-bold text-slate-950 dark:text-white">Category for these credits</legend>
                      <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">This changes all {creditCount} shown credit{creditCount === 1 ? "" : "s"} for {item.payer}.</p>
                      <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-300">Preview only. This changes the fictional example on this page; nothing is saved.</p>
                      <div className="mt-3 grid grid-cols-2 gap-2" role="radiogroup" aria-label={`Category for ${item.payer}`}>
                        {categoryOptions.map(option => (
                          <label key={option} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm font-medium ${draft === option ? "border-indigo-500 bg-indigo-50 text-indigo-950 dark:bg-indigo-400/10 dark:text-indigo-100" : "border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"} ${focus}`}>
                            <input type="radio" name={`category-${item.id}`} value={option} checked={draft === option} onChange={() => setDrafts(current => ({ ...current, [item.id]: option }))} className="size-4 accent-indigo-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500" />
                            {option}
                          </label>
                        ))}
                      </div>
                    </fieldset>

                    {error && <p role="status" className="mt-3 flex items-start gap-2 text-sm leading-5 text-slate-700 dark:text-slate-200"><span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-500" />We could not apply that example category change. Your selection is still here. Retry when ready.</p>}
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button type="button" onClick={() => apply(item)} className={`min-h-11 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 active:scale-95 ${focus}`}>
                        {error ? "Retry example change" : `Apply to ${creditCount} example credit${creditCount === 1 ? "" : "s"}`}
                      </button>
                      <button type="button" onClick={() => { setEditingId(null); setErrorId(null); editButtons.current[item.id]?.focus(); }} className={`min-h-11 rounded-xl px-4 text-sm font-semibold text-slate-700 hover:bg-slate-200 active:opacity-70 dark:text-slate-200 dark:hover:bg-slate-700 ${focus}`}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
