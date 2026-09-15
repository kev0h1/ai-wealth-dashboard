export type TaxPreviewState = "trap" | "lost" | "higher" | "basic" | "empty";

export type TaxActionStatus = "action" | "info";

export type TaxAction = {
  key: string;
  title: string;
  detail: string;
  status: TaxActionStatus;
  canMarkDone?: boolean;
  highlight?: boolean;
};

export type TaxYear = {
  label: string;
  progressPct: number;
  daysLeft: number;
  nextYear: number;
};

export type TaxPreviewModel = {
  state: TaxPreviewState;
  stateLabel: string;
  income: number;
  pensionAnnual: number;
  adjustedIncome: number;
  hasIncome: boolean;
  heroHeadline: string;
  heroBody: string;
  leverTitle: string;
  leverDetail: string;
  leverStatus: TaxActionStatus | "safe";
  pensionNeededTotal: number;
  taxSaving: number;
  effectiveCost: number;
  mainActions: TaxAction[];
  secondaryActions: TaxAction[];
  taxYear: TaxYear;
};

const PERSONAL_ALLOWANCE = 12_570;
const TAPER_START = 100_000;
const TAPER_END = 125_140;

export const TAX_PREVIEW_STATES: TaxPreviewState[] = ["trap", "lost", "higher", "basic", "empty"];

export const TAX_STATE_LABELS: Record<TaxPreviewState, string> = {
  trap: "60% tax trap",
  lost: "Allowance fully tapered",
  higher: "Higher rate",
  basic: "Basic rate",
  empty: "Income not set",
};

const PREVIEW_NOW = new Date("2026-09-15T12:00:00Z");

const STATE_INPUTS: Record<TaxPreviewState, { income: number; pensionAnnual: number; hasChildBenefit: boolean }> = {
  trap: { income: 112_000, pensionAnnual: 4_000, hasChildBenefit: true },
  lost: { income: 137_000, pensionAnnual: 4_000, hasChildBenefit: false },
  higher: { income: 78_000, pensionAnnual: 6_000, hasChildBenefit: false },
  basic: { income: 45_000, pensionAnnual: 3_000, hasChildBenefit: false },
  empty: { income: 0, pensionAnnual: 0, hasChildBenefit: false },
};

function formatMoney(value: number): string {
  return `£${Math.round(value).toLocaleString("en-GB")}`;
}

function taperLoss(income: number): number {
  if (income <= TAPER_START) return 0;
  if (income >= TAPER_END) return PERSONAL_ALLOWANCE;
  return Math.floor((income - TAPER_START) / 2);
}

function getTaxYear(now = new Date()): TaxYear {
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

export function getTaxPreviewModel(state: TaxPreviewState): TaxPreviewModel {
  const input = STATE_INPUTS[state];
  const adjustedIncome = input.income - input.pensionAnnual;
  const allowanceLost = taperLoss(adjustedIncome);
  const over100k = Math.max(0, adjustedIncome - TAPER_START);
  const pensionNeededTotal = Math.max(0, adjustedIncome - TAPER_START);
  const taxSaving = Math.round(pensionNeededTotal * 0.6);
  const effectiveCost = pensionNeededTotal - taxSaving;
  const is125k = adjustedIncome >= TAPER_END;
  const hasTaperIssue = over100k > 0;
  const isHigherRate = adjustedIncome > 50_270;
  const taxYear = getTaxYear(PREVIEW_NOW);

  let heroHeadline: string;
  let heroBody: string;
  let leverTitle: string;
  let leverDetail: string;
  let leverStatus: TaxPreviewModel["leverStatus"];

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
    ...(input.hasChildBenefit && input.income > 60_000
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
    ...(input.income >= 100_000
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

  return {
    state,
    stateLabel: TAX_STATE_LABELS[state],
    income: input.income,
    pensionAnnual: input.pensionAnnual,
    adjustedIncome,
    hasIncome: input.income > 0,
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
