"use client";

import { useEffect, useId, useRef, useState } from "react";
import { SheetFrame } from "@/components/SheetFrame";
import CategoryIconPicker from "@/components/CategoryIconPicker";
import { useCategories } from "@/components/CategoriesContext";

export default function CategoryIconSheet({ name, onClose, nested = false }: { name: string; onClose: () => void; nested?: boolean }) {
  const { customCategories, kinds, icons, iconSources, categoriesReady, categoriesError, refreshCategories, saveCategoryIcon } = useCategories();
  const canonical = customCategories.find(category => category.trim().toLocaleLowerCase("en-GB") === name.trim().toLocaleLowerCase("en-GB")) ?? name;
  const formId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => { if (error) errorRef.current?.focus({ preventScroll: false }); }, [error]);

  async function save(draft: string | null, close: () => void) {
    if (busy) return;
    setBusy(true); setError("");
    try { await saveCategoryIcon(canonical, draft); if (live.current) close(); }
    catch (cause) { if (live.current) { setError(cause instanceof Error ? cause.message : "Your icon could not be saved. Try again."); setBusy(false); } }
  }

  const available = categoriesReady && customCategories.includes(canonical);
  return <SheetFrame title="Category icon" description={canonical} onClose={onClose} nested={nested} dismissDisabled={busy}
    footer={({ close }) => <div className="grid grid-cols-2 gap-2"><button type="submit" form={formId} disabled={busy || !available} aria-busy={busy} data-save-category-icon className="min-h-11 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 active:opacity-75 disabled:opacity-50">{busy ? "Saving…" : "Save icon"}</button><button type="button" disabled={busy} onClick={close} className="min-h-11 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 active:opacity-75 disabled:opacity-50 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800">Cancel</button></div>}>
    {({ close }) => <>{!categoriesReady ? <div role="status" className="text-sm text-slate-600 dark:text-slate-300"><p>{categoriesError || "Loading your category…"}</p>{categoriesError && <button type="button" onClick={() => void refreshCategories().catch(() => {})} className="mt-2 min-h-11 font-semibold text-indigo-700 underline underline-offset-4 active:opacity-75 dark:text-indigo-300">Try again</button>}</div>
      : !available ? <p role="status" className="text-sm text-slate-600 dark:text-slate-300">This custom category is no longer available.</p>
      : <IconDraft key={canonical} formId={formId} name={canonical} kind={kinds[canonical]} icon={icons[canonical]} source={iconSources[canonical]} busy={busy} onSave={draft => void save(draft, close)} />}
    {error && <p ref={errorRef} tabIndex={-1} role="alert" className="mt-4 rounded-xl border border-slate-300 p-3 text-[13px] leading-5 text-slate-600 outline-offset-2 dark:border-slate-600 dark:text-slate-300"><span aria-hidden="true" className="mr-2 inline-block size-1.5 rounded-full bg-amber-500" />{error}</p>}
    </>}
  </SheetFrame>;
}

function IconDraft({ formId, name, kind, icon, source, busy, onSave }: { formId: string; name: string; kind?: string; icon?: string; source?: "auto" | "user"; busy: boolean; onSave: (key: string | null) => void }) {
  // Mount only after metadata is available: a delayed read must not turn a
  // saved manual icon into an automatic reset before the person has chosen.
  const [draft, setDraft] = useState<string | null>(() => source === "user" ? icon ?? null : null);
  return <form id={formId} onSubmit={event => { event.preventDefault(); onSave(draft); }}>
    <p className="mb-5 text-[13px] leading-5 text-slate-600 dark:text-slate-300">Choose the icon you will see wherever this category appears.</p>
    <CategoryIconPicker name={name} kind={kind} value={draft} automaticKey={source === "auto" ? icon : undefined} onChange={setDraft} disabled={busy} />
  </form>;
}
