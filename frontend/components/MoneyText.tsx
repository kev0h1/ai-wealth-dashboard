import type { ReactNode } from "react";
import { CURRENCY_TOKEN, isCurrencyToken } from "@/lib/moneyText";

// Tokenising regex + comma/full-stop handling live in lib/moneyText.ts
// (G112, 2026-09-16) so they can be unit-tested with a plain Node script;
// see that file's header comment for the money-is-mono rule and the
// comma/decimal fix, and scripts/money-text-comma.test.mjs for the tests.

export default function MoneyText({
  text,
  className,
}: {
  text: string;
  className?: string;
}): ReactNode {
  // .match() with a /g regex always scans from index 0 and leaves no
  // lastIndex state behind, unlike .test(), which would otherwise corrupt
  // the shared module-level CURRENCY_TOKEN across renders.
  if (!text.match(CURRENCY_TOKEN)) {
    return className ? <span className={className}>{text}</span> : <>{text}</>;
  }

  const parts = text.split(CURRENCY_TOKEN);
  const content = parts.map((part, i) =>
    isCurrencyToken(part) ? (
      <span key={i} className="money">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    )
  );

  // Always a single wrapping element, never a bare Fragment of sibling
  // spans: a flex/inline-flex parent (e.g. a chip button with
  // `flex items-center`) treats each of those siblings as its own flex
  // item, which trims the leading/trailing whitespace at every span
  // boundary and collapses "Can I spend £40 this weekend?" down to
  // "Can I spend£40this weekend?". Wrapping in one <span> (with or without
  // a caller-supplied className) keeps the multi-part output inert to
  // flex/grid ancestors — it was already the effective behaviour whenever a
  // caller passed a className (see GroceryBasketCard's flex-1 usage), this
  // just makes it unconditional so no call site can regress into the flex
  // hazard by omitting className.
  return <span className={className}>{content}</span>;
}
