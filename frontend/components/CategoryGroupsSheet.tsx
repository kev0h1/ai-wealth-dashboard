"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, ChevronRight, LockKeyhole, Search } from "lucide-react";
import { ApiError, api, type CategoryGroupRow, type CategoryGroupsResponse, type CategoryKind } from "@/lib/api";
import { SheetFrame } from "@/components/SheetFrame";
import MoneyText from "@/components/MoneyText";
import { maskMoneyText, useBalancesHidden } from "@/lib/balancesHidden";

type View = "list" | "edit" | "reset";
const label: Record<CategoryKind, string> = { commitment: "Fixed", discretionary: "Free", movement: "Moved", excluded: "Not counted", income: "Income" };
const description: Partial<Record<CategoryKind, string>> = {
  commitment: "Bills and basics you plan around.", discretionary: "Other spending. This does not mean money left to spend.",
  movement: "Money you transfer, rather than spend on purchases.", excluded: "Not counted in spending totals. The actual cash remains recorded.",
};
const filterKinds: Array<CategoryKind | "all"> = ["all", "commitment", "discretionary", "movement", "excluded", "income"];

function amount(value: number | null | undefined) { return value == null ? null : `${value < 0 ? "−" : ""}£${Math.abs(value).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`; }
function rowAmount(row: CategoryGroupRow) { return row.editable_amount ?? row.amount; }
function periodDate(value: string) { return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`)); }
const contributionLabel: Record<string, string> = { fixed: "Fixed", moved: "Moved", free: "Free", excluded: "Not counted", income: "Income" };

export default function CategoryGroupsSheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void | Promise<void> }) {
  const hidden = useBalancesHidden();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<CategoryGroupsResponse | null>(null);
  const [view, setView] = useState<View>("list");
  const [selected, setSelected] = useState<CategoryGroupRow | null>(null);
  const [draft, setDraft] = useState<CategoryKind>("discretionary");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CategoryKind | "all">("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const load = async () => {
    setLoading(true); setError("");
    try { setData(await api.getCategoryGroups()); return true; }
    catch { setData(null); setError("Your groups could not be loaded. Try again."); return false; }
    finally { setLoading(false); }
  };
  useEffect(() => {
    let active = true;
    api.getCategoryGroups().then(result => { if (active) setData(result); })
      .catch(() => { if (active) setError("Your groups could not be loaded. Try again."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => { headingRef.current?.focus(); if (bodyRef.current) bodyRef.current.scrollTop = 0; }, [view]);
  const rows = useMemo(() => (data?.rows ?? []).filter(row =>
    row.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) && (filter === "all" || row.kind === filter)
  ), [data, query, filter]);
  const select = (row: CategoryGroupRow) => { setSelected(row); setDraft(row.kind); setError(""); setSaved(""); setView("edit"); };
  const reload = async () => {
    setSelected(null); setDraft("discretionary"); setView("list");
    return await load();
  };
  const write = async (restore: boolean) => {
    if (!data || (!restore && !selected)) return;
    setSaving(true); setError("");
    try {
      try {
        if (restore) await api.resetCategoryGroups(data.revision);
        else await api.saveCategoryGroup(selected!.name, draft, data.revision);
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          if (await reload()) setError("Your groups changed elsewhere. Check the latest groups before trying again.");
        } else setError(restore ? "Could not confirm the reset. Reload groups to check before trying again." : "Could not confirm this change. Reload groups to check before trying again.");
        return;
      }
      setSaved(restore ? "Original groups restored." : `${selected!.name} now counts as ${label[draft]}.`);
      setView("list"); setSelected(null);
      let refreshed = true;
      try { await onSaved(); } catch { refreshed = false; }
      const loaded = await load();
      if (!loaded) setError("Your change was saved, but the latest groups could not be loaded. Try again.");
      else if (!refreshed) setError("Your change was saved, but Spend could not refresh. Reload this page to see the updated figures.");
    } finally { setSaving(false); }
  };
  const title = view === "reset" ? "Restore original groups?" : view === "edit" ? selected?.name ?? "Category" : "Pay-split groups";
  const period = data?.period ? `${periodDate(data.period.start)} to ${periodDate(data.period.end)} · completed pay period` : "Your most recent completed pay period";
  const masked = (value: number | null | undefined) => maskMoneyText(amount(value) ?? "", hidden);
  const changed = data?.rows.filter(row => row.kind !== row.default_kind) ?? [];
  return <SheetFrame title={title} description={view === "list" ? period : undefined} onClose={onClose} onBack={view !== "list" && !saving ? () => { setError(""); setView("list"); } : undefined} backLabel="Back to groups" dismissDisabled={saving} headingRef={headingRef} bodyRef={bodyRef}
    bodyHeader={view === "list" && !loading ? <div className="border-b border-slate-100 px-5 pb-3 pt-1 dark:border-slate-700"><label className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-slate-50 px-3 text-slate-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"><Search size={17} aria-hidden="true" /><span className="sr-only">Find a category</span><input className="min-w-0 flex-1 bg-transparent text-base text-slate-950 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-50" type="search" placeholder="Find a category…" value={query} onChange={e => setQuery(e.target.value)} /></label><div className="mt-2 flex flex-wrap gap-1.5" aria-label="Filter categories by group">{filterKinds.map(kind => <button className={`min-h-11 rounded-xl border px-3 text-xs font-medium ${filter === kind ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950 dark:text-indigo-200" : "border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300"}`} key={kind} type="button" aria-pressed={filter === kind} onClick={() => setFilter(kind)}>{kind === "all" ? "All" : label[kind]}</button>)}</div></div> : undefined}
    footer={view === "edit" && selected?.editable ? <div className="py-1"><p className="mb-2 text-xs leading-5 text-slate-500 dark:text-slate-400">Applies to past and future periods.</p><button className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500 dark:disabled:bg-slate-700" type="button" disabled={saving || draft === selected.kind} onClick={() => void write(false)}>{saving ? "Saving…" : "Save group"}</button></div> : view === "reset" ? <button className="my-1 w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white" type="button" disabled={saving} onClick={() => void write(true)}>{saving ? "Restoring…" : "Restore original groups"}</button> : view === "list" && data ? ({ close }) => <div className="flex items-center justify-between py-1"><button className="text-sm font-semibold text-indigo-700 disabled:text-slate-400 dark:text-indigo-300" type="button" disabled={saving || !data.changed_count} onClick={() => setView("reset")}>Reset groups{data.changed_count ? ` (${data.changed_count})` : ""}</button><button className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white" type="button" disabled={saving} onClick={close}>Done</button></div> : undefined}>
    <div className="space-y-3 text-sm text-slate-700 dark:text-slate-300">
      {error && <div role="alert" className="border-b border-slate-200 pb-3 text-sm leading-6 text-slate-600 dark:border-slate-700 dark:text-slate-300">{error} {loading ? null : <button className="font-semibold text-indigo-700 dark:text-indigo-300" type="button" onClick={() => void reload()}>Reload groups</button>}</div>}
      {view === "list" && (loading ? <p className="py-6 text-slate-500">Loading your groups…</p> : !data ? null : <><p className="text-xs leading-5 text-slate-500 dark:text-slate-400">Change what a category means to you. Your choice is shared across Spend and Penny.</p>{saved && <p role="status" className="flex gap-2 text-sm text-slate-600 dark:text-slate-300"><Check size={16} aria-hidden="true" />{saved}</p>}<ul>{rows.map(row => <li key={row.name}><button className="flex min-h-[58px] w-full items-center justify-between gap-3 border-b border-slate-200 py-2 text-left dark:border-slate-700" type="button" disabled={saving} onClick={() => select(row)}><span className="min-w-0"><strong className="block font-medium text-slate-950 dark:text-slate-50">{row.name}</strong><small className="mt-0.5 block text-xs leading-5 text-slate-500 dark:text-slate-400">{row.editable ? "Your category" : "Protected rule"}</small></span><span className="flex shrink-0 items-center gap-2 text-xs text-slate-500 dark:text-slate-400"><span>{label[row.kind]}</span>{row.editable ? <ChevronRight size={16} /> : <LockKeyhole size={14} />}</span></button></li>)}</ul>{!rows.length && <p className="py-6 text-slate-500">No categories match “{query}”.</p>}</>) }
      {view === "edit" && selected && <><p className="text-xs leading-5 text-slate-500 dark:text-slate-400">{selected.editable ? "Your category" : "Protected rule"} · {label[selected.kind]}</p>{rowAmount(selected) != null && <div className="flex justify-between border-y border-slate-200 py-3 text-sm dark:border-slate-700"><span>In this completed period</span><MoneyText text={masked(rowAmount(selected))} className="font-semibold text-slate-950 dark:text-slate-50" /></div>}{!selected.editable ? <div className="space-y-3 leading-6"><p>{selected.reason ?? "This group is protected."}</p>{Object.entries(selected.contributions).filter(([, value]) => value != null && value !== 0).length > 0 && <dl className="border-y border-slate-200 py-2 text-xs dark:border-slate-700">{Object.entries(selected.contributions).filter(([, value]) => value != null && value !== 0).map(([kind, value]) => <div className="flex justify-between py-1" key={kind}><dt>{contributionLabel[kind] ?? kind}</dt><dd><MoneyText text={masked(value)} /></dd></div>)}</dl>}<p>Changing a category cannot override income, refund or repayment rules.</p></div> : <><fieldset className="mt-4"><legend className="font-semibold text-slate-950 dark:text-slate-50">Count {selected.name} as</legend>{selected.allowed_kinds.filter(k => k !== "income").map(kind => <label key={kind} className="flex min-h-16 gap-3 border-b border-slate-200 py-3 dark:border-slate-700"><input className="mt-1 size-[18px] accent-indigo-600" type="radio" name="category-group" value={kind} checked={draft === kind} onChange={() => { setDraft(kind); setError(""); }} disabled={saving} /><span><strong className="block text-slate-950 dark:text-slate-50">{label[kind]}</strong><small className="mt-1 block text-xs leading-5 text-slate-500 dark:text-slate-400">{description[kind]}</small></span></label>)}</fieldset>{draft !== selected.kind && selected.editable_amount != null && <div className="mt-4 border-t border-slate-200 pt-3 text-sm leading-6 dark:border-slate-700"><strong className="text-slate-950 dark:text-slate-50">What changes</strong><p>{draft === "excluded" ? `This category will be kept separate from spending totals. Its cash effect stays recorded.` : `${masked(selected.editable_amount)} will count as ${label[draft]}.`}</p>{data?.spending_total != null && <p className="text-xs text-slate-500 dark:text-slate-400">Current spending total: <MoneyText text={masked(data.spending_total)} /></p>}</div>}</>}</>}
      {view === "reset" && <div className="space-y-4 leading-6"><p>Restore the original groups for {changed.length === 1 ? "this category" : `these ${changed.length} categories`}.</p><ul>{changed.map(row => <li className="flex justify-between border-b border-slate-200 py-2 dark:border-slate-700" key={row.name}><strong>{row.name}</strong><span>{label[row.kind]} <ArrowLeft className="inline size-3 rotate-180" aria-hidden="true" /> {label[row.default_kind]}</span></li>)}</ul><p>Spend totals, the comparison and Penny will use the restored groups. Payment categories stay as they are.</p></div>}
    </div>
  </SheetFrame>;
}
