"use client";

// TEMPORARY PREVIEW helper — resolves a BANK_META key straight to BankBadge
// props without needing a full Account object (the fixtures here aren't
// real accounts, just a bank identity per row). Logo resolution itself is
// shared via bankLogoSrc() (A34, 2026-09-14).
// Imported only from client components in this preview route; never from
// app/design/dismissed/page.tsx (server component, see its own comment).

import { BANK_META, bankLogoSrc } from "@/components/AccountMiniCard";

export function bankBadgeProps(key: string, size = 30) {
  const meta = BANK_META[key];
  if (!meta) {
    return { logoSrc: null, initials: "?", altText: "Unknown bank", brandBg: "#64748b", size };
  }
  const logoSrc = bankLogoSrc(meta);
  return {
    logoSrc,
    initials: meta.initials,
    initialsSize: meta.initialsSize,
    altText: meta.label,
    brandBg: meta.bg,
    size,
  };
}

export function bankLabel(key: string): string {
  return BANK_META[key]?.label ?? "Account";
}
