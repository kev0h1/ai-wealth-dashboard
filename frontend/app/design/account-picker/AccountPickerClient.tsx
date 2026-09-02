"use client";

// Design preview — "Which account?" declutter for the envelope flow
// (components/AllocationFields.tsx AccountRadioPicker, consumed by
// SetAsideSheet.tsx and AllocationSheet.tsx). Owner feedback, 2026-08-29
// (phone screenshots): the flat list renders ~14 rows once real banks and
// Monzo/Chase pots are connected and "becomes very cluttered". Three
// variants against a 15-account fixture mirroring his real spread (2
// current accounts, Revolut x2, 7 Monzo pots, 2 Chase pots, 2 offline),
// each embedded in a faithful replica of the envelope sheet step so
// density is judged in context, not in isolation.
//
// Deep-linkable: /design/account-picker?variant=a|b|c&mode=light|dark&state=few|many

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { AllocationRhythm, FillRuleValue } from "@/components/AllocationFields";
import SheetShell from "./SheetShell";
import VariantA from "./VariantA";
import VariantB from "./VariantB";
import VariantC from "./VariantC";
import { FEW_ACCOUNTS, MANY_ACCOUNTS, suggestedAccountId } from "./fixtures";

type Mode = "light" | "dark";
type Variant = "a" | "b" | "c";
type State = "few" | "many";

const VARIANTS: { value: Variant; label: string }[] = [
  { value: "a", label: "A · Grouped" },
  { value: "b", label: "B · Search" },
  { value: "c", label: "C · Chips" },
];

const ANNOTATIONS: Record<Variant, { position: string; generalises: string }> = {
  a: {
    position:
      "Grouped by institution, collapsed by default. The owner's 15 rows are really 6 banks; every multi-account group genuinely starts closed, so \"scroll past 7 Monzo pots\" becomes \"tap Monzo once if that's not what I meant\" and the flat list of 15 shrinks to a handful of rows at rest. Single-account banks render as their own row directly, no header, no pointless tap. Savings-kind accounts sort first inside each group, and the single most likely target is pinned above the groups as one ungrouped row, so the common case is still a single tap at 15 accounts.",
    generalises:
      "Drop-in replacement for AccountRadioPicker: same props (accounts, value, onChange), same RadioDot semantics, same 44px rows. Every call site that imports AccountRadioPicker today (SetAsideSheet.tsx, AllocationSheet.tsx) gets the accordion for free. The same shape suits CommitmentSheet.tsx and PlanOneOffSheet.tsx's inline account lists and AccountsPage.tsx's manual-account rule modal, all of which build their own flat radiogroup over the same account set; the \"Suggested\" pin is optional per call site (pass suggestedId, or omit it and the accordion alone still declutters).",
  },
  b: {
    position:
      "Search-first with a smart shortlist. Most of the time the user already knows the pot's name; a compact search field plus a 4-5 row recency-weighted shortlist (savings pots first) means the default view never exceeds a thumb's reach, and \"Show all 15 accounts ›\" is one tap away for the browse case. Search matches across the full 15 regardless of shortlist state, so nothing is ever unreachable.",
    generalises:
      "Same props contract as AccountRadioPicker plus the recency data the shortlist needs (already available anywhere Allocation history exists). Suits any call site where users return to the same 1-2 targets repeatedly, which is true of SetAsideSheet.tsx and AllocationSheet.tsx today; for a first-run sheet with no recency yet (a brand-new user), the shortlist falls back to whatever accounts exist and search still works unchanged.",
  },
  c: {
    position:
      "Horizontal bank chips filtering one list. A third shape distinct from both an accordion and search: one scrollable chip row above a single list, no nested disclosure, no query field. The chip for the suggested account's bank is pre-selected, so the common case lands on a short list without an extra tap, and switching banks is one tap on a chip rather than a scroll.",
    generalises:
      "Same props contract as AccountRadioPicker. This is the best fit for surfaces that are inherently bank-centric already, like AccountsPage.tsx's manual-account rule modal (its own flat radiogroup over the same accounts, built around a \"ruleSource\" pick) and CommitmentSheet.tsx's multi-select account list; less natural for a sheet where the user is thinking in goals rather than banks, where A or B read better.",
  },
};

export default function AccountPickerClient() {
  const params = useSearchParams();
  const variant: Variant = (["a", "b", "c"] as const).includes(params.get("variant") as Variant)
    ? (params.get("variant") as Variant)
    : "a";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";
  const state: State = params.get("state") === "few" ? "few" : "many";

  const accounts = state === "few" ? FEW_ACCOUNTS : MANY_ACCOUNTS;
  const suggestedId = suggestedAccountId(accounts);

  const [accountId, setAccountId] = useState("");
  const [rhythm, setRhythm] = useState<AllocationRhythm>("every_period");
  const [fillRule, setFillRule] = useState<FillRuleValue>({
    match_type: "description_contains",
    match_value: "",
    fill_display_name: "",
  });

  // Reset selection when switching variant/state so each combination is
  // seen in its true default state, not carrying over a prior tap.
  useEffect(() => {
    setAccountId("");
    setFillRule({ match_type: "description_contains", match_value: "", fill_display_name: "" });
  }, [variant, state]);

  useEffect(() => {
    const t = setTimeout(() => {
      document.documentElement.classList.toggle("dark", mode === "dark");
      document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", mode === "dark" ? "dark" : "only light");
    }, 0);
    return () => clearTimeout(t);
  }, [mode]);

  function pickAccount(id: string) {
    setAccountId(id);
    setFillRule({ match_type: "description_contains", match_value: "", fill_display_name: "" });
  }

  const hrefFor = (next: Partial<{ variant: Variant; mode: Mode; state: State }>) => {
    const v = next.variant ?? variant;
    const m = next.mode ?? mode;
    const s = next.state ?? state;
    return `?variant=${v}&mode=${m}&state=${s}`;
  };

  const annotation = ANNOTATIONS[variant];

  return (
    <div className={mode === "dark" ? "dark" : ""}>
      <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-16">
        <div className="mx-auto w-full max-w-[430px] px-4 pt-6">
          <h1 className="text-[15px] font-bold text-slate-900 dark:text-slate-100">Account picker declutter</h1>
          <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-0.5">
            &ldquo;Which account?&rdquo; step of the envelope flow, at {accounts.length} accounts.
          </p>

          {/* Variant tabs */}
          <div className="glass-tile rounded-xl p-1 flex items-center gap-1 mt-4">
            {VARIANTS.map((v) => (
              <a
                key={v.value}
                href={hrefFor({ variant: v.value })}
                className={`flex-1 min-w-0 text-center min-h-[36px] flex items-center justify-center rounded-lg text-[12px] font-semibold truncate transition-colors ${
                  variant === v.value
                    ? "bg-indigo-500 text-white"
                    : "text-slate-500 dark:text-slate-400 active:bg-white/10"
                }`}
              >
                {v.label}
              </a>
            ))}
          </div>

          {/* State + mode toggles */}
          <div className="flex items-center gap-2 mt-2">
            <div className="flex items-center gap-1 flex-1">
              <a
                href={hrefFor({ state: "few" })}
                className={`min-h-[32px] px-3 flex items-center rounded-full text-[11px] font-semibold ${
                  state === "few" ? "bg-indigo-500 text-white" : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400"
                }`}
              >
                Few (3)
              </a>
              <a
                href={hrefFor({ state: "many" })}
                className={`min-h-[32px] px-3 flex items-center rounded-full text-[11px] font-semibold ${
                  state === "many" ? "bg-indigo-500 text-white" : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400"
                }`}
              >
                Many (15)
              </a>
            </div>
            <a
              href={hrefFor({ mode: mode === "dark" ? "light" : "dark" })}
              className="min-h-[32px] px-3 flex items-center rounded-full text-[11px] font-semibold bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400"
            >
              {mode === "dark" ? "Light" : "Dark"}
            </a>
          </div>
        </div>

        {/* Sheet replica */}
        <div className="mt-5 px-4">
          <SheetShell
            rhythm={rhythm}
            onRhythmChange={setRhythm}
            accountId={accountId}
            fillRule={fillRule}
            onFillRuleChange={setFillRule}
          >
            {variant === "a" && (
              <VariantA accounts={accounts} suggestedId={suggestedId} value={accountId} onChange={pickAccount} />
            )}
            {variant === "b" && <VariantB accounts={accounts} value={accountId} onChange={pickAccount} />}
            {variant === "c" && (
              <VariantC accounts={accounts} suggestedId={suggestedId} value={accountId} onChange={pickAccount} />
            )}
          </SheetShell>
        </div>

        {/* Annotation panel */}
        <div className="mx-auto w-full max-w-[430px] px-4 mt-5">
          <div className="glass-card-flat rounded-2xl p-4 space-y-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">Position</p>
              <p className="text-[13px] text-slate-600 dark:text-slate-300 leading-relaxed">{annotation.position}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">Generalises to</p>
              <p className="text-[13px] text-slate-600 dark:text-slate-300 leading-relaxed">{annotation.generalises}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
