// Resolves a BANK_META key straight to BankBadge props without needing a
// full Account object — every row on this page carries only a bank
// identity string from the backend (DismissedUserRow/EngineRow.bank), not
// a real Account. Mirrors the same logoFile/domain priority
// AccountMiniCard.tsx's accountBrand() uses, and DebtPlanPage.tsx's
// resolveBankChip() takes the same approach for its own key-only bank data.
//
// This is a real (non-preview) copy of app/design/dismissed/bankBadge.tsx.
// That file is marked "delete with the preview route" and is fixture/
// preview-scoped, so this page keeps its own copy rather than importing
// something destined for removal — see PENNY_TOOLS.md-style precedent of
// pages not depending on /design/* internals.

import { BANK_META } from "@/components/AccountMiniCard";

export function bankBadgeProps(key: string | null, size = 26) {
  const meta = key ? BANK_META[key] : undefined;
  if (!meta) {
    return { logoSrc: null, initials: "?", altText: "Unknown bank", brandBg: "#64748b", size };
  }
  const logoSrc = meta.logoFile
    ? `/banks/${meta.logoFile}`
    : meta.domain
    ? `https://www.google.com/s2/favicons?domain=${meta.domain}&sz=64`
    : null;
  return {
    logoSrc,
    initials: meta.initials,
    initialsSize: meta.initialsSize,
    altText: meta.label,
    brandBg: meta.bg,
    size,
  };
}
