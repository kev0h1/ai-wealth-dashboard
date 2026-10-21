"use client";

// TEMPORARY PREVIEW. B58 design round, skill: impeccable. House ads on the
// free Statements plan: Sorted's own upgrade prompt, never a third-party ad.
// Three art-direction variants x three placements, synthetic fixtures only.
//
// Production components rendered here: SafeToSpendCard (the Statements Home
// hero, with a fixture payload), DismissChip (the V2 glass chip, exported
// from HomeBrief) and the shared button grammar (ACTION_BASE). Hand-authored
// because no production component exists: the Statements Home shell around the
// hero, the upload sheet's post-upload state (StatementUpload keeps its result
// in internal state set only by a real upload, so it cannot take props) and
// the monthly-limit state (not built yet).
//
// /design/statements-house-ads?variant=a|b|c&account=<id>&risk=1&mode=light|dark

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle, ChevronRight, FileText, Landmark, Upload } from "lucide-react";
import SafeToSpendCard from "@/components/SafeToSpendCard";
import { ACTION_BASE, DismissChip } from "@/components/HomeBrief";
import { HERO_FIXTURES } from "../safe-to-spend-hero/fixtures";
import {
  ACCOUNTS,
  COPY,
  IMPORTED,
  MEASUREMENT,
  PLAN_PICKER_HREF,
  SNOOZE_DAYS,
  houseAdEligibility,
  type AdCopy,
  type HouseAdAccount,
  type Placement,
} from "./fixtures";

type Variant = "a" | "b" | "c";
type Mode = "light" | "dark";

const VARIANTS: { key: Variant; label: string; note: string }[] = [
  { key: "a", label: "A · Quiet card", note: "One calm card on the card surface, indigo-tint Lite mark, dismiss chip top right, a full-width action in the card's own action dock." },
  { key: "b", label: "B · Side by side", note: "The card makes its point with a two-row comparison, from your uploads against with Lite, so the benefit is read rather than described." },
  { key: "c", label: "C · On the canvas", note: "No card at all (Canvas Before Cards): a hairline, a headline, a sentence and an inline link, so it reads as the app talking, not an advert." },
];

const PLACEMENTS: { key: Placement; label: string }[] = [
  { key: "home", label: "Statements Home" },
  { key: "upload", label: "After an upload" },
  { key: "limit", label: "At the 3-uploads limit" },
];

const MONEY_SPLIT = /(£\d+(?:\.\d+)?)/g;
function MoneyCopy({ text }: { text: string }) {
  return <>{text.split(MONEY_SPLIT).map((part, i) => (part.startsWith("£") ? <span key={i} className="money tabular-nums">{part}</span> : part))}</>;
}

function ThemeEffect({ mode }: { mode: Mode }) {
  useEffect(() => {
    const root = document.documentElement;
    const hadDark = root.classList.contains("dark");
    const scheme = document.querySelector('meta[name="color-scheme"]');
    const old = scheme?.getAttribute("content") ?? null;
    root.classList.toggle("dark", mode === "dark");
    scheme?.setAttribute("content", mode === "dark" ? "dark" : "only light");
    return () => {
      root.classList.toggle("dark", hadDark);
      if (old === null) scheme?.removeAttribute("content");
      else scheme?.setAttribute("content", old);
    };
  }, [mode]);
  return null;
}

const NOW = "2026-10-21T09:00:00.000Z";
const noop = () => {};

const PRIMARY = `${ACTION_BASE} w-full bg-indigo-600 text-white [@media(hover:hover)]:hover:bg-indigo-700`;
const LINK_CTA = "inline-flex min-h-11 touch-manipulation items-center gap-1 rounded-xl text-sm font-semibold text-indigo-700 [-webkit-tap-highlight-color:transparent] active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300";
const FINE = "text-xs leading-relaxed text-slate-600 dark:text-slate-300";

function LiteMark() {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700 dark:bg-indigo-400/10 dark:text-indigo-300" aria-hidden="true">
      <Landmark size={16} />
    </span>
  );
}

function CompareRows({ copy }: { copy: AdCopy }) {
  return (
    <dl className="divide-y divide-slate-100 border-y border-slate-100 text-sm dark:divide-slate-700/70 dark:border-slate-700/70">
      <div className="flex items-center gap-3 py-2.5">
        <dt className="w-24 shrink-0 text-xs font-semibold text-slate-600 dark:text-slate-300">From uploads</dt>
        <dd className="flex min-w-0 items-center gap-2 text-slate-700 dark:text-slate-200"><span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />{copy.compare.upload}</dd>
      </div>
      <div className="flex items-center gap-3 py-2.5">
        <dt className="w-24 shrink-0 text-xs font-semibold text-slate-600 dark:text-slate-300">With Lite</dt>
        <dd className="flex min-w-0 items-center gap-2 text-slate-900 dark:text-slate-100"><span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />{copy.compare.live}</dd>
      </div>
    </dl>
  );
}

function HouseAd({ variant, copy, onDismiss, onTap }: { variant: Variant; copy: AdCopy; onDismiss: () => void; onTap: () => void }) {
  const dismiss = <DismissChip label="Dismiss for now" onClick={onDismiss} className="absolute right-2 top-2 z-10" />;
  const cta = (cls: string) => (
    <Link href={PLAN_PICKER_HREF} onClick={onTap} className={cls}>
      {copy.cta}
      <ChevronRight size={15} aria-hidden="true" className="shrink-0" />
    </Link>
  );
  if (variant === "a") {
    return (
      <section aria-label="Sorted Lite" className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        {dismiss}
        <div className="flex items-center gap-2 pr-10"><LiteMark /><h3 className="text-base font-bold leading-snug text-slate-900 text-balance dark:text-slate-100">{copy.title}</h3></div>
        <p className="mt-2 text-sm text-slate-700 text-pretty dark:text-slate-200">{copy.body}</p>
        <div className="-mx-4 -mb-4 mt-4 border-t border-slate-100 bg-slate-50/80 px-4 py-3 dark:border-slate-700/70 dark:bg-slate-900/25">
          <Link href={PLAN_PICKER_HREF} onClick={onTap} className={PRIMARY}>{copy.cta}</Link>
          <p className={`mt-2 ${FINE}`}><MoneyCopy text={copy.fine} /></p>
        </div>
      </section>
    );
  }
  if (variant === "b") {
    return (
      <section aria-label="Sorted Lite" className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        {dismiss}
        <h3 className="pr-10 text-base font-bold leading-snug text-slate-900 text-balance dark:text-slate-100">{copy.title}</h3>
        <p className="mt-1 text-sm text-slate-700 text-pretty dark:text-slate-200">{copy.body}</p>
        <div className="mt-3"><CompareRows copy={copy} /></div>
        <div className="mt-3">
          <Link href={PLAN_PICKER_HREF} onClick={onTap} className={`${ACTION_BASE} w-full border border-indigo-200 bg-indigo-50 text-indigo-800 [@media(hover:hover)]:hover:bg-indigo-100 dark:border-indigo-400/30 dark:bg-indigo-400/10 dark:text-indigo-200`}>{copy.cta}</Link>
          <p className={`mt-2 ${FINE}`}><MoneyCopy text={copy.fine} /></p>
        </div>
      </section>
    );
  }
  return (
    <section aria-label="Sorted Lite" className="relative border-t border-slate-200 pt-4 dark:border-slate-700">
      {dismiss}
      <div className="flex items-center gap-2 pr-10"><Landmark size={16} aria-hidden="true" className="shrink-0 text-indigo-700 dark:text-indigo-300" /><h3 className="text-sm font-semibold leading-snug text-slate-900 text-balance dark:text-slate-100">{copy.title}</h3></div>
      <p className="mt-1 text-sm text-slate-700 text-pretty dark:text-slate-200">{copy.body}</p>
      <div className="mt-1">{cta(LINK_CTA)}</div>
      <p className={FINE}><MoneyCopy text={copy.fine} /></p>
    </section>
  );
}

// Eligibility wrapper: one slot per screen, so "at most one house ad per
// screen" holds by construction. Dismiss writes a 7 day snooze (fixture state).
function AdSlot({ placement, variant, account, risk }: { placement: Placement; variant: Variant; account: HouseAdAccount; risk: boolean }) {
  const [snoozedUntil, setSnoozedUntil] = useState<string | null>(null);
  const [taps, setTaps] = useState(0);
  const elig = houseAdEligibility({ account, riskState: risk, snoozedUntil, now: NOW });
  const dismissed = snoozedUntil !== null;
  return (
    <div data-testid={`ad-slot-${placement}`}>
      {elig.show ? (
        <HouseAd variant={variant} copy={COPY[placement][elig.trial]} onDismiss={() => setSnoozedUntil(new Date(Date.parse(NOW) + SNOOZE_DAYS * 86400000).toISOString())} onTap={() => setTaps((n) => n + 1)} />
      ) : null}
      <p role="status" className="mt-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-700 dark:border-slate-600 dark:text-slate-300" data-preview-note>
        {elig.show ? `Preview: showing. Dismiss hides it for ${SNOOZE_DAYS} days.${taps ? ` Taps this session: ${taps}.` : ""}` : `Preview: no card. ${elig.reason}`}
        {dismissed ? <button type="button" onClick={() => setSnoozedUntil(null)} className="ml-2 inline-flex min-h-11 items-center font-semibold underline underline-offset-4">Show again</button> : null}
      </p>
    </div>
  );
}

function Screen({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section aria-label={label} className="mt-6">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">{label}</h2>
      <div className="rounded-3xl border border-slate-200 bg-slate-100/60 p-3 dark:border-slate-700 dark:bg-slate-900/60">{children}</div>
    </section>
  );
}

function HomeScreen(p: { variant: Variant; account: HouseAdAccount; risk: boolean }) {
  return (
    <Screen label="Statements Home">
      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <p className="text-base font-bold text-slate-900 dark:text-slate-100">Good morning</p>
          <span className="rounded-full bg-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">Statements plan</span>
        </div>
        <SafeToSpendCard data={HERO_FIXTURES[p.risk ? "bills-short" : "comfortable"]} loading={false} error={false} onRetry={noop} previewBalancesVisible />
        <AdSlot placement="home" {...p} />
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <p className="px-4 pt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">From your statements</p>
          {IMPORTED.map((s) => (
            <div key={s.id} className="flex items-center gap-3 border-t border-slate-100 px-4 py-3 first:border-t-0 dark:border-slate-700/70">
              <FileText size={16} aria-hidden="true" className="shrink-0 text-slate-500 dark:text-slate-400" />
              <div className="min-w-0"><p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{s.bank}</p><p className="text-xs text-slate-600 dark:text-slate-300">{s.detail}</p></div>
            </div>
          ))}
        </div>
      </div>
    </Screen>
  );
}

function SheetShell({ title, children, footer }: { title: string; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900" role="group" aria-label={title}>
      <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-700/70"><p className="text-base font-bold text-slate-900 dark:text-slate-100">{title}</p></div>
      <div className="space-y-4 px-4 py-4">{children}</div>
      <div className="border-t border-slate-100 px-4 py-3 dark:border-slate-700/70">{footer}</div>
    </div>
  );
}

function UploadScreen(p: { variant: Variant; account: HouseAdAccount; risk: boolean }) {
  return (
    <Screen label="After an upload">
      <SheetShell title="Upload Bank Statement" footer={<button type="button" className={`${ACTION_BASE} w-full bg-indigo-600 text-white`}>Done</button>}>
        <div className="flex flex-col items-center gap-2 py-2">
          <CheckCircle size={40} aria-hidden="true" className="text-emerald-500" />
          <p className="text-center text-sm font-semibold text-slate-800 dark:text-slate-100">42 transactions imported from Barclays</p>
          <p className="text-xs text-slate-600 dark:text-slate-300">Account: ••4821</p>
        </div>
        <AdSlot placement="upload" {...p} />
      </SheetShell>
    </Screen>
  );
}

function LimitScreen(p: { variant: Variant; account: HouseAdAccount; risk: boolean }) {
  return (
    <Screen label="At the 3-uploads limit">
      <SheetShell title="Upload Bank Statement" footer={<button type="button" disabled className={`${ACTION_BASE} w-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300`}><Upload size={16} aria-hidden="true" className="mr-1" />Upload another statement</button>}>
        <div>
          <div className="flex items-baseline justify-between"><p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Uploads this month</p><p className="text-sm text-slate-700 dark:text-slate-200">3 of 3</p></div>
          <div className="mt-2 h-2 rounded-full bg-slate-100 dark:bg-slate-700" role="img" aria-label="3 of 3 uploads used"><div className="h-2 w-full rounded-full bg-indigo-500" /></div>
        </div>
        <AdSlot placement="limit" {...p} />
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">Imported this month</p>
          <ul className="mt-1 divide-y divide-slate-100 dark:divide-slate-700/70">
            {IMPORTED.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2.5"><FileText size={16} aria-hidden="true" className="shrink-0 text-slate-500 dark:text-slate-400" /><div className="min-w-0"><p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{s.bank}</p><p className="text-xs text-slate-600 dark:text-slate-300">{s.detail}</p></div></li>
            ))}
          </ul>
        </div>
      </SheetShell>
    </Screen>
  );
}

export default function StatementsHouseAdsClient() {
  const sp = useSearchParams();
  const variant: Variant = (["a", "b", "c"] as const).find((v) => v === sp.get("variant")) ?? "a";
  const mode: Mode = sp.get("mode") === "dark" ? "dark" : "light";
  const account = ACCOUNTS.find((a) => a.id === (sp.get("account") ?? sp.get("state"))) ?? ACCOUNTS[0];
  const risk = sp.get("risk") === "1";
  const v = VARIANTS.find((x) => x.key === variant)!;
  const href = (o: Record<string, string | null>) => {
    const q = new URLSearchParams({ variant, account: account.id, mode, ...(risk ? { risk: "1" } : {}) });
    for (const [k, val] of Object.entries(o)) { if (val === null) q.delete(k); else q.set(k, val); }
    return `/design/statements-house-ads?${q.toString()}`;
  };
  const pill = "inline-flex min-h-11 items-center rounded-full px-3 text-xs font-semibold touch-manipulation";
  const off = "bg-white text-slate-700 border border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600";
  const rows = useMemo(() => [
    { label: "Variant", items: VARIANTS.map((x) => ({ id: x.key, text: x.label, to: { variant: x.key }, on: x.key === variant })) },
    { label: "Account", items: ACCOUNTS.map((a) => ({ id: a.id, text: a.label, to: { account: a.id }, on: a.id === account.id })) },
  ], [variant, account.id]);
  const props = { variant, account: account.id, risk };

  return (
    <main className="mx-auto min-h-screen max-w-md bg-slate-50 px-4 py-6 dark:bg-slate-900">
      <ThemeEffect mode={mode} />
      <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">B58 · House ads on Statements</h1>
      <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">{v.note}</p>
      <nav aria-label="Preview controls" className="mt-3 space-y-2">
        {rows.map((g) => (
          <div key={g.label} className="flex flex-wrap items-center gap-2">
            <span className="w-16 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">{g.label}</span>
            {g.items.map((it) => (
              <Link key={it.id} href={href(it.to)} aria-current={it.on ? "true" : undefined} className={`${pill} ${it.on ? "bg-indigo-600 text-white" : off}`}>{it.text}</Link>
            ))}
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">Toggles</span>
          <Link href={href({ mode: mode === "dark" ? "light" : "dark" })} className={`${pill} ${off}`}>{mode === "dark" ? "Light" : "Dark"}</Link>
          <Link href={href({ risk: risk ? null : "1" })} className={`${pill} ${off}`}>{risk ? "Hero: short (red)" : "Hero: on track"}</Link>
        </div>
      </nav>
      <p className="mt-3 text-xs text-slate-700 dark:text-slate-200">Preview: the Statements Home shell, the upload result and the limit state are hand-authored mocks. Only the Safe to Spend hero and the dismiss chip are production components. £5.99 and 1 November are fixture values; production uses the server price and the real reset date.</p>
      <p className="mt-2 text-xs text-slate-700 dark:text-slate-200">{account.note}</p>
      <HomeScreen {...props} />
      <UploadScreen {...props} />
      <LimitScreen {...props} />
      <details className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
        <summary className="min-h-11 cursor-pointer py-2 font-semibold text-slate-900 dark:text-slate-100">Rules and measurement notes</summary>
        <ul className="mt-2 list-disc space-y-1.5 pl-5">
          <li>One house ad per screen. Each screen above has a single slot.</li>
          <li>Dismiss uses the shared glass chip and snoozes that placement for {SNOOZE_DAYS} days.</li>
          <li>Hidden when the hero is in a risk state, and for every plan except Statements. A user on the 14-day trial counts as a trial user.</li>
          <li>Never the Penny gradient. The action goes to the existing plan picker ({PLAN_PICKER_HREF}), link only.</li>
          <li>Trial available: the card says a card is needed and that it renews unless cancelled. Trial used: plain subscribe prompt.</li>
          <li>Fold-in eligibility tests: (1) trial available shows the trial invitation with the card disclosure; (2) trial used shows the plain subscribe prompt; (3) eligibility unknown (trial_eligible null or absent) shows only the plain subscribe prompt, as PlanPicker's <code>?? false</code> does.</li>
          {MEASUREMENT.map((m) => <li key={m}>{m}</li>)}
        </ul>
      </details>
    </main>
  );
}
