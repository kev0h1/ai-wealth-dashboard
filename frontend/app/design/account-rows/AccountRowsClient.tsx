"use client";

// TEMPORARY PREVIEW — delete after design review.
// Owner brief (2026-08-30, /accounts phone screenshots): credit-card rows
// look like a different component family to current/savings rows (rose
// balance regardless of state, orphan "owed" line, ragged APR/promo chip
// stack). Three coded variants against the real 7 cards + one no-terms
// fixture. Deep-linkable:
//   /design/account-rows?variant=a|b|c&mode=light|dark

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import CardTermsSheet from "@/components/CardTermsSheet";
import type { CardTermsCard } from "@/lib/api";
import { PINNED, CURRENT, SAVINGS, CREDIT, type RowFixture } from "./fixtures";
import { AccountRow, GroupHeader, Card, SectionLabel } from "./shared";
import { CreditRowA, VARIANT_A_NOTE } from "./VariantA";
import { CreditRowB, VARIANT_B_NOTE } from "./VariantB";
import { CreditRowC, creditGroupCaption, VARIANT_C_NOTE } from "./VariantC";

type Variant = "a" | "b" | "c";
type Mode = "light" | "dark";
const VARIANTS: Variant[] = ["a", "b", "c"];

const NOTES = { a: VARIANT_A_NOTE, b: VARIANT_B_NOTE, c: VARIANT_C_NOTE };

/** Maps a fixture credit card into the shape CardTermsSheet expects, so
 *  tapping a confirmed card's terms genuinely opens the real sheet
 *  (confirmed cards skip the network lookup entirely — see CardTermsSheet's
 *  init effect — so this is safe under this route's no-auth preview
 *  context). The one unconfirmed card (Halifax) DOES fire a real lookup
 *  call and will visibly 401 here, same "let the real failure show"
 *  precedent as /design/spend-verdict-a. */
function toCardTermsCard(row: RowFixture): CardTermsCard {
  return {
    account_id: row.id,
    name: row.name,
    provider: row.provider,
    balance: row.balance,
    currency: "GBP",
    source: "bank",
    ask_eligible: true,
    terms: row.terms
      ? {
          apr_pct: row.terms.apr_pct,
          promos: row.terms.promos.map((p) => ({ kind: "both", apr_pct: p.apr_pct, until: p.until })),
          min_payment_note: null,
          bt_offers: [],
          status: "confirmed",
          confirmed_at: null,
          product_key: null,
          usage: null,
        }
      : null,
  };
}

function VariantSwitch({ variant, mode }: { variant: Variant; mode: Mode }) {
  return (
    <div
      className="fixed left-0 right-0 z-[60] flex justify-center pointer-events-none"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 14px)" }}
    >
      <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-white/15 bg-slate-900/90 p-1 shadow-xl">
        {VARIANTS.map((v) => (
          <a
            key={v}
            href={`?variant=${v}&mode=${mode}`}
            className={`flex min-h-[36px] items-center justify-center rounded-full px-3.5 text-xs font-semibold transition-colors active:scale-95 ${
              v === variant ? "bg-indigo-600 text-white" : "text-slate-400"
            }`}
          >
            {v.toUpperCase()}
          </a>
        ))}
        <a
          href={`?variant=${variant}&mode=${mode === "dark" ? "light" : "dark"}`}
          className="flex min-h-[36px] items-center justify-center rounded-full px-3.5 text-xs font-semibold text-slate-400 active:scale-95 transition-colors"
        >
          {mode === "dark" ? "Light" : "Dark"}
        </a>
      </div>
    </div>
  );
}

function AnnotationPanel({ variant }: { variant: Variant }) {
  const note = NOTES[variant];
  return (
    <div className="glass-card rounded-2xl p-4 space-y-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-500 dark:text-indigo-400">{note.title}</p>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">Red-doctrine position</p>
        <p className="text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">{note.redDoctrine}</p>
      </div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">Where “Add APR” lives</p>
        <p className="text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">{note.addApr}</p>
      </div>
    </div>
  );
}

function Inner() {
  const params = useSearchParams();
  const rawVariant = params.get("variant");
  const variant: Variant = (VARIANTS as string[]).includes(rawVariant ?? "") ? (rawVariant as Variant) : "a";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";

  const [sheetFor, setSheetFor] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      document.documentElement.classList.toggle("dark", mode === "dark");
      document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", mode === "dark" ? "dark" : "only light");
    }, 0);
    return () => clearTimeout(t);
  }, [mode]);

  const cardTermsCards = CREDIT.map(toCardTermsCard);
  const creditCaption = variant === "c" ? creditGroupCaption(CREDIT) : null;

  return (
    <div className={mode === "dark" ? "dark" : ""}>
      <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-32">
        <div className="mx-auto w-full max-w-[430px] px-4 pt-6 space-y-5">
          <div>
            <h1 className="text-[20px] font-bold text-slate-900 dark:text-white">Account rows</h1>
            <p className="mt-1 text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Credit-card row cleanup · owner brief 2026-08-30
            </p>
          </div>

          <AnnotationPanel variant={variant} />

          {/* Pinned */}
          <div>
            <SectionLabel>Pinned</SectionLabel>
            <Card>
              {PINNED.map((row) => (
                <AccountRow key={row.id} row={row} />
              ))}
            </Card>
          </div>

          {/* Current */}
          <div>
            <GroupHeader label="Current" rows={CURRENT} />
            <Card>
              {CURRENT.map((row) => (
                <AccountRow key={row.id} row={row} />
              ))}
            </Card>
          </div>

          {/* Savings */}
          <div>
            <GroupHeader label="Savings" rows={SAVINGS} />
            <Card>
              {SAVINGS.map((row) => (
                <AccountRow key={row.id} row={row} />
              ))}
            </Card>
          </div>

          {/* Credit cards */}
          <div>
            <GroupHeader label="Credit cards" rows={CREDIT} />
            {creditCaption && (
              <p className="px-1 -mt-1 mb-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                {creditCaption.amber && (
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 dark:bg-amber-500 mr-1.5 align-middle" aria-hidden="true" />
                )}
                {creditCaption.text}
              </p>
            )}
            <Card>
              {CREDIT.map((row) => {
                const openSheet = () => setSheetFor(row.id);
                if (variant === "a") return <CreditRowA key={row.id} row={row} onAddApr={openSheet} />;
                if (variant === "b") return <CreditRowB key={row.id} row={row} onTermsClick={openSheet} onAddApr={openSheet} />;
                return <CreditRowC key={row.id} row={row} onAddApr={openSheet} />;
              })}
            </Card>
          </div>
        </div>

        <VariantSwitch variant={variant} mode={mode} />
      </div>

      {sheetFor && (
        <CardTermsSheet
          cards={cardTermsCards}
          ready={true}
          startAccountId={sheetFor}
          onClose={() => setSheetFor(null)}
          onSaved={() => {}}
        />
      )}
    </div>
  );
}

export default function AccountRowsClient() {
  return <Inner />;
}
