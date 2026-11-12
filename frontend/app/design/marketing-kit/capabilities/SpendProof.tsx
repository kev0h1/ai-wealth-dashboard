"use client";

import SpendPaceHero from "@/components/SpendPaceHero";
import MoneyText from "@/components/MoneyText";
import SpendVerdictView from "@/components/SpendVerdictView";
import { TransactionRowContent } from "@/components/TransactionRow";
import { EATING_OUT_PAYMENTS, SPEND_CATEGORY_COLOURS, SPEND_CHANGE_VERDICT } from "./spend-fixtures";

export type SpendProofKind = "spend" | "spend-insight" | "spend-expenses";

const inert = () => {};
const inertIntent = async () => {};

/**
 * A capture plate composed from shipped Spend components. It deliberately
 * contains no chart or transaction-list recreation: headline, category
 * comparison, merchant causes and payment rows all use their live renderers.
 */
export default function SpendProof({ kind, theme: _theme }: { kind: SpendProofKind; theme: "light" | "dark" }) {
  void _theme;

  if (kind === "spend") {
    return (
      <section data-feature-proof="spend" className="p-4">
        <SpendPaceHero
          verdict={SPEND_CHANGE_VERDICT}
          incomeTxns={[]}
          onTransactionClick={inert}
          onOutTap={inert}
          onMovedTap={inert}
        />
      </section>
    );
  }

  if (kind === "spend-insight") {
    return (
      <section data-feature-proof="spend-insight" className="p-4 pl-8">
        <SpendVerdictView
          verdict={SPEND_CHANGE_VERDICT}
          colours={SPEND_CATEGORY_COLOURS}
          onOpenCategory={inert}
          onIntent={inertIntent}
          hideReading
          journey
        />
      </section>
    );
  }

  return (
    <section data-feature-proof="spend-expenses" className="p-4">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-700">
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Eating Out payments</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400"><MoneyText text="4 payments · £240 this pay period" unmasked /></p>
        </div>
        {EATING_OUT_PAYMENTS.map((transaction) => (
          <TransactionRowContent key={transaction.id} transaction={transaction} hidden={false} onClick={inert} />
        ))}
      </div>
    </section>
  );
}
