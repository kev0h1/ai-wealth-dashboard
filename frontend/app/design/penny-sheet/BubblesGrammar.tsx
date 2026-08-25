"use client";

// TEMPORARY PREVIEW — delete after design review.
//
// Grammar B, "bubbles": conventional messenger grammar, built as a genuine
// contender rather than a straw man. User turn right-aligned in a filled
// bubble with a tail, Penny's turn left-aligned in a muted bubble with a
// tail. Anatomy matches the retired components/TaxChat.tsx treatment (per
// Kevin's brief): `bg-violet-600 text-white rounded-br-sm` for the user,
// `bg-slate-100 dark:bg-slate-700 rounded-bl-sm` for the assistant. The
// same verdict content renders inside the bubble: headline still bold and
// leading, facts still present, this isn't deliberately crippled.
//
// Self-contained inside app/design/penny-sheet/, no shared code with
// CardsGrammar.tsx beyond the fixtures/type import.

import MoneyText from "@/components/MoneyText";
import ChatMarkdown from "@/components/ChatMarkdown";
import type { ThreadItem } from "./fixtures";

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] bg-violet-600 text-white rounded-2xl rounded-br-sm px-4 py-2.5">
        <p className="text-[14px] leading-snug">
          <MoneyText text={text} />
        </p>
      </div>
    </div>
  );
}

function OfferChip({ label, onTap }: { label: string; onTap: (label: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onTap(label)}
      className="mt-3 min-h-[44px] inline-flex items-center text-[13px] font-semibold text-indigo-600 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-500/40 bg-white/70 dark:bg-indigo-900/30 rounded-full px-4 py-2 active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
    >
      <MoneyText text={label} />
    </button>
  );
}

function AssistantBubble({ item, onOfferTap }: { item: ThreadItem; onOfferTap: (label: string) => void }) {
  if (item.kind === "pending") {
    return (
      <div className="flex justify-start">
        <div className="max-w-[85%] bg-slate-100 dark:bg-slate-700 rounded-2xl rounded-bl-sm px-4 py-3 space-y-2 w-48">
          <span className="sr-only">Checking your numbers</span>
          <div aria-hidden className="h-3.5 w-2/3 rounded-full bg-slate-300/70 dark:bg-slate-500/50 animate-pulse" />
          <div aria-hidden className="h-3 w-full rounded-full bg-slate-300/50 dark:bg-slate-500/30 animate-pulse" />
        </div>
      </div>
    );
  }
  if (item.kind === "tax") {
    return (
      <div className="flex justify-start">
        <div className="max-w-[85%] bg-slate-100 dark:bg-slate-700 rounded-2xl rounded-bl-sm px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-400 mb-1">
            Tax
          </p>
          <div className="text-[14px] leading-relaxed text-slate-700 dark:text-slate-100">
            <ChatMarkdown>{item.body}</ChatMarkdown>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] bg-slate-100 dark:bg-slate-700 rounded-2xl rounded-bl-sm px-4 py-3">
        <p className="text-[15px] font-bold leading-snug text-slate-900 dark:text-slate-100">
          <MoneyText text={item.headline} />
        </p>
        <div className="mt-1.5 space-y-1">
          {item.facts.map((f, i) => (
            <p key={i} className="text-[13px] leading-snug text-slate-600 dark:text-slate-300">
              <MoneyText text={f} />
            </p>
          ))}
        </div>
        {item.offer && <OfferChip label={item.offer} onTap={onOfferTap} />}
      </div>
    </div>
  );
}

export default function BubblesGrammar({
  items,
  onOfferTap,
}: {
  items: ThreadItem[];
  onOfferTap: (label: string) => void;
}) {
  return (
    <div className="space-y-3 pb-2">
      {items.map((item) => (
        <div key={item.id} className="space-y-1.5">
          <UserBubble text={item.question} />
          <AssistantBubble item={item} onOfferTap={onOfferTap} />
        </div>
      ))}
    </div>
  );
}
