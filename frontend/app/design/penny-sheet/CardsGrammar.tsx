"use client";

// TEMPORARY PREVIEW — delete after design review.
//
// Grammar A, "cards": the variant C "inset question" layout Kevin picked
// from /design/penny-thread (?v=c). The question is a muted inset caption
// inside the top of the answer card, above a hairline divider, with the
// verdict headline directly beneath, then muted grounding facts, then an
// optional offer chip. One card per exchange, no orphan question line.
//
// Self-contained inside app/design/penny-sheet/ — deliberately not sharing
// a component with ../penny-thread/PennyThreadClient.tsx's own variant C,
// this file re-implements the same anatomy so this route has nothing that
// breaks if penny-thread is deleted first.

import MoneyText from "@/components/MoneyText";
import ChatMarkdown from "@/components/ChatMarkdown";
import type { ThreadItem } from "./fixtures";

function OfferChip({ label, onTap }: { label: string; onTap: (label: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onTap(label)}
      className="mt-3 min-h-[44px] inline-flex items-center text-[13px] font-semibold text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 bg-indigo-50/60 dark:bg-indigo-900/20 rounded-full px-4 py-2 active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
    >
      <MoneyText text={label} />
    </button>
  );
}

function CardBody({ item, onOfferTap }: { item: ThreadItem; onOfferTap: (label: string) => void }) {
  if (item.kind === "pending") {
    return (
      <div className="mt-3 space-y-2">
        <span className="sr-only">Checking your numbers</span>
        <div aria-hidden className="h-4 w-1/2 rounded-full bg-slate-200 dark:bg-slate-700 animate-pulse" />
        <div aria-hidden className="h-3 w-full rounded-full bg-slate-100 dark:bg-slate-800 animate-pulse" />
        <div aria-hidden className="h-3 w-2/3 rounded-full bg-slate-100 dark:bg-slate-800 animate-pulse" />
      </div>
    );
  }
  if (item.kind === "tax") {
    return (
      <div className="mt-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">
          Tax
        </p>
        <div className="text-[14px] leading-relaxed text-slate-700 dark:text-slate-200">
          <ChatMarkdown>{item.body}</ChatMarkdown>
        </div>
      </div>
    );
  }
  return (
    <div className="mt-3">
      <p className="text-[16px] font-bold leading-snug text-slate-900 dark:text-slate-100">
        <MoneyText text={item.headline} />
      </p>
      <div className="mt-2 space-y-1">
        {item.facts.map((f, i) => (
          <p key={i} className="text-[13px] leading-snug text-slate-500 dark:text-slate-400">
            <MoneyText text={f} />
          </p>
        ))}
      </div>
      {item.offer && <OfferChip label={item.offer} onTap={onOfferTap} />}
    </div>
  );
}

export default function CardsGrammar({
  items,
  onOfferTap,
}: {
  items: ThreadItem[];
  onOfferTap: (label: string) => void;
}) {
  return (
    <div className="space-y-3 pb-2">
      {items.map((item) => (
        <div key={item.id} className="glass-card rounded-2xl p-4 w-full">
          <p className="text-[13px] text-slate-500 dark:text-slate-400 leading-snug">
            <MoneyText text={item.question} />
          </p>
          <div className="mt-2 border-t border-slate-200/70 dark:border-slate-700" />
          <CardBody item={item} onOfferTap={onOfferTap} />
        </div>
      ))}
    </div>
  );
}
