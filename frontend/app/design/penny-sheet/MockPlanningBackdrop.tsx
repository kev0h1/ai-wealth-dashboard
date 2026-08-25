"use client";

// TEMPORARY PREVIEW — delete after design review.
//
// A plausible stand-in for a real screen behind the sheet, per brief:
// "a simple mocked Planning-like page body is fine, it is only backdrop".
// Purely decorative, no interactivity, no data fetching.

export default function MockPlanningBackdrop() {
  return (
    <div className="mx-auto w-full max-w-[430px] px-4 pt-8 pb-40">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        Pay period · 18 Aug to 28 Aug
      </p>
      <h1 className="mt-1 text-[20px] font-bold text-slate-900 dark:text-white">Planning</h1>

      <div className="mt-5 glass-hero rounded-3xl p-5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
          Safe to spend
        </p>
        <p className="mt-1 text-[30px] font-bold tracking-tight text-slate-900 dark:text-white money">£251</p>
        <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400">until Fri 28 Aug</p>
      </div>

      <div className="mt-4 glass-card rounded-2xl p-4">
        <p className="text-[14px] font-semibold text-slate-900 dark:text-slate-100">Japan trip</p>
        <div className="mt-2 h-2 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
          <div className="h-full rounded-full bg-amber-400" style={{ width: "41%" }} />
        </div>
        <p className="mt-1.5 text-[12px] text-slate-500 dark:text-slate-400">£1,240 of £3,000</p>
      </div>

      <div className="mt-3 glass-card rounded-2xl p-4">
        <p className="text-[14px] font-semibold text-slate-900 dark:text-slate-100">Emergency fund</p>
        <div className="mt-2 h-2 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
          <div className="h-full rounded-full bg-emerald-500" style={{ width: "72%" }} />
        </div>
        <p className="mt-1.5 text-[12px] text-slate-500 dark:text-slate-400">£2,880 of £4,000</p>
      </div>

      <div className="mt-3 glass-card rounded-2xl p-4">
        <p className="text-[14px] font-semibold text-slate-900 dark:text-slate-100">Coming up</p>
        <div className="mt-2 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-slate-600 dark:text-slate-300">Rent</span>
            <span className="text-[13px] text-slate-500 dark:text-slate-400 money">~£950</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-slate-600 dark:text-slate-300">Council tax</span>
            <span className="text-[13px] text-slate-500 dark:text-slate-400 money">~£140</span>
          </div>
        </div>
      </div>

      <p className="mt-6 text-[12px] leading-relaxed text-slate-400 dark:text-slate-500">
        This page body is backdrop only, for judging the sheet against a real screen. It is not interactive.
      </p>
    </div>
  );
}
