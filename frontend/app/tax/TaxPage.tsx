"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import BottomNav from "@/components/BottomNav";
import Spinner from "@/components/Spinner";
import { api } from "@/lib/api";
import { goBack } from "@/lib/goBack";
import TaxCanvas, { type TaxAction, type TaxCanvasModel, type TaxYear } from "./TaxCanvas";

const PERSONAL_ALLOWANCE = 12_570;
const TAPER_START = 100_000;
const TAPER_END = 125_140;

function taperLoss(income: number): number {
  if (income <= TAPER_START) return 0;
  if (income >= TAPER_END) return PERSONAL_ALLOWANCE;
  return Math.floor((income - TAPER_START) / 2);
}

function getTaxYear(): TaxYear {
  const now = new Date();
  const year = now.getFullYear();
  const apr6 = new Date(year, 3, 6);
  const start = now >= apr6 ? apr6 : new Date(year - 1, 3, 6);
  const end = new Date(start.getFullYear() + 1, 3, 5);
  const total = end.getTime() - start.getTime();
  const elapsed = now.getTime() - start.getTime();

  return {
    label: `${start.getFullYear()}/${String(end.getFullYear()).slice(2)}`,
    progressPct: Math.min(100, Math.round((elapsed / total) * 100)),
    daysLeft: Math.ceil((end.getTime() - now.getTime()) / 86_400_000),
    nextYear: end.getFullYear(),
  };
}

function formatMoney(value: number): string {
  return `£${Math.round(value).toLocaleString("en-GB")}`;
}

type DoneKey =
  | "self_assessment"
  | "tax_code"
  | "gift_aid"
  | "salary_sacrifice"
  | "carry_forward"
  | "eis_seis"
  | "isa";

function useDone() {
  const [done, setDone] = useState<Set<DoneKey>>(new Set());

  useEffect(() => {
    try {
      const saved = localStorage.getItem("tax_checklist_done");
      // Deliberately hydrate persisted client-only state after the server render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved) setDone(new Set(JSON.parse(saved) as DoneKey[]));
    } catch {}
  }, []);

  function toggle(key: DoneKey) {
    setDone((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem("tax_checklist_done", JSON.stringify([...next]));
      } catch {}
      return next;
    });
  }

  return { done, toggle };
}

interface TaxPageProps {
  embedded?: boolean;
  /** When embedded and the parent has already fetched preferences, these values avoid a duplicate request. */
  prefsLoaded?: boolean;
  incomeValue?: number;
  incomeBracket?: string;
  pensionAnnual?: number;
  hasChildBenefit?: boolean;
}

function LoadingState({ embedded }: { embedded: boolean }) {
  const spinner = <div className="flex items-center justify-center py-16"><Spinner size={28} /></div>;
  if (embedded) return spinner;

  return (
    <div className="min-h-dvh pb-32 lg:pb-12" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      {spinner}
      <BottomNav />
    </div>
  );
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
  const skipFetch = embedded && prefsLoaded;
  const [loading, setLoading] = useState(!skipFetch);
  const [fetchedIncome, setFetchedIncome] = useState(0);
  const [fetchedIncomeBracket, setFetchedIncomeBracket] = useState("");
  const [fetchedPensionAnnual, setFetchedPensionAnnual] = useState(0);
  const [fetchedHasChildBenefit, setFetchedHasChildBenefit] = useState(false);

  const income = skipFetch ? incomeValueProp ?? 0 : fetchedIncome;
  const incomeBracket = skipFetch ? incomeBracketProp ?? "" : fetchedIncomeBracket;
  const pensionAnnual = skipFetch ? pensionAnnualProp ?? 0 : fetchedPensionAnnual;
  const hasChildBenefit = skipFetch ? hasChildBenefitProp ?? false : fetchedHasChildBenefit;

  // This bank-derived net-income signal is only a fallback for deciding
  // whether to show the self-assessment check when Settings has no declaration.
  const [annualisedIncome, setAnnualisedIncome] = useState<number | null>(null);

  useEffect(() => {
    api.getTaxAnnualisedIncome()
      .then((result) => setAnnualisedIncome(result.annualised_income ?? null))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (skipFetch) return;

    api.getPreferences()
      .then((preferences) => {
        setFetchedPensionAnnual(preferences.pension_annual ?? 0);
        setFetchedHasChildBenefit(preferences.has_child_benefit ?? false);
        setFetchedIncomeBracket(preferences.income_bracket ?? "");
        if (preferences.income_value && preferences.income_value > 0) {
          setFetchedIncome(preferences.income_value);
        } else if (preferences.income_bracket === "100k_125k") {
          setFetchedIncome(110_000);
        } else if (preferences.income_bracket === "125k_plus") {
          setFetchedIncome(130_000);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [skipFetch]);

  if (loading) return <LoadingState embedded={embedded} />;

  const taxYear = getTaxYear();
  let model: TaxCanvasModel;

  if (income === 0) {
    model = {
      hasIncome: false,
      heroHeadline: "",
      heroBody: "",
      leverTitle: "",
      leverDetail: "",
      leverStatus: "info",
      pensionNeededTotal: 0,
      taxSaving: 0,
      effectiveCost: 0,
      mainActions: [],
      secondaryActions: [],
      taxYear,
    };
  } else {
    const adjustedIncome = income - pensionAnnual;
    const allowanceLost = taperLoss(adjustedIncome);
    const over100k = Math.max(0, adjustedIncome - TAPER_START);
    const pensionNeededTotal = Math.max(0, adjustedIncome - TAPER_START);
    const taxSaving = Math.round(pensionNeededTotal * 0.6);
    const effectiveCost = pensionNeededTotal - taxSaving;
    const is125k = adjustedIncome >= TAPER_END;
    const hasTaperIssue = over100k > 0;
    const isHigherRate = adjustedIncome > 50_270;

    // Settings-declared gross income is authoritative for the £100k gate.
    // Bank-observed annualised inflows are net and only fill a genuine gap.
    const declaredIncome: number | null =
      income > 0 ? income
      : incomeBracket === "100k_125k" ? 100_000
      : incomeBracket === "125k_plus" ? 125_140
      : incomeBracket === "under_100k" ? 0
      : null;
    const showSelfAssessment = declaredIncome !== null
      ? declaredIncome >= 100_000
      : annualisedIncome !== null && annualisedIncome >= 100_000;

    let heroHeadline: string;
    let heroBody: string;
    let leverTitle: string;
    let leverDetail: string;
    let leverStatus: TaxCanvasModel["leverStatus"];

    if (is125k) {
      heroHeadline = "Your personal allowance is gone to the taper.";
      heroBody = `Pension contributions still attract 45% relief. Contributing ${formatMoney(pensionNeededTotal)} restores your full ${formatMoney(PERSONAL_ALLOWANCE)} personal allowance, saving approximately ${formatMoney(taxSaving)} in tax.`;
      leverTitle = `Pension: contribute ${formatMoney(pensionNeededTotal)} before 5 Apr`;
      leverDetail = `Your adjusted income is ${formatMoney(adjustedIncome)}. ${formatMoney(over100k)} over the £100,000 threshold. Contributing ${formatMoney(pensionNeededTotal)} more this tax year (via any mix of regular or one-off payments) restores your full personal allowance.`;
      leverStatus = "action";
    } else if (hasTaperIssue) {
      heroHeadline = "You're in the 60% tax trap.";
      heroBody = `Every £1 between £100k and £125k is taxed ~60%. Put ${formatMoney(pensionNeededTotal)} into your pension before 5 Apr to win back your ${formatMoney(allowanceLost)} personal allowance, saving ${formatMoney(taxSaving)} in tax, at a real cost of just ${formatMoney(effectiveCost)}.`;
      leverTitle = `Pension: contribute ${formatMoney(pensionNeededTotal)} before 5 Apr`;
      leverDetail = `Your adjusted income is ${formatMoney(adjustedIncome)}. ${formatMoney(over100k)} over the £100,000 threshold. Contributing ${formatMoney(pensionNeededTotal)} more this tax year (via any mix of regular or one-off payments) restores your full personal allowance.`;
      leverStatus = "action";
    } else if (isHigherRate) {
      heroHeadline = "You get 40% back on pension & Gift Aid.";
      heroBody = "This year's £20,000 ISA and £60,000 pension allowances reset on 5 Apr and don't roll over. £1,000 into your pension costs you just £600.";
      leverTitle = "Your personal allowance is safe";
      leverDetail = `Adjusted income ${formatMoney(adjustedIncome)}, below the £100,000 taper threshold. Pension contributions attract 40% relief at your rate.`;
      leverStatus = "safe";
    } else {
      heroHeadline = "Your allowances reset on 5 Apr.";
      heroBody = "This year's £20,000 ISA allowance doesn't roll over, and pension contributions get 20% added automatically. Every £80 in becomes £100 invested.";
      leverTitle = "Pension relief happens automatically";
      leverDetail = "At basic rate, HMRC adds 20% to pension contributions with no forms to fill in. Every £80 in becomes £100 invested.";
      leverStatus = "safe";
    }

    const mainActions: TaxAction[] = [
      {
        key: "gift_aid",
        title: "Gift Aid donations",
        detail: isHigherRate
          ? "A £100 gift to charity costs you £100, but you reclaim £25 via self-assessment (higher-rate relief). The charity also gets £25 from HMRC, so your £100 gift is worth £125 to the cause."
          : "Charitable donations via Gift Aid reduce your adjusted net income. The charity gets 25p added for every £1 you donate; basic-rate relief is claimed automatically.",
        status: "info",
        canMarkDone: true,
      },
      ...(hasChildBenefit && income > 60_000
        ? [{
            key: "child_benefit",
            title: "High income child benefit charge",
            detail: adjustedIncome <= 60_000
              ? "Your pension contributions bring your adjusted income below £60,000. No charge applies."
              : `Your adjusted income is ${formatMoney(adjustedIncome)}, above £60,000. You'll repay some or all child benefit via self-assessment. Contributing an extra ${formatMoney(Math.max(0, adjustedIncome - 60_000))} to pension this year eliminates the charge entirely.`,
            status: adjustedIncome <= 60_000 ? "info" as const : "action" as const,
          }]
        : []),
      {
        key: "isa",
        title: `ISA: £20,000 allowance · ${taxYear.daysLeft} days left`,
        detail: "Unused ISA allowance cannot be carried forward. Growth and withdrawals are completely tax-free, most useful for sheltering dividend income and capital gains that would otherwise be taxed at your marginal rate.",
        status: "action",
        canMarkDone: true,
        highlight: taxYear.daysLeft < 90,
      },
    ];

    const secondaryActions: TaxAction[] = [
      {
        key: "carry_forward",
        title: "Pension carry-forward",
        detail: "Unused annual allowance from the last 3 tax years can be carried into this year, total allowed up to £60,000. Worth checking if you under-contributed in 2023/24, 2024/25, or 2025/26.",
        status: "info",
        canMarkDone: true,
      },
      {
        key: "salary_sacrifice",
        title: "Salary sacrifice benefits",
        detail: "Cycle to work (up to ~£1,000), electric car via salary sacrifice, and employer childcare vouchers all reduce your gross pay before income tax, they count toward bringing you under £100,000.",
        status: "info",
        canMarkDone: true,
      },
      {
        key: "eis_seis",
        title: "EIS / SEIS investments",
        detail: "Investing in qualifying early-stage companies gives 30% (EIS) or 50% (SEIS) upfront income tax relief, plus exemption from capital gains tax on qualifying profits. Some people use it to diversify outside pensions and ISAs, but it's high-risk and illiquid, so only worth considering with money you can afford to lose.",
        status: "info",
        canMarkDone: true,
      },
      ...(showSelfAssessment
        ? [{
            key: "self_assessment",
            title: "Register for self-assessment",
            detail: "Mandatory if your income exceeds £100,000. HMRC may not contact you automatically. If you haven't filed before, register at gov.uk. Penalties start from day one of missing the January deadline.",
            status: "action" as const,
            canMarkDone: true,
          }]
        : []),
      {
        key: "tax_code",
        title: "Check your tax code",
        detail: "Your employer's payroll uses a tax code set by HMRC, which may not reflect pension contributions, other income, or expenses. Log into your Personal Tax Account at gov.uk to verify your code is correct. A wrong code can mean overpaying or underpaying all year.",
        status: "action",
        canMarkDone: true,
      },
    ];

    model = {
      hasIncome: true,
      heroHeadline,
      heroBody,
      leverTitle,
      leverDetail,
      leverStatus,
      pensionNeededTotal,
      taxSaving,
      effectiveCost,
      mainActions,
      secondaryActions,
      taxYear,
    };
  }

  const canvas = (
    <TaxCanvas
      model={model}
      done={done}
      onToggle={(key) => toggle(key as DoneKey)}
      embedded={embedded}
      onBack={() => goBack(router, "/settings")}
    />
  );

  if (embedded) return canvas;

  return (
    <div className="min-h-dvh pb-32 lg:pb-12" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      <a
        href="#tax-main"
        className="sr-only fixed left-3 top-3 z-[100] rounded-xl bg-white px-4 py-3 font-semibold text-slate-950 shadow-lg focus:not-sr-only focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-slate-800 dark:text-white"
      >
        Skip to Tax content
      </a>
      <main id="tax-main" tabIndex={-1}>{canvas}</main>
      <BottomNav />
    </div>
  );
}
