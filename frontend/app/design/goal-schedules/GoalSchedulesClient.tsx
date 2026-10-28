"use client";

// TEMPORARY PREVIEW. G351, skill: impeccable. Goals that follow a contribution
// schedule other than equal amounts, set up with Penny. Three art directions
// for the two pieces that need design: the Penny confirmation card (state
// `confirm`) and View plan (states `plan` and `edit`).
//
//   A Ledger          mono rows: total, this pay period, next periods
//   B Sentence first  the schedule in words, one figure, the rest a whisper
//   C Sparkline       A plus a small rising step line and a bar against the schedule
//
// Production pieces used: PlanRecordView (View plan record, with the new
// "Next:" line fed by the server's next_periods) and ProposalConfirmCard (the
// card as it ships today, shown for comparison). Everything else is hand-authored
// because no production schedule component exists yet. Fixtures are Kevin's own
// 4p challenge; nothing is fetched or saved, and the figures in the editor are
// fixed rather than recalculated as you type.
//
// /design/goal-schedules?variant=a|b|c&state=confirm|plan|edit&mode=light|dark[&convert=1]

import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { Check, ChevronDown } from "lucide-react";
import MoneyText from "@/components/MoneyText";
import { ProposalConfirmCard, type ProposalMsg } from "@/components/PennyConversation";
import { PlanRecordView } from "@/components/plans/PlanRecordView";
import {
  DAILY, DUE_SO_FAR, END_LABEL, HISTORY_NOTE, LADDER, NAME, NEXT, NOTHING_MOVES, POT, POT_ACCOUNT, REPLACES,
  SAVED, SENTENCE, SOURCE, SOURCE_ACCOUNT, THIS_PERIOD, TOTAL, money,
} from "./fixtures";

type Mode = "light" | "dark";
type Variant = "a" | "b" | "c";
type State = "confirm" | "plan" | "edit";

const VARIANTS: { key: Variant; label: string }[] = [{ key: "a", label: "A Ledger" }, { key: "b", label: "B Sentence" }, { key: "c", label: "C Sparkline" }];
const STATES: { key: State; label: string }[] = [{ key: "confirm", label: "Confirm" }, { key: "plan", label: "Plan" }, { key: "edit", label: "Edit" }];
const LABEL = "text-[10px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400";
const QUIET = "inline-flex min-h-11 touch-manipulation items-center rounded-xl px-2 text-sm font-semibold text-indigo-600 [-webkit-tap-highlight-color:transparent] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400";
const chip = (active: boolean) => `flex min-h-11 touch-manipulation items-center justify-center rounded-xl px-3 text-xs font-semibold [-webkit-tap-highlight-color:transparent] transition-[transform,background-color,color] duration-150 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${active ? "bg-white text-slate-950" : "text-white/80 hover:bg-white/10"}`;

// ── Shared hand-authored pieces ──────────────────────────────────────────────

function Fig({ children, className = "" }: { children: string; className?: string }) {
  return <span className={`tabular-nums ${className}`}><MoneyText text={children} /></span>;
}

function PennyLead({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] rounded-2xl rounded-bl-sm bg-slate-100 px-4 py-3 text-[14px] leading-relaxed text-slate-700 dark:bg-slate-700 dark:text-slate-200">{children}</div>
    </div>
  );
}

function SourceLine({ convert }: { convert: boolean }) {
  return (
    <div className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-700">
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 text-[13px] leading-5 text-slate-600 dark:text-slate-300">
          <span className="font-semibold text-slate-900 dark:text-slate-100">Leaves from {SOURCE.name}</span>
          <span aria-hidden="true"> · </span>into {POT.name}
          <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">Found from your recent transfers. Check it is right.</span>
        </p>
        <button type="button" className={QUIET} aria-label="Change the account the money leaves from">Change</button>
      </div>
      {convert && (
        <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-300">
          Replaces your {REPLACES} set-aside. Confirming also pauses it. {HISTORY_NOTE}
        </p>
      )}
      <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">{NOTHING_MOVES}</p>
    </div>
  );
}

function Buttons() {
  return (
    <div className="mt-3 flex items-center gap-2">
      <button type="button" className="min-h-[44px] flex-1 rounded-xl bg-indigo-600 text-sm font-semibold text-white active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">Confirm</button>
      <button type="button" className="min-h-[44px] rounded-xl px-4 text-sm font-semibold text-slate-500 active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-400">Cancel</button>
    </div>
  );
}

/** Rising step line of the daily amounts (weekly steps), indigo ink only. */
function Sparkline({ className = "" }: { className?: string }) {
  const W = 300, H = 56, max = DAILY[DAILY.length - 1], todayIdx = 300;
  const pts: string[] = [];
  for (let wk = 0; wk <= 52; wk++) {
    const i = Math.min(364, wk * 7);
    const x = (i / 364) * W;
    const y = H - 4 - (DAILY[i] / max) * (H - 10);
    pts.push(`${wk === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`);
    if (wk < 52) pts.push(`L${(Math.min(364, (wk + 1) * 7) / 364 * W).toFixed(1)},${y.toFixed(1)}`);
  }
  const line = pts.join(" ");
  const tx = (todayIdx / 364) * W;
  return (
    <figure className={className}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Daily amount rising from 4p on 1 January to £14.60 on 31 December, today marked" className="h-14 w-full overflow-visible">
        <path d={`${line} L${W},${H - 2} L0,${H - 2} Z`} className="fill-indigo-600/10 dark:fill-indigo-400/15" />
        <path d={line} fill="none" strokeWidth="1.5" strokeLinejoin="round" className="stroke-indigo-600 dark:stroke-indigo-400" />
        <line x1={tx} x2={tx} y1="2" y2={H - 2} strokeWidth="1" strokeDasharray="2 3" className="stroke-slate-400 dark:stroke-slate-500" />
        <circle cx={tx} cy={H - 4 - (DAILY[todayIdx] / max) * (H - 10)} r="3" className="fill-indigo-600 stroke-white dark:fill-indigo-400 dark:stroke-slate-900" strokeWidth="1.5" />
      </svg>
      <figcaption className="mt-1 flex justify-between text-[11px] text-slate-500 dark:text-slate-400"><span>1 Jan, <Fig>£0.04</Fig> a day</span><span>31 Dec, <Fig>£14.60</Fig> a day</span></figcaption>
    </figure>
  );
}

/** Progress against the schedule, not a straight line: the tick is what has fallen due so far. */
function ScheduleBar() {
  const fill = (SAVED / TOTAL) * 100, due = (DUE_SO_FAR / TOTAL) * 100;
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
        <span>On schedule</span>
        <span><Fig>{money(SAVED)}</Fig> set aside, <Fig>{money(DUE_SO_FAR)}</Fig> due so far</span>
      </div>
      <div className="relative mt-2 h-1.5 rounded-full bg-slate-100 dark:bg-slate-700" role="progressbar" aria-label="Set aside against the schedule" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fill)} aria-valuetext={`${money(SAVED)} set aside, ${money(DUE_SO_FAR)} due so far, of ${money(TOTAL)}`}>
        <span className="block h-full rounded-full bg-indigo-600" style={{ width: `${fill}%` }} />
        <span aria-hidden="true" className="absolute -top-1 h-3.5 w-0.5 rounded-full bg-slate-900 dark:bg-slate-100" style={{ left: `calc(${due}% - 1px)` }} />
      </div>
    </div>
  );
}

// ── Variant A / C ledger rows ────────────────────────────────────────────────

function ConfirmRows() {
  const rows: [string, string, boolean][] = [
    ["Total", money(TOTAL), true],
    [`This pay period (${THIS_PERIOD.label})`, money(THIS_PERIOD.amount), false],
    ...NEXT.map((n): [string, string, boolean] => [`Then ${n.label}`, money(n.amount), false]),
  ];
  return (
    <dl className="mt-3 divide-y divide-slate-200 border-y border-slate-200 text-sm dark:divide-slate-700 dark:border-slate-700">
      {rows.map(([k, v, strong]) => (
        <div key={k} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 py-2">
          <dt className="min-w-0 text-slate-600 dark:text-slate-300">{k}</dt>
          <dd className={`text-right ${strong ? "text-base font-bold text-slate-900 dark:text-slate-100" : "font-semibold text-slate-900 dark:text-slate-100"}`}><Fig>{v}</Fig></dd>
        </div>
      ))}
    </dl>
  );
}

function ConfirmCard({ variant, convert }: { variant: Variant; convert: boolean }) {
  return (
    <section aria-label="Penny's proposal" className="glass-card w-full rounded-2xl p-4">
      <p className={LABEL}>New goal</p>
      {variant === "b" ? (
        <>
          <p className="mt-1 text-[16px] font-bold leading-snug text-slate-900 dark:text-slate-100">Save 4p on day one, then 4p more each day, for 365 days.</p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{NAME}, from 1 Jan 2026</p>
          <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400">This pay period ({THIS_PERIOD.label})</p>
          <p className="text-[30px] font-bold leading-tight tracking-tight text-slate-900 dark:text-slate-100"><Fig>{money(THIS_PERIOD.amount)}</Fig></p>
          <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">
            <Fig>{money(TOTAL)}</Fig> in total, finishing {END_LABEL}. Then <Fig>{money(NEXT[0].amount)}</Fig>, <Fig>{money(NEXT[1].amount)}</Fig>.
          </p>
        </>
      ) : (
        <>
          <p className="mt-1 text-[16px] font-bold leading-snug text-slate-900 dark:text-slate-100">{NAME}</p>
          <p className="mt-0.5 text-[12px] leading-5 text-slate-600 dark:text-slate-300">{SENTENCE}</p>
          {variant === "c" && <Sparkline className="mt-3" />}
          <ConfirmRows />
        </>
      )}
      <SourceLine convert={convert} />
      <Buttons />
    </section>
  );
}

// ── View plan blocks ─────────────────────────────────────────────────────────

function Ladder({ foldEarlier }: { foldEarlier: boolean }) {
  const [open, setOpen] = useState(false);
  const past = LADDER.filter(r => r.status === "past");
  const shown = LADDER.filter(r => r.status !== "past" || open || !foldEarlier || past.slice(-2).includes(r));
  const hiddenCount = foldEarlier && !open ? past.length - 2 : 0;
  return (
    <div>
      {hiddenCount > 0 && (
        <button type="button" onClick={() => setOpen(true)} aria-expanded={false} className={`${QUIET} -ml-2`}>
          <ChevronDown size={14} className="mr-1" aria-hidden="true" />Earlier periods ({hiddenCount})
        </button>
      )}
      <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
        {shown.map(r => (
          <li key={r.label} aria-current={r.status === "current" ? "step" : undefined}
            className={`grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-2 py-2 ${r.status === "current" ? "-mx-2 rounded-xl bg-indigo-50 px-2 dark:bg-indigo-500/10" : ""}`}>
            <span aria-hidden="true" className="flex justify-center">
              {r.status === "past" ? <Check size={14} className="text-slate-400 dark:text-slate-500" /> : <span className={`h-1.5 w-1.5 rounded-full ${r.status === "current" ? "bg-indigo-600 dark:bg-indigo-400" : "bg-slate-300 dark:bg-slate-600"}`} />}
            </span>
            <span className={r.status === "past" ? "text-slate-500 dark:text-slate-400" : "font-semibold text-slate-900 dark:text-slate-100"}>
              {r.label}{r.status === "past" && <span className="sr-only"> (passed)</span>}{r.status === "current" && <span className="ml-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-300">This pay period</span>}
            </span>
            <span className={`text-right ${r.status === "past" ? "text-slate-500 dark:text-slate-400" : "font-semibold text-slate-900 dark:text-slate-100"}`}><Fig>{money(r.amount)}</Fig></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PlanSchedule({ variant, onEdit }: { variant: Variant; onEdit: () => void }) {
  const [full, setFull] = useState(false);
  return (
    <section aria-label="Schedule" className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={LABEL}>Schedule</p>
          <p className="mt-1 text-[13px] leading-5 text-slate-700 dark:text-slate-200">{SENTENCE}</p>
        </div>
        <button type="button" onClick={onEdit} className={QUIET}>Edit</button>
      </div>
      {variant === "b" ? (
        <>
          <p className="text-[20px] font-bold leading-tight tracking-tight text-slate-900 dark:text-slate-100">
            <span className="block text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400">This pay period</span>
            <Fig>{money(THIS_PERIOD.amount)}</Fig><span className="ml-2 text-sm font-medium text-slate-500 dark:text-slate-400">next <Fig>{money(NEXT[0].amount)}</Fig></span>
          </p>
          <button type="button" aria-expanded={full} onClick={() => setFull(v => !v)} className={`${QUIET} -ml-2`}>
            <ChevronDown size={14} className={`mr-1 transition-transform ${full ? "rotate-180" : ""}`} aria-hidden="true" />{full ? "Hide the full schedule" : "See the full schedule"}
          </button>
          {full && <Ladder foldEarlier={false} />}
        </>
      ) : (
        <>
          {variant === "c" && <><Sparkline /><ScheduleBar /></>}
          <Ladder foldEarlier />
          <p className="text-xs leading-5 text-slate-600 dark:text-slate-300"><Fig>{money(TOTAL)}</Fig> in total, finishing {END_LABEL}.</p>
        </>
      )}
    </section>
  );
}

// ── Editor ───────────────────────────────────────────────────────────────────

function Field({ id, label, value, hint }: { id: string; label: string; value: string; hint?: string }) {
  return (
    <label htmlFor={id} className="block min-w-0 text-sm font-medium text-slate-900 dark:text-slate-100">{label}
      <input id={id} defaultValue={value} inputMode="decimal" autoComplete="off" className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono text-base tabular-nums text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
      {hint && <span className="mt-1 block text-xs font-normal text-slate-500 dark:text-slate-400">{hint}</span>}
    </label>
  );
}

function ScheduleEditor({ variant, onCancel }: { variant: Variant; onCancel: () => void }) {
  const [unit, setUnit] = useState<"day" | "week" | "pay period">("day");
  return (
    <form aria-label="Edit the schedule" onSubmit={e => e.preventDefault()} className="space-y-4">
      <p className={LABEL}>Edit schedule</p>
      <div className="grid grid-cols-2 gap-3 max-[359px]:grid-cols-1">
        <Field id="sched-start" label="Starts at (£)" value="0.04" />
        <Field id="sched-step" label="Rises by (£)" value="0.04" />
      </div>
      <fieldset>
        <legend className="text-sm font-medium text-slate-900 dark:text-slate-100">Rises every</legend>
        <div className="mt-1 grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
          {(["day", "week", "pay period"] as const).map(u => (
            <button key={u} type="button" aria-pressed={unit === u} onClick={() => setUnit(u)}
              className={`min-h-11 rounded-lg text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${unit === u ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100" : "text-slate-600 dark:text-slate-300"}`}>{u === "pay period" ? "Pay period" : u[0].toUpperCase() + u.slice(1)}</button>
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-3 max-[359px]:grid-cols-1">
        <Field id="sched-len" label={`Runs for (${unit === "pay period" ? "pay periods" : `${unit}s`})`} value="365" />
        <Field id="sched-from" label="Starts on" value="1 Jan 2026" />
      </div>
      {variant === "b" ? (
        <p className="border-y border-slate-200 py-3 text-[14px] font-semibold leading-snug text-slate-900 dark:border-slate-700 dark:text-slate-100">Save 4p on day one, then 4p more each {unit}, for 365 {unit === "pay period" ? "pay periods" : `${unit}s`}.<span className="mt-1 block text-xs font-normal text-slate-600 dark:text-slate-300"><Fig>{money(TOTAL)}</Fig> in total. This pay period <Fig>{money(THIS_PERIOD.amount)}</Fig>.</span></p>
      ) : (
        <>
          {variant === "c" && <Sparkline />}
          <ConfirmRows />
        </>
      )}
      <p className="text-xs leading-5 text-slate-600 dark:text-slate-300">The figures above are for the schedule as it stands. Saving a different one ends any change you chose for this pay period and re-works what each period asks. {NOTHING_MOVES}</p>
      <div className="flex items-center gap-2">
        <button type="submit" className="min-h-[44px] flex-1 rounded-xl bg-indigo-600 text-sm font-semibold text-white active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">Save changes</button>
        <button type="button" onClick={onCancel} className="min-h-[44px] rounded-xl px-4 text-sm font-semibold text-slate-500 active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-400">Cancel</button>
      </div>
    </form>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

const todaysCard: ProposalMsg = {
  id: 1, role: "assistant", kind: "proposal", status: "pending",
  proposal: {
    proposal_id: "preview", kind: "create_commitment",
    summary: `Start the '${NAME}' goal: ${SENTENCE}, from ${SOURCE.name} into ${POT.name}, total ${money(TOTAL)}`,
    consequence: `Creates the goal and reserves this period's ${money(THIS_PERIOD.amount)}. ${NOTHING_MOVES}`,
    params: {}, before: "No goal", after: `Total ${money(TOTAL)}, from ${SOURCE.name}`,
  },
};

export default function GoalSchedulesClient() {
  const params = useSearchParams();
  const variant: Variant = params.get("variant") === "b" ? "b" : params.get("variant") === "c" ? "c" : "a";
  const raw = params.get("state");
  const initial: State = raw === "plan" || raw === "edit" ? raw : "confirm";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";
  const convert = params.get("convert") === "1";
  const [state, setState] = useState<State>(initial);
  useEffect(() => { setState(initial); }, [initial]);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", mode === "dark");
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", mode === "dark" ? "dark" : "only light");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", mode === "dark" ? "#0f172a" : "#f0f2f7");
  }, [mode]);
  const href = (v: Variant, s: State, m: Mode, c = convert) => `?variant=${v}&state=${s}&mode=${m}${c ? "&convert=1" : ""}`;

  return (
    <div className={mode === "dark" ? "dark" : ""} style={{ colorScheme: mode }}>
      <main className="min-h-dvh bg-[#f0f2f7] text-slate-900 dark:bg-[#0f172a] dark:text-slate-100">
        <div className="mx-auto w-full max-w-[430px] px-4 pb-44 pt-7">
          <header>
            <h1 className="text-balance text-xl font-bold tracking-[-0.02em] text-slate-950 dark:text-white">Goals with a contribution schedule</h1>
            <p className="mt-2 text-pretty text-sm leading-6 text-slate-600 dark:text-slate-300">
              Kevin&apos;s 4p challenge: 4p on day one, rising by 4p a day for 365 days. The server works out every pay period&apos;s amount; Penny only phrases it. Variant {variant.toUpperCase()}, state {state}. Fixtures only: nothing is saved and the editor&apos;s figures do not recalculate.
            </p>
          </header>

          {state === "confirm" && (
            <section aria-label="Penny thread" className="mt-6 space-y-3">
              <PennyLead>I have worked out the schedule. {NAME}: {SENTENCE}. It comes to <Fig>{money(TOTAL)}</Fig> in total, on your current pay periods. Check where it leaves from, then confirm if it looks right.</PennyLead>
              <ConfirmCard variant={variant} convert={convert} />
              <details className="rounded-2xl border border-slate-200 p-3 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300">
                <summary className="min-h-11 cursor-pointer py-3 font-semibold">Today&apos;s card for the same proposal, for comparison</summary>
                <div className="pointer-events-none mt-2" aria-hidden="true"><ProposalConfirmCard msg={todaysCard} onConfirm={() => undefined} onCancel={() => undefined} onOpenDone={() => undefined} /></div>
              </details>
            </section>
          )}

          {state !== "confirm" && (
            <section aria-label="View plan" className="mt-6 space-y-5 rounded-3xl bg-white p-4 shadow-sm dark:bg-slate-900 dark:shadow-none dark:ring-1 dark:ring-slate-700">
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">{NAME}</h2>
              {state === "plan" ? (
                <>
                  <PlanSchedule variant={variant} onEdit={() => setState("edit")} />
                  <PlanRecordView
                    kind="goal"
                    contribution={THIS_PERIOD.amount}
                    cadence="this pay period, set by your schedule"
                    target={{ amount: TOTAL, month: "December 2026" }}
                    progress={SAVED}
                    sourceAccount={SOURCE_ACCOUNT}
                    destinationAccounts={[POT_ACCOUNT]}
                    trackingLabel="Not tracking a payment"
                  />
                </>
              ) : (
                <>
                  <ScheduleEditor variant={variant} onCancel={() => setState("plan")} />
                  <div className="border-t border-slate-200 pt-3 text-[13px] leading-5 text-slate-600 dark:border-slate-700 dark:text-slate-300">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">Leaves from {SOURCE.name}</span> into {POT.name}
                    <button type="button" className={`${QUIET} ml-1`}>Change</button>
                  </div>
                </>
              )}
            </section>
          )}
        </div>
      </main>
      <div className="pointer-events-none fixed inset-x-0 z-[70] flex justify-center px-3" style={{ bottom: "calc(env(safe-area-inset-bottom) + 12px)" }}>
        <nav aria-label="Design preview controls" className="pointer-events-auto max-w-[calc(100vw-24px)] rounded-2xl border border-white/15 bg-slate-950/95 p-1.5 shadow-xl">
          <div className="flex flex-wrap items-center justify-center gap-0.5">
            {VARIANTS.map(v => <a key={v.key} href={href(v.key, state, mode)} aria-current={v.key === variant ? "page" : undefined} className={chip(v.key === variant)}>{v.label}</a>)}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center justify-center gap-0.5">
            {STATES.map(s => <a key={s.key} href={href(variant, s.key, mode)} aria-current={s.key === state ? "page" : undefined} className={chip(s.key === state)}>{s.label}</a>)}
            <span className="mx-0.5 h-6 w-px bg-white/15" aria-hidden="true" />
            <a href={href(variant, state, mode, !convert)} className={chip(convert)}>Convert</a>
            <a href={href(variant, state, mode === "dark" ? "light" : "dark")} className={chip(false)}>{mode === "dark" ? "Light" : "Dark"}</a>
          </div>
        </nav>
      </div>
    </div>
  );
}
