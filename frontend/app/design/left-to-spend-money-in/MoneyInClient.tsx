"use client";

// G480 design round (impeccable). Left to spend when money is still to come
// in. Hand-authored markup over fixtures: no production component exists for
// the "waiting on money in" state yet, so nothing here imports one and nothing
// calls an API. The preview is deleted once Kevin's pick is folded in.
import Link from "next/link";
import { useEffect, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { AlertCircle, AlertTriangle, ArrowRight, Check, ChevronRight, CircleDashed, ReceiptText, ShieldCheck } from "@/lib/phosphorIcons";
import { SCENARIOS, derive, r2, type Account, type Derived, type Row, type Scenario, type ScenarioId } from "./fixtures";

type Variant = "a" | "b" | "c";
type Tone = "risk" | "watch" | "good";

const VARIANTS: { key: Variant; name: string }[] = [
  { key: "a", name: "£0 and waiting" },
  { key: "b", name: "Signed reality" },
  { key: "c", name: "Two numbers" },
];

/* ---------- money ---------- */

function fmt(v: number, d = 0) {
  const abs = Math.abs(v);
  const body = d
    ? abs.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : Math.round(abs).toLocaleString("en-GB");
  const zero = d ? abs < 0.005 : Math.round(abs) === 0;
  return `${v < 0 && !zero ? "−" : ""}£${body}`;
}
function M({ v, d = 0, plus = false }: { v: number; d?: 0 | 2; plus?: boolean }) {
  return <span className="money whitespace-nowrap">{plus && v > 0 ? "+" : ""}{fmt(v, d)}</span>;
}
const M2 = ({ v, plus }: { v: number; plus?: boolean }) => <M v={v} d={2} plus={plus} />;

/* ---------- shared primitives ---------- */

const TONE_TEXT: Record<Tone, string> = {
  risk: "text-rose-700 dark:text-rose-300",
  watch: "text-amber-800 dark:text-amber-200",
  good: "text-emerald-800 dark:text-emerald-300",
};

function Badge({ tone, label }: { tone: Tone; label: string }) {
  const Icon = tone === "risk" ? AlertTriangle : tone === "watch" ? AlertCircle : ShieldCheck;
  return (
    <span data-tone={tone} className={`inline-flex min-h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold leading-[1.3] dark:bg-slate-700 ${TONE_TEXT[tone]}`}>
      <Icon size={13} className="shrink-0" aria-hidden="true" />{label}
    </span>
  );
}

function Dot({ tone }: { tone: Tone }) {
  const c = tone === "risk" ? "bg-rose-500" : tone === "watch" ? "bg-amber-500" : "bg-emerald-500";
  return <span aria-hidden="true" className={`inline-block size-2 shrink-0 rounded-full ${c}`} />;
}

function Label({ children }: { children: ReactNode }) {
  return <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400">{children}</p>;
}

function SectionTitle({ children, id }: { children: ReactNode; id?: string }) {
  return <h2 id={id} className="mb-2 mt-7 px-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400">{children}</h2>;
}

function BankMark({ a, size = 32 }: { a: Account; size?: number }) {
  return (
    <span aria-hidden="true" style={{ width: size, height: size, background: a.colour }} className="inline-flex shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white">
      {a.initials}
    </span>
  );
}

function Hero({ badge, children }: { badge: { tone: Tone; label: string }; children: ReactNode }) {
  return (
    <section aria-labelledby="lts-label" className="sts-card relative rounded-2xl p-5 glass-hero">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p id="lts-label" className="text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400">Left to spend</p>
        <Badge {...badge} />
      </div>
      {children}
    </section>
  );
}

const FIGURE = "money block text-[30px] font-bold leading-[1.2] tracking-[-0.025em] text-slate-900 dark:text-slate-100";
const PROSE = "text-wrap text-[13px] leading-5 text-slate-600 dark:text-slate-300";

function SpendFrom({ s, d, none }: { s: Scenario; d: Derived; none?: ReactNode }) {
  if (none) {
    return (
      <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-700">
        <Label>Spend from</Label>
        <p className="mt-2 text-[13px] leading-5 text-slate-600 dark:text-slate-300">{none}</p>
      </div>
    );
  }
  const shown = d.accountLeft
    .map((x) => {
      if (d.status === "move" && d.move) {
        if (x.account.id === d.move.to.id) return null;
        if (x.account.id === d.move.from.id) return { a: x.account, v: r2(x.account.balance - d.move.amount) };
      }
      return x.left > 0 ? { a: x.account, v: x.left } : null;
    })
    .filter((x): x is { a: Account; v: number } => x !== null);
  void s;
  return (
    <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-700">
      <Label>Spend from</Label>
      <ul className="mt-2 flex flex-col gap-2">
        {shown.map(({ a, v }) => (
          <li key={a.id} className="flex items-center gap-3">
            <BankMark a={a} size={28} />
            <span className="min-w-0 flex-1 text-[13px] font-semibold text-slate-800 dark:text-slate-100">{a.bank}</span>
            <span className="text-[14px] font-bold text-slate-900 dark:text-slate-100"><M2 v={v} /></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ActionLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-indigo-50 px-3 text-sm font-semibold text-indigo-700 transition-transform active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:bg-indigo-400/10 dark:text-indigo-300">
      {children}<ArrowRight size={15} aria-hidden="true" />
    </a>
  );
}

/* ---------- sentence helpers ---------- */

function dueText(d: Derived) {
  const r = d.reliesOn!.row;
  return <><strong className="font-semibold text-slate-800 dark:text-slate-100">{r.label}</strong> (<M2 v={-r.amount} />) is due {r.dayLabel}</>;
}
function waitingFor(d: Derived) {
  const rows = d.reliesOn!.waitingFor;
  const total = r2(rows.reduce((t, r) => t + r.amount, 0));
  return { total, day: rows[0]?.dayLabel ?? "", date: rows[0]?.date ?? "", n: rows.length };
}

/** When the bill falls after the money is due, say why it still relies on it. */
function relianceWhy(d: Derived) {
  if (!d.reliesOn) return null;
  const w = waitingFor(d);
  const r = d.reliesOn.row;
  if (w.date === r.date) return null;
  return (
    <p className="mt-2 text-[12px] leading-[1.45] text-slate-600 dark:text-slate-300">
      Bills before {r.dayLabel} use up what is in the account now, so the <M2 v={-r.amount} /> {r.label.toLowerCase()} on {r.dayLabel} relies on about <M2 v={w.total} /> expected {w.day}.
    </p>
  );
}

/** Hero body shared by every variant for the states that are not in question. */
function plainHero(s: Scenario, d: Derived, badgeLabel?: string) {
  if (d.status === "short") {
    const f = d.failing!;
    const late = d.moneyIn.filter((r) => r.date > f.row.date);
    const lateTotal = r2(late.reduce((t, r) => t + r.amount, 0));
    return {
      badge: { tone: "risk" as Tone, label: "Short" },
      figure: <>{fmt(d.left)}</>,
      line: <><strong className="font-semibold text-slate-800 dark:text-slate-100">{f.row.label}</strong> (<M2 v={-f.row.amount} />) is due {f.row.dayLabel} and {f.account.bank} holds <M2 v={f.account.balance} />. The <M2 v={lateTotal} /> expected {late[0]?.dayLabel} arrives too late.</>,
      spend: <p className="mt-4 text-[13px] leading-5 text-slate-600 dark:text-slate-300">No account can cover it without help. Nothing is safe to spend.</p>,
      action: <ActionLink href="#cover-plan">See the cover plan</ActionLink>,
    };
  }
  if (d.status === "move") {
    const mv = d.move!;
    return {
      badge: { tone: "watch" as Tone, label: "Tight" },
      figure: <>{fmt(d.left)}</>,
      line: <>A move of about <M2 v={mv.amount} /> from {mv.from.bank} would cover {d.failing!.row.label} on {d.failing!.row.dayLabel}. About <M v={d.perDay ?? 0} /> a day after that, until {s.periodEndLabel}.</>,
      spend: <SpendFrom s={s} d={d} />,
      action: <ActionLink href="#cover-plan">See the cover plan</ActionLink>,
    };
  }
  const note = d.moneyIn.length > 0
    ? <p className="mt-2 flex items-start gap-2 text-[12px] leading-[1.45] text-slate-600 dark:text-slate-300"><CircleDashed size={14} className="mt-px shrink-0" aria-hidden="true" /><span>{d.moneyIn.map((r) => r.label).join(" and ")} (<M2 v={d.moneyInTotal} plus />) is expected {d.moneyIn[0].dayLabel}. It is not counted until it lands.</span></p>
    : null;
  return {
    badge: { tone: "good" as Tone, label: badgeLabel ?? "Looks on track" },
    figure: <>{fmt(d.left)}</>,
    line: <>About <M v={d.perDay ?? 0} /> a day until {s.periodEndLabel}, after upcoming payments.</>,
    spend: <SpendFrom s={s} d={d} />,
    action: null,
    note,
  };
}

/* ---------- hero variants ---------- */

function HeroA({ s, d }: { s: Scenario; d: Derived }) {
  if (d.status !== "waiting") {
    const h = plainHero(s, d);
    return (
      <Hero badge={h.badge}>
        <h3 className={`${FIGURE} mt-5`}>{h.figure}</h3>
        <p className={`${PROSE} mt-3`}>{h.line}</p>
        {"note" in h ? h.note : null}
        {h.spend}{h.action}
      </Hero>
    );
  }
  const w = waitingFor(d);
  return (
    <Hero badge={{ tone: "watch", label: "Waiting on money in" }}>
      <h3 className={`${FIGURE} mt-5`}>{fmt(0)}</h3>
      <p className={`${PROSE} mt-3`}>Nothing to spend until <M2 v={w.total} /> lands, expected {w.day}. {dueText(d)}.</p>
      {relianceWhy(d)}
      <p className="mt-2 text-[12px] leading-[1.45] text-slate-600 dark:text-slate-300">Money in only counts once it is in your account.</p>
      <SpendFrom s={s} d={d} none="Nothing yet. This fills in when the money lands." />
    </Hero>
  );
}

function HeroB({ s, d }: { s: Scenario; d: Derived }) {
  if (d.status !== "waiting") {
    const h = plainHero(s, d);
    return (
      <Hero badge={h.badge}>
        <h3 className={`${FIGURE} mt-5`}>{h.figure}</h3>
        <p className={`${PROSE} mt-3`}>{h.line}</p>
        {"note" in h ? h.note : null}
        {h.spend}{h.action}
      </Hero>
    );
  }
  const w = waitingFor(d);
  const same = w.date === d.reliesOn!.row.date;
  return (
    <Hero badge={{ tone: "watch", label: "Relies on money in" }}>
      <h3 className={`${FIGURE} mt-5`}>{fmt(d.raw)}</h3>
      <p className={`${PROSE} mt-3`}>
        You are <M2 v={-d.raw} /> below zero until <M2 v={w.total} /> lands, expected {w.day}, {same ? <>the same day {d.reliesOn!.row.label} is due</> : <>before {d.reliesOn!.row.label} is due</>}. Do not spend from this until it does.
      </p>
      {relianceWhy(d)}
      <SpendFrom s={s} d={d} none="Nothing until the money lands." />
    </Hero>
  );
}

function HeroC({ s, d }: { s: Scenario; d: Derived }) {
  const twoUp = d.moneyIn.length > 0 && (d.status === "waiting" || d.status === "short" || d.status === "move");
  if (!twoUp) {
    const h = plainHero(s, d);
    return (
      <Hero badge={h.badge}>
        <h3 className={`${FIGURE} mt-5`}>{h.figure}</h3>
        <p className={`${PROSE} mt-3`}>{h.line}</p>
        {"note" in h ? h.note : null}
        {h.spend}{h.action}
      </Hero>
    );
  }
  const h = plainHero(s, d);
  const w = d.status === "waiting" ? waitingFor(d) : null;
  const badge = d.status === "waiting" ? { tone: "watch" as Tone, label: "Tight until money lands" } : h.badge;
  const nowFigure = d.status === "waiting" ? 0 : d.left;
  const landDay = d.moneyIn[0].dayLabel;
  return (
    <Hero badge={badge}>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="min-w-0 rounded-xl glass-tile p-3">
          <Label>Spend now</Label>
          <p className="money mt-1.5 text-[26px] font-bold leading-[1.15] tracking-[-0.025em] text-slate-900 dark:text-slate-100">{fmt(nowFigure)}</p>
          <p className="mt-1 text-[12px] leading-4 text-slate-600 dark:text-slate-300">In your account today</p>
        </div>
        <div className="min-w-0 rounded-xl border border-dashed border-slate-400 p-3 dark:border-slate-500">
          <Label>After it lands</Label>
          <p className="money mt-1.5 text-[26px] font-bold leading-[1.15] tracking-[-0.025em] text-slate-700 dark:text-slate-200"><span aria-hidden="true">~</span>{fmt(d.afterIn)}</p>
          <p className="mt-1 text-[12px] leading-4 text-slate-600 dark:text-slate-300">Expected {landDay}</p>
        </div>
      </div>
      <p className={`${PROSE} mt-3`}>
        {d.status === "waiting" && w
          ? <>{dueText(d)}. Only the left figure counts today. The right one needs <M2 v={w.total} /> to land first.</>
          : h.line}
      </p>
      {d.status === "waiting" && <SpendFrom s={s} d={d} none="Nothing yet. This fills in when the money lands." />}
      {d.status !== "waiting" && h.spend}
      {d.status !== "waiting" && h.action}
    </Hero>
  );
}

/* ---------- breakdown (How we got this) ---------- */

function Disclosure({ title, figure, children }: { title: string; figure: ReactNode; children: ReactNode }) {
  return (
    <details open className="group mt-3 rounded-2xl glass-card">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 py-2 text-[14px] font-semibold text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-100 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">{title}</span>
        <span className="flex shrink-0 items-center gap-1.5 text-[14px]">{figure}<ChevronRight size={16} className="text-slate-400 transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden="true" /></span>
      </summary>
      <div className="border-t border-slate-200 px-4 pb-4 pt-3 dark:border-slate-700">{children}</div>
    </details>
  );
}

function Line({ label, value, strong, sub }: { label: ReactNode; value: ReactNode; strong?: boolean; sub?: ReactNode }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-1.5 ${strong ? "border-t border-slate-200 pt-2.5 dark:border-slate-700" : ""}`}>
      <div className="min-w-0">
        <p className={`text-[13px] leading-5 ${strong ? "font-semibold text-slate-900 dark:text-slate-100" : "text-slate-600 dark:text-slate-300"}`}>{label}</p>
        {sub && <p className="text-[12px] leading-4 text-slate-500 dark:text-slate-400">{sub}</p>}
      </div>
      <p className={`shrink-0 text-[13px] ${strong ? "font-bold text-slate-900 dark:text-slate-100" : "text-slate-800 dark:text-slate-100"}`}>{value}</p>
    </div>
  );
}

function ExpectedList({ d }: { d: Derived }) {
  if (d.moneyIn.length === 0) return null;
  return (
    <div className="mt-3 rounded-xl border border-dashed border-slate-300 p-3 dark:border-slate-600">
      <Label>Expected, not counted</Label>
      <ul className="mt-1.5">
        {d.moneyIn.map((r) => (
          <li key={r.id} className="flex items-baseline justify-between gap-3 py-1 text-[13px] text-slate-700 dark:text-slate-200">
            <span className="min-w-0">{r.label}<span className="text-slate-500 dark:text-slate-400"> · {r.dayLabel}</span></span>
            <span className="shrink-0"><M2 v={r.amount} plus /></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function paymentsLabel(s: Scenario) { return `Payments due before ${s.periodEndLabel}`; }

function BreakdownA({ s, d }: { s: Scenario; d: Derived }) {
  const waiting = d.status === "waiting";
  const final = waiting ? 0 : d.left;
  return (
    <Disclosure title="How we got this" figure={<span className="font-bold"><M v={final} /></span>}>
      <Line label="In your accounts now" value={<M2 v={d.now} />} />
      <Line label={paymentsLabel(s)} value={<M2 v={-d.payments} />} />
      {d.status === "move" && d.move && <Line label={`Set aside in ${d.move.from.bank} for ${d.failing!.account.bank}`} value={<span className="text-slate-500 dark:text-slate-400">inside the total</span>} />}
      <Line strong label="Left to spend" value={<M2 v={final} />} sub={waiting ? <>Your real position is <M2 v={d.raw} />. Shown as £0 until money in lands.</> : undefined} />
      <ExpectedList d={d} />
    </Disclosure>
  );
}

/** Day-by-day walk of the account the story is about, expected money flagged. */
function walkSteps(s: Scenario, d: Derived) {
  const reliesAcc = d.reliesOn ? s.accounts.find((a) => a.id === d.reliesOn!.row.account) : undefined;
  const acc = d.failing?.account ?? reliesAcc ?? s.accounts[0];
  const rows = s.rows.filter((r) => r.account === acc.id && !r.nextPeriod && !(r.kind === "in" && r.landed));
  const ordered = [...rows].sort((x, y) => (x.date === y.date ? (x.kind === y.kind ? 0 : x.kind === "in" ? -1 : 1) : x.date < y.date ? -1 : 1));
  let bal = acc.balance;
  const steps = ordered.map((r) => { bal = r2(bal + r.amount); return { r, bal }; });
  return { acc, steps };
}

function BreakdownB({ s, d }: { s: Scenario; d: Derived }) {
  const { acc, steps } = walkSteps(s, d);
  const lastBal = steps.length ? steps[steps.length - 1].bal : acc.balance;
  return (
    <Disclosure title="How we got this" figure={<span className="font-bold"><M v={d.status === "waiting" || d.status === "short" ? d.raw : d.left} /></span>}>
      <p className="text-[12px] leading-4 text-slate-500 dark:text-slate-400">{acc.bank}, day by day. Dashed rows are expected, not in the account yet.</p>
      <ol className="mt-3">
        <li className="flex items-baseline justify-between gap-3 py-1.5 text-[13px]">
          <span className="text-slate-700 dark:text-slate-200">In {acc.bank} now</span>
          <span className="shrink-0 font-semibold text-slate-900 dark:text-slate-100"><M2 v={acc.balance} /></span>
        </li>
        {steps.map(({ r, bal }) => {
          const expected = r.kind === "in";
          const neg = bal < 0;
          return (
            <li key={r.id} className="relative flex items-start gap-3 border-l-2 border-dashed border-slate-300 py-1.5 pl-3 text-[13px] dark:border-slate-600" style={{ marginLeft: 4 }}>
              <div className="min-w-0 flex-1">
                <p className="text-slate-700 dark:text-slate-200">{r.dayLabel}: {r.label}</p>
                <p className="text-[12px] leading-4 text-slate-500 dark:text-slate-400">{expected ? "Expected, if it lands" : "Due"}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className={expected ? "text-slate-600 dark:text-slate-300" : "text-slate-800 dark:text-slate-100"}><M2 v={r.amount} plus /></p>
                <p className="flex items-center justify-end gap-1.5 text-[12px] leading-4 text-slate-500 dark:text-slate-400">{neg && <Dot tone="risk" />}<span className="sr-only">Balance after: </span><M2 v={bal} /></p>
              </div>
            </li>
          );
        })}
      </ol>
      <Line strong label={`${acc.bank} on ${s.periodEndLabel}`} value={<M2 v={lastBal} />} sub={d.status === "waiting" ? "Only if the money lands first." : undefined} />
      {s.accounts.length > 1 && (
        <p className="mt-2 text-[12px] leading-4 text-slate-500 dark:text-slate-400">{s.accounts.filter((a) => a.id !== acc.id).map((a) => `${a.bank} holds ${fmt(a.balance, 2)}`).join(". ")}.</p>
      )}
    </Disclosure>
  );
}

function BreakdownC({ s, d }: { s: Scenario; d: Derived }) {
  const two = d.moneyIn.length > 0 && d.status !== "on-track";
  const nowLeft = d.status === "waiting" ? 0 : d.left;
  const cell = "text-right text-[13px] text-slate-800 dark:text-slate-100";
  return (
    <Disclosure title="How we got this" figure={<span className="font-bold"><M v={nowLeft} /></span>}>
      <div className={`grid items-baseline gap-x-3 gap-y-1.5 ${two ? "grid-cols-[minmax(0,1fr)_auto_auto]" : "grid-cols-[minmax(0,1fr)_auto]"}`}>
        <span />
        <Label>Now</Label>
        {two && <Label>If it lands</Label>}

        <span className="text-[13px] text-slate-600 dark:text-slate-300">In your accounts</span>
        <span className={cell}><M2 v={d.now} /></span>
        {two && <span className={cell}><M2 v={d.now} /></span>}

        <span className="text-[13px] text-slate-600 dark:text-slate-300">{paymentsLabel(s)}</span>
        <span className={cell}><M2 v={-d.payments} /></span>
        {two && <span className={cell}><M2 v={-d.payments} /></span>}

        {two && <>
          <span className="text-[13px] text-slate-600 dark:text-slate-300">Money in expected</span>
          <span className="text-right text-[13px] text-slate-500 dark:text-slate-400">not counted</span>
          <span className={cell}><M2 v={d.moneyInTotal} plus /></span>
        </>}

        <span className="border-t border-slate-200 pt-2 text-[13px] font-semibold text-slate-900 dark:border-slate-700 dark:text-slate-100">Left to spend</span>
        <span className="border-t border-slate-200 pt-2 text-right text-[13px] font-bold text-slate-900 dark:border-slate-700 dark:text-slate-100"><M2 v={d.status === "waiting" ? 0 : d.raw} /></span>
        {two && <span className="border-t border-slate-200 pt-2 text-right text-[13px] font-bold text-slate-700 dark:border-slate-700 dark:text-slate-200"><span aria-hidden="true">~</span><M2 v={d.afterIn} /></span>}
      </div>
      {d.status === "waiting" && <p className="mt-2 text-[12px] leading-4 text-slate-500 dark:text-slate-400">Your real position is <M2 v={d.raw} />, so today shows £0.</p>}
      {two && d.status !== "waiting" && <ExpectedList d={d} />}
    </Disclosure>
  );
}

/* ---------- cover plan ---------- */

function CoverPlan({ s, d }: { s: Scenario; d: Derived }) {
  if (d.status !== "short" && d.status !== "move") return null;
  const f = d.failing!;
  const need = r2(-f.balance);
  const late = d.moneyIn.filter((r) => r.date > f.row.date);
  const lateTotal = r2(late.reduce((t, r) => t + r.amount, 0));
  const isShort = d.status === "short";
  return (
    <section id="cover-plan" aria-labelledby="cover-title" className={`mt-3 scroll-mt-4 rounded-2xl border p-4 ${isShort ? "border-rose-200 bg-white dark:border-rose-900/60 dark:bg-[#1c2537]" : "border-slate-200 bg-white dark:border-slate-700 dark:bg-[#1c2537]"}`}>
      <div className="flex items-start gap-2.5">
        {isShort ? <AlertTriangle size={18} className="mt-0.5 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden="true" /> : <Dot tone="watch" />}
        <div className="min-w-0">
          <h3 id="cover-title" className="text-[15px] font-bold leading-5 text-slate-900 dark:text-slate-100">
            {isShort ? <>{f.account.bank} is <M2 v={need} /> short on {f.row.dayLabel}</> : <>A move would cover {f.account.bank}</>}
          </h3>
          <p className={`${PROSE} mt-1.5`}>
            {isShort
              ? <>{f.row.label} (<M2 v={-f.row.amount} />) is due before the <M2 v={lateTotal} /> expected {late[0]?.dayLabel}. No other account holds enough to cover it.</>
              : <>Move about <M2 v={need} /> from {d.move!.from.bank} to {f.account.bank} by {f.row.dayLabel} and {f.row.label} is covered. It is already set aside in {d.move!.from.bank}, so it is not counted as left to spend.</>}
          </p>
          <p className="mt-2 text-[13px] font-semibold leading-5 text-slate-800 dark:text-slate-100">
            {isShort ? <>Add about <M2 v={need} /> to {f.account.bank} by {f.row.dayLabel}, or ask {f.row.label} about a later date.</> : <>The move is yours to make. Nothing has been moved.</>}
          </p>
          <ul className="mt-3 flex flex-col gap-1.5 border-t border-slate-200 pt-3 dark:border-slate-700">
            {s.accounts.map((a) => (
              <li key={a.id} className="flex items-center gap-2.5 text-[13px] text-slate-700 dark:text-slate-200">
                <BankMark a={a} size={22} />
                <span className="min-w-0 flex-1">{a.bank}</span>
                <span className="text-slate-600 dark:text-slate-300"><M2 v={a.balance} /></span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/* ---------- Upcoming ---------- */

function accountReading(v: Variant, s: Scenario, d: Derived, a: Account) {
  const x = d.accountLeft.find((q) => q.account.id === a.id)!;
  const w = d.status === "waiting" && d.reliesOn ? waitingFor(d) : null;
  if (x.note === "waiting" && w) {
    if (v === "a") return { fig: fmt(0), cap: "Waiting on money in", tone: "watch" as Tone, note: <>{dueText(d)}. Expected money is not counted until it lands.</> };
    if (v === "b") return { fig: fmt(x.left), cap: "Relies on money in", tone: "watch" as Tone, note: <>Covered if the <M2 v={w.total} /> expected {w.day} lands first.</> };
    return { fig: fmt(0), cap: "Tight until money lands", tone: "watch" as Tone, note: <>About <M v={d.afterIn} /> once the <M2 v={w.total} /> expected {w.day} lands.</> };
  }
  if (x.note === "short") return { fig: fmt(x.left), cap: "Short for payments", tone: "risk" as Tone, note: <>{d.failing!.row.label} is due {d.failing!.row.dayLabel}, before the money expected {d.moneyIn[0]?.dayLabel}.</> };
  if (x.note === "move") return { fig: fmt(0), cap: "A move would cover it", tone: "watch" as Tone, note: <>Move about <M2 v={d.move!.amount} /> from {d.move!.from.bank}. Nothing has been moved.</> };
  if (d.move && a.id === d.move.from.id) return { fig: fmt(a.balance - d.move.amount), cap: "After setting aside a move", tone: "good" as Tone, note: null };
  return { fig: fmt(x.left), cap: "Covers its payments", tone: "good" as Tone, note: null };
}

function ByAccount({ v, s, d }: { v: Variant; s: Scenario; d: Derived }) {
  return (
    <section aria-labelledby="by-account" className="rounded-2xl glass-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="by-account" className="text-[16px] font-bold text-slate-900 dark:text-slate-100">By account</h3>
        <p className="text-[12px] text-slate-500 dark:text-slate-400">{s.periodLabel}</p>
      </div>
      <ul className="mt-2">
        {s.accounts.map((a) => {
          const r = accountReading(v, s, d, a);
          return (
            <li key={a.id} className="border-t border-slate-200 py-3 first:border-t-0 dark:border-slate-700">
              <div className="grid min-h-11 grid-cols-[32px_minmax(64px,1fr)_minmax(0,auto)] items-center gap-3">
                <BankMark a={a} />
                <div className="min-w-0"><p className="break-words text-[14px] font-semibold text-slate-900 dark:text-slate-100">{a.bank}</p><p className="break-words text-[12px] text-slate-500 dark:text-slate-400">{a.name}</p></div>
                <div className="text-right">
                  <p className="text-[15px] font-bold text-slate-900 dark:text-slate-100"><span className="money">{r.fig}</span></p>
                  <p className="flex items-start justify-end gap-1.5 text-[12px] leading-4 text-slate-600 dark:text-slate-300"><span className="mt-1"><Dot tone={r.tone} /></span><span>{r.cap}</span></p>
                </div>
              </div>
              {r.note && <p className="mt-2 pl-[44px] text-[12px] leading-[1.45] text-slate-600 dark:text-slate-300">{r.note}</p>}
            </li>
          );
        })}
      </ul>
      {d.move && <p className="mt-1 border-t border-slate-200 pt-3 text-[12px] text-slate-500 dark:border-slate-700 dark:text-slate-400">Suggested moves are for you to make. Nothing has been moved.</p>}
    </section>
  );
}

function reliance(v: Variant, d: Derived, row: Row): { tone: Tone; text: string } | null {
  if (row.kind !== "bill") return null;
  if (d.status === "short" && d.failing?.row.id === row.id) return { tone: "risk", text: `Short on ${d.failing.account.bank}` };
  if (d.status === "move" && d.failing?.row.id === row.id) return { tone: "watch", text: "A move would cover it" };
  if (d.status === "waiting" && d.reliesOn?.row.id === row.id) {
    return { tone: "watch", text: v === "a" ? "Waiting on money in" : v === "b" ? "Covered if money lands" : "Tight until money lands" };
  }
  return null;
}

function DayList({ v, s, d }: { v: Variant; s: Scenario; d: Derived }) {
  const sorted = [...s.rows].sort((x, y) => (x.date === y.date ? (x.kind === y.kind ? 0 : x.kind === "in" ? -1 : 1) : x.date < y.date ? -1 : 1));
  const groups: { key: string; label: string; next: boolean; rows: Row[] }[] = [];
  for (const r of sorted) {
    const g = groups[groups.length - 1];
    if (g && g.key === r.date) g.rows.push(r);
    else groups.push({ key: r.date, label: r.dayLabel, next: !!r.nextPeriod, rows: [r] });
  }
  return (
    <section aria-label="Upcoming list" className="mt-3 rounded-2xl glass-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[16px] font-bold text-slate-900 dark:text-slate-100">Coming up</h3>
        <p className="text-[12px] text-slate-500 dark:text-slate-400">to {s.periodEndLabel}</p>
      </div>
      {groups.map((g) => (
        <div key={g.key} className={`mt-3 ${g.key === s.focusDate ? "" : ""}`}>
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400">
            {g.label}{g.key === s.focusDate && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] normal-case tracking-normal text-slate-700 dark:bg-slate-700 dark:text-slate-200">The day in question</span>}
            {g.next && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] normal-case tracking-normal text-slate-700 dark:bg-slate-700 dark:text-slate-200">Next pay period</span>}
          </p>
          <ul className="mt-1">
            {g.rows.map((r) => <UpcomingRow key={r.id} v={v} d={d} r={r} />)}
          </ul>
        </div>
      ))}
    </section>
  );
}

function UpcomingRow({ v, d, r }: { v: Variant; d: Derived; r: Row }) {
  const income = r.kind === "in";
  const landed = income && r.landed;
  const next = !!r.nextPeriod;
  const q = reliance(v, d, r);
  const caption = income
    ? landed ? "Landed, now counted" : next ? "Expected, counts next period" : "Expected, counts once it lands"
    : "Due";
  return (
    <li className="flex items-start gap-3 border-t border-slate-100 py-2.5 first:border-t-0 dark:border-slate-700/70">
      <span aria-hidden="true" className={`mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-xl ${landed ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : income ? "border border-dashed border-slate-400 text-slate-600 dark:border-slate-500 dark:text-slate-300" : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-200"}`}>
        {landed ? <Check size={17} /> : income ? <CircleDashed size={17} /> : <ReceiptText size={17} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold leading-5 text-slate-900 dark:text-slate-100">{r.label}</p>
        <p className="text-[12px] leading-4 text-slate-500 dark:text-slate-400">{caption}</p>
        {q && <p className={`mt-1 inline-flex items-center gap-1.5 text-[12px] font-medium ${TONE_TEXT[q.tone]}`}><Dot tone={q.tone} />{q.text}</p>}
      </div>
      <p className={`shrink-0 pt-0.5 text-right text-[14px] font-semibold ${landed ? "text-emerald-700 dark:text-emerald-300" : income ? "text-slate-600 dark:text-slate-300" : "text-slate-900 dark:text-slate-100"}`}>
        <M2 v={r.amount} plus />
      </p>
    </li>
  );
}

/* ---------- decisions panel ---------- */

const DECISIONS: Record<Variant, { name: string; points: [string, string][] }> = {
  a: {
    name: "A · £0 and waiting",
    points: [
      ["Hero figure", "Floors at £0. The signed figure lives only in the breakdown."],
      ["Name", "Waiting on money in (amber badge, no amber figure)."],
      ["Reliance", "One sentence under the figure names the money and the bill. The bill row and By account row carry the same words."],
      ["Consistency", "Hero, breakdown, By account and the bill row all say £0 and “Waiting on money in”. Short stays the only red state."],
    ],
  },
  b: {
    name: "B · Signed reality",
    points: [
      ["Hero figure", "Shows the real position, −£73, in ink, exactly as Short does today."],
      ["Name", "Relies on money in. Same signed figure as Short, told apart by the amber badge and the sentence."],
      ["Reliance", "The breakdown becomes a day-by-day walk of the account, expected rows dashed, so the user sees the bill clear only after the money."],
      ["Consistency", "The signed figure matches the By account row. Cost: a minus figure with no red can read as a contradiction."],
    ],
  },
  c: {
    name: "C · Two numbers",
    points: [
      ["Hero figure", "Spend now (solid) beside After it lands (dashed, with a ~). Only the left one is ever spendable."],
      ["Name", "Tight until money lands."],
      ["Reliance", "The two tiles are the explanation: the gap between them is the money in. Short also shows both, so a late credit reads as late."],
      ["Consistency", "The breakdown becomes a Now and If it lands table. By account carries the same pair in words."],
    ],
  },
};

function Decisions({ v }: { v: Variant }) {
  const x = DECISIONS[v];
  return (
    <section aria-labelledby="decisions" className="mt-8 rounded-2xl border border-slate-300 p-4 dark:border-slate-700">
      <h2 id="decisions" className="text-[14px] font-bold text-slate-900 dark:text-slate-100">What {x.name} decides</h2>
      <dl className="mt-2 flex flex-col gap-2.5">
        {x.points.map(([k, t]) => (
          <div key={k}>
            <dt className="text-[12px] font-semibold text-slate-700 dark:text-slate-200">{k}</dt>
            <dd className="text-[13px] leading-5 text-slate-600 dark:text-slate-300">{t}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-[12px] leading-4 text-slate-500 dark:text-slate-400">Rule for all three: money leaving counts at once. Money in counts only once it lands. Short only when a payment fails even counting money expected on or before its day.</p>
    </section>
  );
}

/* ---------- toolbar and page ---------- */

function Toolbar({ v, sid, dark }: { v: Variant; sid: ScenarioId; dark: boolean }) {
  const href = (nv: Variant, ns: ScenarioId, nd: boolean) => `?variant=${nv}&state=${ns}&mode=${nd ? "dark" : "light"}`;
  const chip = "inline-flex min-h-11 shrink-0 items-center rounded-xl px-3 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white";
  return (
    <nav aria-label="G480 design preview controls" className="border-b border-white/10 bg-slate-950 px-3 py-2 text-white">
      <div className="mx-auto flex max-w-[430px] flex-wrap items-center gap-1">
        {VARIANTS.map((x) => (
          <Link key={x.key} href={href(x.key, sid, dark)} aria-current={x.key === v ? "page" : undefined} className={`${chip} ${x.key === v ? "bg-white text-slate-950" : "text-slate-300 hover:bg-white/10"}`}>
            {x.key.toUpperCase()} · {x.name}
          </Link>
        ))}
        <div className="flex basis-full flex-wrap gap-1">
          {SCENARIOS.map((x) => (
            <Link key={x.id} href={href(v, x.id, dark)} aria-current={x.id === sid ? "page" : undefined} className={`${chip} ${x.id === sid ? "bg-slate-600 text-white" : "text-slate-300 hover:bg-white/10"}`}>{x.tab}</Link>
          ))}
          <Link href={href(v, sid, !dark)} className={`${chip} text-slate-300 hover:bg-white/10`}>{dark ? "Light" : "Dark"}</Link>
        </div>
      </div>
    </nav>
  );
}

export default function MoneyInClient() {
  const sp = useSearchParams();
  const rawV = sp.get("variant");
  const v: Variant = rawV === "b" || rawV === "c" ? rawV : "a";
  const sid = (SCENARIOS.find((x) => x.id === sp.get("state"))?.id ?? "waiting") as ScenarioId;
  const dark = sp.get("mode") === "dark";
  const s = SCENARIOS.find((x) => x.id === sid)!;
  const d = derive(s);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", dark ? "dark" : "light");
  }, [dark]);

  const Hero_ = v === "a" ? HeroA : v === "b" ? HeroB : HeroC;
  const Breakdown_ = v === "a" ? BreakdownA : v === "b" ? BreakdownB : BreakdownC;

  return (
    <div className={dark ? "dark" : ""} style={{ colorScheme: dark ? "dark" : "light" }}>
      <div className="min-h-dvh bg-[#f0f2f7] text-slate-900 dark:bg-[#0f172a] dark:text-slate-100">
        <Toolbar v={v} sid={sid} dark={dark} />
        <main className="mx-auto w-full max-w-[430px] px-4 pb-16 pt-5">
          <header className="px-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400">G480 · {s.todayLabel} · pay period {s.periodLabel}</p>
            <h1 className="mt-1 text-[20px] font-bold leading-[1.3] text-slate-900 dark:text-slate-100">{s.title}</h1>
            <p className="mt-1 text-[13px] leading-5 text-slate-600 dark:text-slate-300">{s.blurb}</p>
          </header>

          <SectionTitle>Home</SectionTitle>
          <Hero_ s={s} d={d} />
          <Breakdown_ s={s} d={d} />
          <CoverPlan s={s} d={d} />

          <SectionTitle>Upcoming</SectionTitle>
          <ByAccount v={v} s={s} d={d} />
          <DayList v={v} s={s} d={d} />

          <Decisions v={v} />
        </main>
      </div>
    </div>
  );
}
