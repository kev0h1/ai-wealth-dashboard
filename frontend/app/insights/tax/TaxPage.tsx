"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, CheckCircle2, AlertCircle, Info, Calendar, ChevronDown } from "lucide-react";
import { api } from "@/lib/api";
import Spinner from "@/components/Spinner";
import TaxPennyEntry from "@/components/TaxPennyEntry";
import MoneyText from "@/components/MoneyText";

const PA = 12_570;
const TAPER_START = 100_000;
const TAPER_END = 125_140;

function taperLoss(income: number): number {
  if (income <= TAPER_START) return 0;
  if (income >= TAPER_END) return PA;
  return Math.floor((income - TAPER_START) / 2);
}

function getTaxYear() {
  const now = new Date();
  const year = now.getFullYear();
  const apr6 = new Date(year, 3, 6);
  const start = now >= apr6 ? apr6 : new Date(year - 1, 3, 6);
  const end = new Date(start.getFullYear() + 1, 3, 5);
  const total = end.getTime() - start.getTime();
  const elapsed = now.getTime() - start.getTime();
  const progressPct = Math.min(100, Math.round((elapsed / total) * 100));
  const daysLeft = Math.ceil((end.getTime() - now.getTime()) / 86_400_000);
  const label = `${start.getFullYear()}/${String(end.getFullYear()).slice(2)}`;
  const monthsRemaining = Math.max(1, Math.round((end.getTime() - now.getTime()) / (30.44 * 86_400_000)));
  const nextYear = end.getFullYear();
  return { label, progressPct, daysLeft, monthsRemaining, nextYear };
}

function fmt(n: number) {
  return Math.round(n).toLocaleString("en-GB");
}

type DoneKey =
  | "self_assessment" | "tax_code" | "gift_aid"
  | "salary_sacrifice" | "carry_forward" | "eis_seis" | "isa";

function useDone() {
  const [done, setDone] = useState<Set<DoneKey>>(new Set());

  useEffect(() => {
    try {
      const saved = localStorage.getItem("tax_checklist_done");
      if (saved) setDone(new Set(JSON.parse(saved) as DoneKey[]));
    } catch {}
  }, []);

  function toggle(key: DoneKey) {
    setDone(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      try { localStorage.setItem("tax_checklist_done", JSON.stringify([...next])); } catch {}
      return next;
    });
  }

  return { done, toggle };
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 px-1 mt-2 mb-1">
      {children}
    </p>
  );
}

function ActionRow({
  status,
  title,
  detail,
  highlight,
  onToggle,
}: {
  status: "action" | "done" | "info";
  title: string;
  detail: string;
  highlight?: boolean;
  onToggle?: () => void;
}) {
  const inner = (
    <>
      <div className="flex-shrink-0 mt-0.5">
        {status === "done" ? (
          <CheckCircle2 size={18} className="text-emerald-500" />
        ) : status === "action" ? (
          <AlertCircle size={18} className="text-amber-500" />
        ) : (
          <Info size={18} className="text-slate-400" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-base font-bold leading-snug ${status === "done" ? "text-slate-500 dark:text-slate-400 line-through" : "text-slate-800 dark:text-slate-100"}`}>
          <MoneyText text={title} />
        </p>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 leading-relaxed"><MoneyText text={detail} /></p>
        {onToggle && (
          <p className="text-[11px] font-medium mt-2 text-slate-500 dark:text-slate-400">
            {status === "done" ? "Tap to unmark" : "Tap to mark done"}
          </p>
        )}
      </div>
    </>
  );

  const sharedClass = `bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-4 flex gap-3 ${highlight ? "ring-1 ring-amber-300 dark:ring-amber-600" : ""}`;

  if (onToggle) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className={`w-full text-left active:scale-[0.98] transition-transform ${sharedClass}`}
      >
        {inner}
      </button>
    );
  }

  return (
    <div className={sharedClass}>
      {inner}
    </div>
  );
}

function KeyDate({ date, label, sublabel }: { date: string; label: string; sublabel: string }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-slate-100 dark:border-slate-700 last:border-0">
      <div className="w-7 h-7 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center flex-shrink-0">
        <Calendar size={13} className="text-indigo-600 dark:text-indigo-400" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-base font-bold text-slate-800 dark:text-slate-100">{label}</p>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{sublabel}</p>
      </div>
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400 flex-shrink-0 pt-0.5">{date}</p>
    </div>
  );
}

interface TaxPageProps {
  embedded?: boolean;
  /** When embedded and the parent has already fetched prefs, pass these to skip
   *  a redundant getPreferences() call. The fetch is omitted when prefsLoaded=true. */
  prefsLoaded?: boolean;
  incomeValue?: number;
  incomeBracket?: string;
  pensionAnnual?: number;
  hasChildBenefit?: boolean;
}

export default function TaxPage({
  embedded = false,
  prefsLoaded = false,
  incomeValue: incomeValueProp,
  incomeBracket: incomeBracketProp,
  pensionAnnual: pensionAnnualProp,
  hasChildBenefit: hasChildBenefitProp,
}: TaxPageProps) {
  const router = useRouter();
  const { done, toggle } = useDone();

  // When the parent supplies prefs (embedded path), initialise state directly
  // from props and mark loading=false immediately — no extra fetch needed.
  const skipFetch = embedded && prefsLoaded;
  const [loading, setLoading] = useState(!skipFetch);

  const [income, setIncome] = useState(() => {
    if (skipFetch) return incomeValueProp ?? 0;
    return 0;
  });
  // Raw Settings-declared income bracket (distinct from `income` above, which
  // blends an exact income_value with a bracket-derived estimate for the tax
  // maths) — needed by the self-assessment gate to tell "declared under £100k"
  // apart from "nothing declared at all".
  const [incomeBracket, setIncomeBracket] = useState(() => {
    if (skipFetch) return incomeBracketProp ?? "";
    return "";
  });
  const [pensionAnnual, setPensionAnnual] = useState(() => {
    if (skipFetch) return pensionAnnualProp ?? 0;
    return 0;
  });
  const [hasChildBenefit, setHasChildBenefit] = useState(() => {
    if (skipFetch) return hasChildBenefitProp ?? false;
    return false;
  });

  const [alsoKnowingOpen, setAlsoKnowingOpen] = useState(false);

  // Annualised income from the app's own transaction-derived cashflow signal
  // (median monthly income x12, see backend/app/services/cashflow.py) — used
  // only to gate the self-assessment lever. Independent of the Settings-entered
  // income above, and fetched the same way whether embedded or standalone since
  // no parent currently prefetches it. null = unknown, gated content stays hidden.
  const [annualisedIncome, setAnnualisedIncome] = useState<number | null>(null);

  useEffect(() => {
    api.getTaxAnnualisedIncome().then(r => setAnnualisedIncome(r.annualised_income ?? null)).catch(() => {});
  }, []);

  useEffect(() => {
    // When the parent already fetched prefs, keep state in sync if props change
    // (e.g. user updates settings while on the page) but don't fire a fetch.
    if (skipFetch) {
      setPensionAnnual(pensionAnnualProp ?? 0);
      setHasChildBenefit(hasChildBenefitProp ?? false);
      setIncome(incomeValueProp ?? 0);
      setIncomeBracket(incomeBracketProp ?? "");
      return;
    }
    // Standalone route: fetch prefs ourselves.
    api.getPreferences().then(p => {
      setPensionAnnual(p.pension_annual ?? 0);
      setHasChildBenefit(p.has_child_benefit ?? false);
      setIncomeBracket(p.income_bracket ?? "");
      if (p.income_value && p.income_value > 0) {
        setIncome(p.income_value);
      } else if (p.income_bracket === "100k_125k") {
        setIncome(110_000);
      } else if (p.income_bracket === "125k_plus") {
        setIncome(130_000);
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, [skipFetch, incomeValueProp, incomeBracketProp, pensionAnnualProp, hasChildBenefitProp]);

  const ty = getTaxYear();

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Spinner size={28} /></div>;
  }

  // No income on file — a quiet prompt instead of levers. Every income band
  // gets levers once an income is set; this is the only gated state.
  if (income === 0) {
    const prompt = (
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-6 text-center">
        <p className="text-slate-500 dark:text-slate-400 text-sm mb-1 font-medium">Add your income in Settings</p>
        <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">Your tax levers and estimates personalise from the income and pension you set there.</p>
        <button onClick={() => router.push("/settings")} className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl">
          Go to Settings
        </button>
      </div>
    );
    if (embedded) return prompt;
    return (
      <div className="min-h-dvh" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="px-4 pt-4 pb-6">
          <button onClick={() => router.back()} className="flex items-center gap-1.5 text-sm text-slate-500 mb-4">
            <ChevronLeft size={18} /> Back
          </button>
          {prompt}
        </div>
      </div>
    );
  }

  // Core calculations
  const adjustedIncome = income - pensionAnnual;
  const allowanceLost = taperLoss(adjustedIncome);
  const allowanceRemaining = PA - allowanceLost;
  const over100k = Math.max(0, adjustedIncome - TAPER_START);
  const pensionNeededTotal = Math.max(0, adjustedIncome - TAPER_START);
  const taxSaving = Math.round(pensionNeededTotal * 0.6);
  const effectiveCost = pensionNeededTotal - taxSaving;
  const is125k = adjustedIncome >= TAPER_END;
  const hasTaperIssue = over100k > 0;
  // Self-assessment lever only makes sense above the £100k mandatory-registration
  // threshold, and that threshold is GROSS income. `annualisedIncome` below is
  // derived from bank-observed inflows (see backend/app/services/cashflow.py),
  // which is NET pay — after tax, NI, and pension deductions come out — so it
  // systematically undershoots gross and can't be trusted to rule someone OUT.
  // (Proof case: a user can declare the 100k_125k Settings bracket, i.e. >£100k
  // gross by their own account, while their net inflows annualise well under
  // £100k — gating on the net figure alone would wrongly hide the lever from
  // exactly the person it's for.) So Settings-declared income is authoritative
  // when we have it — exact income_value, or the bracket's lower bound when
  // only a bracket is known (100k_125k → £100k, 125k_plus → £125,140; declared
  // under_100k is a known "no" and is NOT unknown). The net cashflow proxy is
  // only a fallback for users who haven't declared anything in Settings. Unknown
  // on both fronts hides the lever — never tell someone to register on a guess.
  // `income` above already resolves to the exact declared income_value when
  // set, in both the embedded and standalone paths — otherwise fall back to
  // the bracket's lower bound (only relevant if a bracket-only declaration
  // ever reaches this component without a resolved `income`), then to a known
  // "declared under £100k" zero, then to genuinely unknown.
  const declaredIncome: number | null =
    income > 0 ? income
    : incomeBracket === "100k_125k" ? 100_000
    : incomeBracket === "125k_plus" ? 125_140
    : incomeBracket === "under_100k" ? 0
    : null;
  const showSelfAssessment =
    declaredIncome !== null
      ? declaredIncome >= 100_000
      : annualisedIncome !== null && annualisedIncome >= 100_000;

  // ── HERO CARD ──────────────────────────────────────────────────────────────
  // Calm indigo-tinted surface — NOT the Penny gradient
  function TaxHeroCard() {
    let heroHeadline: string;
    let heroBody: React.ReactNode;

    if (is125k) {
      // PA fully lost
      heroHeadline = "Your personal allowance is gone to the taper.";
      heroBody = (
        <>
          Pension contributions still attract <strong>45% relief</strong>. Contributing{" "}
          <strong className="font-mono tabular-nums">£{fmt(pensionNeededTotal)}</strong> restores your full{" "}
          <strong className="font-mono tabular-nums">£{fmt(PA)}</strong> personal allowance, saving approximately{" "}
          <strong className="font-mono tabular-nums">£{fmt(taxSaving)}</strong> in tax.
        </>
      );
    } else if (hasTaperIssue) {
      // Taper trap: £100k < adjustedIncome < £125,140
      heroHeadline = "You're in the 60% tax trap.";
      heroBody = (
        <>
          Every <span className="font-mono tabular-nums">£1</span> between <span className="font-mono tabular-nums">£100k</span> and <span className="font-mono tabular-nums">£125k</span> is taxed ~60%. Put{" "}
          <strong className="font-mono tabular-nums">£{fmt(pensionNeededTotal)}</strong> into your pension before 5 Apr to win
          back your <strong className="font-mono tabular-nums">£{fmt(allowanceLost)}</strong> personal allowance, saving{" "}
          <strong className="font-mono tabular-nums">£{fmt(taxSaving)}</strong> in tax, at a real cost of just{" "}
          <strong className="font-mono tabular-nums">£{fmt(effectiveCost)}</strong>.
        </>
      );
    } else if (adjustedIncome > 50_270) {
      // Higher rate: £50,270 < adjustedIncome ≤ £100,000
      heroHeadline = "You get 40% back on pension & Gift Aid.";
      heroBody = (
        <>
          This year&rsquo;s <strong><span className="font-mono tabular-nums">£20,000</span> ISA</strong> and <strong><span className="font-mono tabular-nums">£60,000</span> pension</strong>{" "}
          allowances reset on 5 Apr and don&rsquo;t roll over. <span className="font-mono tabular-nums">£1,000</span> into your pension costs
          you just <strong className="font-mono tabular-nums">£600</strong>.
        </>
      );
    } else {
      // Basic rate: adjustedIncome ≤ £50,270
      heroHeadline = "Your allowances reset on 5 Apr.";
      heroBody = (
        <>
          This year&rsquo;s <strong><span className="font-mono tabular-nums">£20,000</span> ISA</strong>{" "}
          allowance doesn&rsquo;t roll over, and pension contributions get{" "}
          <strong>20% added automatically</strong>. Every
          <span className="font-mono tabular-nums">£80</span> in becomes <span className="font-mono tabular-nums">£100</span> invested.
        </>
      );
    }

    return (
      <div className="rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-800/50 p-5">
        <p className="text-[11px] font-bold uppercase tracking-widest text-indigo-500 dark:text-indigo-400 mb-2">
          Tax year {ty.label} · your situation
        </p>
        <p className="text-base font-bold text-slate-900 dark:text-slate-100 leading-snug mb-2">
          {heroHeadline}
        </p>
        <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed mb-4">
          {heroBody}
        </p>
        {/* Deadline footer */}
        <div className="flex items-center gap-2 pt-3 border-t border-indigo-100 dark:border-indigo-800/50">
          <Calendar size={14} className="text-amber-500 flex-shrink-0" />
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {ty.daysLeft} days left in {ty.label}, allowances reset 5 Apr
          </p>
        </div>
      </div>
    );
  }

  const sections = (
    <div className="space-y-1.5">

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <TaxHeroCard />

      {/* ── YOUR LEVERS ──────────────────────────────────────────────────── */}
      <SectionLabel>Your levers</SectionLabel>

      {/* Pension lever */}
      {hasTaperIssue ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-4">
          <div className="flex items-start gap-3">
            <AlertCircle size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-base font-bold text-slate-800 dark:text-slate-100">
                Pension: contribute <span className="font-mono tabular-nums">£{fmt(pensionNeededTotal)}</span> before 5 Apr
              </p>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                Your adjusted income is <span className="font-mono tabular-nums">£{fmt(adjustedIncome)}</span>. <span className="font-mono tabular-nums">£{fmt(over100k)}</span> over the
                <span className="font-mono tabular-nums">£100,000</span> threshold. Contributing <span className="font-mono tabular-nums">£{fmt(pensionNeededTotal)}</span> more this tax year
                (via any mix of regular or one-off payments) restores your full personal allowance.
              </p>
              <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700 grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Extra needed</p>
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-100 font-mono tabular-nums">£{fmt(pensionNeededTotal)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Tax saved</p>
                  <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400 font-mono tabular-nums">£{fmt(taxSaving)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Costs you</p>
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-100 font-mono tabular-nums">£{fmt(effectiveCost)}</p>
                </div>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2">
                Based on the income and pension figures you set in Settings. Update them there if your situation changes.
              </p>
            </div>
          </div>
        </div>
      ) : adjustedIncome > 50_270 ? (
        /* Higher rate, sub-£100k: reassuring one-liner, not a struck-through lead */
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-4 flex items-center gap-3">
          <CheckCircle2 size={18} className="text-emerald-500 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-base font-bold text-slate-800 dark:text-slate-100">
              Your personal allowance is safe
            </p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Adjusted income <span className="font-mono tabular-nums">£{fmt(adjustedIncome)}</span>, below the <span className="font-mono tabular-nums">£100,000</span> taper threshold. Pension contributions attract 40% relief at your rate.
            </p>
          </div>
        </div>
      ) : (
        /* Basic rate: relief is automatic — nothing to fix, just a fact */
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-4 flex items-center gap-3">
          <CheckCircle2 size={18} className="text-emerald-500 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-base font-bold text-slate-800 dark:text-slate-100">
              Pension relief happens automatically
            </p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              At basic rate, HMRC adds 20% to pension contributions with no forms to fill in. Every <span className="font-mono tabular-nums">£80</span> in becomes <span className="font-mono tabular-nums">£100</span> invested.
            </p>
          </div>
        </div>
      )}

      {/* Gift Aid */}
      <ActionRow
        status={done.has("gift_aid") ? "done" : "info"}
        title="Gift Aid donations"
        detail={
          adjustedIncome > 50_270
            ? "A £100 gift to charity costs you £100, but you reclaim £25 via self-assessment (higher-rate relief). The charity also gets £25 from HMRC, so your £100 gift is worth £125 to the cause."
            : "Charitable donations via Gift Aid reduce your adjusted net income. The charity gets 25p added for every £1 you donate; basic-rate relief is claimed automatically."
        }
        onToggle={() => toggle("gift_aid")}
      />

      {/* Child benefit — only if applicable */}
      {hasChildBenefit && income > 60_000 && (
        <ActionRow
          status={adjustedIncome <= 60_000 ? "done" : "action"}
          title="High income child benefit charge"
          detail={
            adjustedIncome <= 60_000
              ? "Your pension contributions bring your adjusted income below £60,000. No charge applies."
              : `Your adjusted income is £${fmt(adjustedIncome)}, above £60,000. You'll repay some or all child benefit via self-assessment. Contributing an extra £${fmt(Math.max(0, adjustedIncome - 60_000))} to pension this year eliminates the charge entirely.`
          }
        />
      )}

      {/* ISA allowance */}
      <ActionRow
        status={done.has("isa") ? "done" : "action"}
        title={`ISA: £20,000 allowance · ${ty.daysLeft} days left`}
        detail="Unused ISA allowance cannot be carried forward. Growth and withdrawals are completely tax-free, most useful for sheltering dividend income and capital gains that would otherwise be taxed at your marginal rate."
        highlight={ty.daysLeft < 90}
        onToggle={() => toggle("isa")}
      />

      {/* ── ALSO WORTH KNOWING (collapsed) ───────────────────────────────── */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm overflow-hidden">
        <button
          type="button"
          onClick={() => setAlsoKnowingOpen(v => !v)}
          aria-expanded={alsoKnowingOpen}
          className="w-full flex items-center justify-between px-4 py-3.5 text-left active:scale-[0.99] transition-transform"
        >
          <p className="text-base font-bold text-slate-700 dark:text-slate-200">Also worth knowing</p>
          <ChevronDown
            size={16}
            className={`text-slate-400 transition-transform flex-shrink-0 ${alsoKnowingOpen ? "rotate-180" : ""}`}
          />
        </button>

        {alsoKnowingOpen && (
          <div className="px-4 pb-4 space-y-3 border-t border-slate-100 dark:border-slate-700 pt-3">
            {/* Pension carry-forward */}
            <ActionRow
              status={done.has("carry_forward") ? "done" : "info"}
              title="Pension carry-forward"
              detail={`Unused annual allowance from the last 3 tax years can be carried into this year, total allowed up to £60,000. Worth checking if you under-contributed in 2023/24, 2024/25, or 2025/26.`}
              onToggle={() => toggle("carry_forward")}
            />

            {/* Salary sacrifice */}
            <ActionRow
              status={done.has("salary_sacrifice") ? "done" : "info"}
              title="Salary sacrifice benefits"
              detail="Cycle to work (up to ~£1,000), electric car via salary sacrifice, and employer childcare vouchers all reduce your gross pay before income tax, they count toward bringing you under £100,000."
              onToggle={() => toggle("salary_sacrifice")}
            />

            {/* EIS/SEIS */}
            <ActionRow
              status={done.has("eis_seis") ? "done" : "info"}
              title="EIS / SEIS investments"
              detail="Investing in qualifying early-stage companies gives 30% (EIS) or 50% (SEIS) upfront income tax relief, plus exemption from capital gains tax on qualifying profits. Some people use it to diversify outside pensions and ISAs, but it's high-risk and illiquid, so only worth considering with money you can afford to lose."
              onToggle={() => toggle("eis_seis")}
            />

            {/* Self-assessment — only for incomes at/above £100k (annualised, transaction-derived) */}
            {showSelfAssessment && (
              <ActionRow
                status={done.has("self_assessment") ? "done" : "action"}
                title="Register for self-assessment"
                detail="Mandatory if your income exceeds £100,000. HMRC may not contact you automatically. If you haven't filed before, register at gov.uk. Penalties start from day one of missing the January deadline."
                onToggle={() => toggle("self_assessment")}
              />
            )}

            {/* Tax code */}
            <ActionRow
              status={done.has("tax_code") ? "done" : "action"}
              title="Check your tax code"
              detail="Your employer's payroll uses a tax code set by HMRC, which may not reflect pension contributions, other income, or expenses. Log into your Personal Tax Account at gov.uk to verify your code is correct. A wrong code can mean overpaying or underpaying all year."
              onToggle={() => toggle("tax_code")}
            />
          </div>
        )}
      </div>

      {/* ── KEY DATES ──────────────────────────────────────────────────────── */}
      <SectionLabel>Key dates</SectionLabel>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-4">
        <KeyDate
          date={`5 Apr ${ty.nextYear}`}
          label="End of tax year"
          sublabel="Last day to top up ISA, make extra pension contributions, and use annual reliefs"
        />
        <KeyDate
          date={`31 Jul ${ty.nextYear}`}
          label="Second payment on account"
          sublabel="Half your 2025/26 tax bill, due even if you haven't filed yet"
        />
        <KeyDate
          date={`31 Jan ${ty.nextYear + 1}`}
          label="Self-assessment deadline"
          sublabel="Online return + any remaining tax + first payment on account for next year"
        />
      </div>

      <p className="text-[11px] text-slate-500 dark:text-slate-400 text-center px-4 pb-2 mt-2">
        Estimates only. Speak to a qualified financial adviser or accountant for personalised advice.
      </p>

    </div>
  );

  if (embedded) {
    return sections;
  }

  return (
    <div className="min-h-dvh pb-10" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      {/* Standalone page header — calm white/slate surface, indigo accents, NO Penny gradient */}
      <div className="mx-4 mt-4 rounded-3xl px-4 pt-5 pb-5 bg-white dark:bg-slate-800 shadow-sm border border-slate-100 dark:border-slate-700">
        <button onClick={() => router.back()} className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 mb-3">
          <ChevronLeft size={15} /> Back
        </button>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-500 dark:text-indigo-400 mb-0.5">Tax year {ty.label}</p>
        <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-3">Tax efficiency</h1>
        <div className="h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
          <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${ty.progressPct}%` }} />
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-[11px] text-slate-500 dark:text-slate-400">6 Apr</span>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">{ty.daysLeft} days left</span>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">5 Apr</span>
        </div>
      </div>
      <div className="px-4 pt-4">
        {sections}
        <TaxPennyEntry />
      </div>
    </div>
  );
}
