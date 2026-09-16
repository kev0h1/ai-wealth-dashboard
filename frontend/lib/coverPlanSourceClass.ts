// The cover-plan source finder's own two-class split (current before
// savings — see backend/app/services/companion.py's `_find_legs_for_
// destination`, class_specs). Pulled out of components/CoverPlanSourcesCard.tsx
// (G51) into its own plain module — no JSX, so it can also be imported by
// lib/spendFromAccount.ts (G110) and by a framework-free node test, the
// same reason lib/cashWalk.ts and lib/accountKind.ts are their own files
// rather than living inside a component.
//
// Deliberately NOT the same classifier as lib/accountKind.ts: that one
// exists for the accounts-ESTATE UI (rows/groups/badges) and puts every
// manual/offline account in its own "Offline" bucket regardless of its real
// type. This one exists for cover-plan SOURCE ranking, where G47's doctrine
// is that an offline account "is the same as a connected account but is
// just manually synced" — it competes within its own real class (current or
// savings), never as a separate third tier — so this classifier reads
// `type`/`subtype` only and has no `manual` special case.

import type { Account } from "@/lib/api";

export type SourceClass = "current" | "savings";

export function sourceClass(account: Account): SourceClass {
  const type = (account.type ?? "").toLowerCase();
  const subtype = (account.subtype ?? "").toLowerCase();
  return type.includes("saving") || subtype.includes("saving") || subtype.includes("isa")
    ? "savings"
    : "current";
}
