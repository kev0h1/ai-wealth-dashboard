"use client";

import Link from "next/link";
import { ChevronRight, Search, X } from "lucide-react";

export const SETTINGS_SECTIONS = ["financial", "cover", "display", "notifications", "account", "penny-plan", "assistants", "help", "delete"] as const;
export type SettingsSection = typeof SETTINGS_SECTIONS[number];

export function isSettingsSection(value: string | null): value is SettingsSection {
  return SETTINGS_SECTIONS.includes(value as SettingsSection);
}

type SettingsQuery = Pick<URLSearchParams, "get">;

/**
 * Resolves Settings' addressable detail pages and the two billing return
 * routes. An explicit valid section wins so a caller can deliberately link
 * to another Settings task without a stale billing parameter taking over.
 */
export function resolveSettingsSection(query: SettingsQuery, assistantsVisible: boolean): SettingsSection | null {
  const requestedSection = query.get("section");
  if (isSettingsSection(requestedSection)) {
    return requestedSection === "assistants" && !assistantsVisible ? null : requestedSection;
  }
  if (query.get("plans") === "1") return "penny-plan";
  const billing = query.get("billing");
  return billing === "success" || billing === "cancelled" ? "penny-plan" : null;
}

export type SettingsDirectoryStatus = {
  accountSummary: string;
  financialSummary: string;
  notificationSummary: string;
  planSummary: string;
  coverSummary: string;
  payPeriodSummary: string;
  assistantsVisible: boolean;
  helpSummary?: string;
  notificationAttention?: boolean;
};

type Task = { section: SettingsSection; label: string; helper?: string; keywords: string; value?: string; action?: "pay-period" };
type Group = { title: string; intro: string; tasks: Task[] };

export function buildSettingsGroups(status: SettingsDirectoryStatus): Group[] {
  return [
    { title: "Manage your money", intro: "Dates, tax details and safeguards behind your plan.", tasks: [
      { section: "financial", label: "Pay period", keywords: "pay payday period", value: status.payPeriodSummary, action: "pay-period" },
      { section: "financial", label: "Financial profile", keywords: "financial income salary pension child benefit tax", value: status.financialSummary },
      { section: "cover", label: "Cover-plan safeguards", keywords: "cover plan safeguards accounts payment short", value: status.coverSummary },
    ] },
    { title: "Make the app yours", intro: "Choose what you see and what Sorted highlights.", tasks: [
      { section: "display", label: "Display and privacy", keywords: "display dark mode theme balances privacy hide tips spend transactions", value: "Display choices" },
    ] },
    { title: "Notifications", intro: "Permission, delivery and the alerts you receive.", tasks: [
      { section: "notifications", label: "Notifications", keywords: "notifications push alerts test delivery bills transactions digest insights registration topics", value: status.notificationSummary },
    ] },
    { title: "Your account", intro: "Your details, access and history.", tasks: [
      { section: "account", label: "Profile, sign-in and data", keywords: "profile name postcode account sign in google apple identity security biometrics face id data history sync set aside", value: status.accountSummary },
    ] },
    { title: "Penny and your plan", intro: "What Penny can help with and your allowance.", tasks: [
      { section: "penny-plan", label: "Penny and your plan", keywords: "plan subscription usage penny setting things up consent allowance", value: status.planSummary },
      ...(status.assistantsVisible ? [{ section: "assistants" as const, label: "Connected assistants", keywords: "assistants connections mcp integrations", value: "Available when enabled" }] : []),
    ] },
    { title: "Help and information", intro: "Replay a tour or read the small print.", tasks: [
      { section: "help", label: "Help, tours and legal", keywords: "help tours guide terms privacy legal", value: status.helpSummary },
    ] },
  ];
}

export function SettingsDirectory({ active, status, search, onSearchChange, onPayPeriod }: {
  active: SettingsSection | null;
  status: SettingsDirectoryStatus;
  search: string;
  onSearchChange: (next: string) => void;
  onPayPeriod: () => void;
}) {
  const needle = search.trim().toLowerCase();
  const groups = buildSettingsGroups(status).map((group) => ({ ...group, tasks: group.tasks.filter((task) => !needle || [task.label, task.helper, task.keywords].filter(Boolean).join(" ").toLowerCase().includes(needle)) })).filter((group) => group.tasks.length);
  return <nav aria-label="Settings tasks" className="min-w-0">
    <div className="relative mt-5">
      <Search size={18} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input type="search" name="settings-search" autoComplete="off" value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Search settings" aria-label="Search settings" className="min-h-11 w-full rounded-xl border border-slate-200 bg-white py-2 pl-10 pr-10 text-base text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
      {search && <button type="button" onClick={() => onSearchChange("")} aria-label="Clear settings search" className="absolute right-1 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-slate-700"><X size={16} aria-hidden="true" /></button>}
    </div>
    {groups.length ? <div className="space-y-8 pt-8">{groups.map((group) => <section key={group.title} aria-labelledby={`settings-${group.title.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
      <h2 id={`settings-${group.title.toLowerCase().replace(/[^a-z]+/g, "-")}`} className="text-base font-bold text-slate-900 dark:text-slate-100">{group.title}</h2>
      <p className="mt-1 text-[13px] leading-5 text-slate-600 dark:text-slate-400">{group.intro}</p>
      <div className="glass-card mt-3 overflow-hidden rounded-2xl">{group.tasks.map((task, index) => {
        const content = <><span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">{task.label}</span></span>{task.value && <span className="flex min-w-0 max-w-[52%] items-center justify-end gap-1.5 text-right text-[13px] leading-snug text-slate-600 dark:text-slate-400">{task.section === "notifications" && status.notificationAttention && <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-amber-500 dark:bg-amber-400" />}<span>{task.value}</span></span>}<ChevronRight size={16} aria-hidden="true" className="shrink-0 text-slate-400" /></>;
        const cls = `flex min-h-[52px] w-full items-center gap-3 px-4 py-3 text-left transition-opacity hover:bg-slate-50 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:hover:bg-slate-700/50 ${index ? "border-t border-slate-100 dark:border-slate-700" : ""}`;
        return task.action === "pay-period" ? <button key={`${task.section}-${task.action}`} type="button" onClick={onPayPeriod} className={cls}>{content}</button> : <Link key={task.section} href={`/settings?section=${task.section}`} aria-current={active === task.section ? "page" : undefined} className={cls}>{content}</Link>;
      })}</div>
    </section>)}</div> : <p role="status" className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">No settings match “{search}”. Try a different word.</p>}
  </nav>;
}
