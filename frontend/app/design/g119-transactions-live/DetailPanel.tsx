"use client";

// The row-tap detail treatment for all three G119 variants. Faithfully
// ports TeachingSheet.tsx's real fork logic and copy (ENGINE.md
// "Destination Rule": a movement-kind read asks WHERE the money went/came
// from, a spend-kind read asks WHAT category it is) rather than inventing a
// new editor, per the brief. The one deliberate difference from the real
// sheet: every action here writes to LOCAL STATE ONLY — no
// api.patchTransaction / api.resolveMovement / api.addRule call exists
// anywhere in this file — so this can safely run against Kevin's own real,
// authenticated transaction data without ever mutating it. The one
// exception is intentional and still read-only: in "full" layout (Variant
// C) with a live (non-fixture) transaction, choosing "All from X" / "Future
// from X" calls the real api.similarTransactions GET so the scope picker
// shows genuine matches, never a write.
//
// `layout` changes the chrome around this content, not the content itself:
//   sheet   — bottom sheet over the list (Variant A, closest to production)
//   inline  — no chrome, meant to be mounted directly inside an expanded
//             row (Variant B)
//   full    — a dedicated full-bleed screen replacing the list (Variant C)
//
// Design-hook note: the text-[11px]/[12px]/[13px]/[14px] sizes below are
// verbatim copies of TeachingSheet.tsx's own already-shipped type sizes
// (not new steps introduced by this preview) — same reasoning
// app/design/cards-page/CardsPageVariantsClient.tsx's review note gives for
// leaving a verbatim-matched pre-existing size alone rather than drifting
// this port away from the real sheet's proven sizing. Left as-is.

import { useEffect, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Undo2, X } from "lucide-react";
import { api, type Account, type Transaction } from "@/lib/api";
import { getCategoryColour, inferCategoryKind } from "@/lib/categories";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { useColours } from "@/components/ColourProvider";
import { useCategoryIcons } from "@/components/IconProvider";
import { useCategories } from "@/components/CategoriesContext";
import { formatDate } from "@/lib/payPeriod";
import { formatCurrency } from "@/lib/currency";
import { accountBrand, BankBadge } from "@/components/AccountMiniCard";

const MINUS = "−"; // U+2212, never ASCII hyphen-minus — money copy rule

type Layout = "sheet" | "inline" | "full";
type Fork = "spend" | "movement";
type Scope = "single" | "all" | "future";

interface DetailPanelProps {
  transaction: Transaction;
  account?: Account;
  layout: Layout;
  /** True when `transaction` came from the real backend (a real Mongo id) —
   *  gates the one real network read (similar-matches) in "full" layout. */
  isLive: boolean;
  onClose: () => void;
}

export default function DetailPanel({ transaction, account, layout, isLive, onClose }: DetailPanelProps) {
  const { colours } = useColours();
  const { icons: iconOverrides } = useCategoryIcons();
  const { allCategories, customCategories, kinds } = useCategories();

  const originalCategory = transaction.category || "Other";
  const kindOf = (c: string) => kinds[c] ?? inferCategoryKind(c);
  const originalKind = kindOf(originalCategory);
  const isCredit = transaction.transaction_type === "credit";
  const name = transaction.merchant_name || transaction.description || "(no description)";

  const [fork, setFork] = useState<Fork>(originalKind === "movement" ? "movement" : "spend");
  const [viaEscape, setViaEscape] = useState(false);
  const [previewCategory, setPreviewCategory] = useState(originalCategory);
  const [previewNote, setPreviewNote] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [namingText, setNamingText] = useState("");

  const [scope, setScope] = useState<Scope>("single");
  const [similar, setSimilar] = useState<Transaction[] | null>(null);
  const [loadingSimilar, setLoadingSimilar] = useState(false);

  useEffect(() => {
    if (layout !== "full" || scope === "single") {
      setSimilar(null);
      return;
    }
    if (!isLive) {
      // Fixture data has no real match set behind it — say so rather than
      // faking a network round trip.
      setSimilar([]);
      return;
    }
    let active = true;
    setLoadingSimilar(true);
    api.similarTransactions(transaction.id, scope)
      .then((rows) => { if (active) setSimilar(rows); })
      .catch(() => { if (active) setSimilar([]); })
      .finally(() => { if (active) setLoadingSimilar(false); });
    return () => { active = false; };
  }, [layout, scope, isLive, transaction.id]);

  const colour = getCategoryColour(originalCategory, colours);
  const CategoryIcon = getCategoryIcon(originalCategory, iconOverrides);
  const brand = account ? accountBrand(account) : null;

  const spendPickable = allCategories.filter(
    (c) => c !== "Other" && c !== "Income" && kindOf(c) !== "movement" && kindOf(c) !== "income",
  );
  const orderedSpend = [
    ...spendPickable.filter((c) => customCategories.includes(c)),
    ...spendPickable.filter((c) => !customCategories.includes(c)),
  ];

  function chooseCategory(cat: string) {
    setPreviewCategory(cat);
    setPreviewNote(`Would file as ${cat}. Nothing saved — this is a preview.`);
    setNaming(false);
  }

  function chooseMovement(label: string) {
    setPreviewNote(`${label} Nothing saved — this is a preview.`);
  }

  function undoPreview() {
    setPreviewCategory(originalCategory);
    setPreviewNote(null);
  }

  const shell =
    layout === "sheet"
      ? "fixed left-1/2 -translate-x-1/2 w-full max-w-[500px] glass-sheet z-[70] overflow-y-auto bottom-0 rounded-t-3xl slide-up max-h-[88dvh] lg:bottom-auto lg:top-1/2 lg:-translate-y-1/2 lg:rounded-3xl lg:max-h-[85dvh] lg:shadow-2xl"
      : layout === "full"
      ? "min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a]"
      : "bg-slate-50 dark:bg-slate-900/60 rounded-2xl";

  const body = (
    <div className={layout === "sheet" ? "px-5 pb-6 pt-1" : layout === "full" ? "px-4 pt-4 pb-24 max-w-2xl mx-auto" : "p-3"}>
      {/* Preview ribbon — permanent, not dismissible: the one guarantee
          against this being mistaken for the live write surface. */}
      <div className="mb-3 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 px-3 py-2 text-[11px] font-semibold text-indigo-600 dark:text-indigo-300">
        Preview — nothing here is saved to your account.
      </div>

      {/* Header — shared shape across every fork/layout, mirrors
          TeachingSheet.tsx's own header exactly (icon, name, mono amount,
          date, bank badge). */}
      <div className="flex items-center gap-3">
        <span
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: `${colour}26` }}
        >
          <CategoryIcon size={16} style={{ color: colour }} />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-600 dark:text-slate-400 truncate">
            {name}
          </p>
          <p className="text-xl font-bold text-slate-900 dark:text-slate-100 font-mono tabular-nums">
            {isCredit ? "+" : MINUS}
            {formatCurrency(transaction.amount, transaction.currency)}
          </p>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
            {formatDate(transaction.date)}
            {account && brand && (
              <>
                {" · "}
                <BankBadge
                  logoSrc={brand.logoSrc}
                  initials={brand.initials}
                  altText={brand.label}
                  brandBg={brand.background}
                  size={18}
                  initialsSize="7px"
                />
                {account.name}
              </>
            )}
          </p>
        </div>
      </div>

      {/* Spend fork */}
      {fork === "spend" && (
        <>
          <p className="mt-4 text-[13px] text-slate-500 dark:text-slate-400">
            {`I've filed this as ${originalCategory}. Tap a category to see what changing it looks like.`}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {orderedSpend.map((c) => {
              const active = c === previewCategory;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => chooseCategory(c)}
                  className={`min-h-[44px] px-3 flex items-center rounded-full text-[13px] font-semibold active:scale-95 transition-transform ${
                    active
                      ? "bg-indigo-600 text-white ring-2 ring-indigo-300 dark:ring-indigo-400/40"
                      : "bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200"
                  }`}
                >
                  {c}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setNaming(true)}
              className="min-h-[44px] px-3 flex items-center rounded-full text-[13px] font-semibold border border-dashed border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 active:scale-95 transition-transform"
            >
              Something else…
            </button>
          </div>
          {naming && (
            <div className="mt-3 rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 ring-1 ring-indigo-100 dark:ring-indigo-500/20 p-3">
              <input
                autoFocus
                value={namingText}
                onChange={(e) => setNamingText(e.target.value)}
                placeholder="What should I call this?"
                maxLength={40}
                className="w-full h-11 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 px-3 text-[14px] font-semibold text-slate-900 dark:text-slate-100 outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                type="button"
                disabled={!namingText.trim()}
                onClick={() => chooseCategory(namingText.trim())}
                className="mt-2 h-10 px-4 rounded-xl bg-indigo-600 text-white text-[13px] font-semibold active:scale-95 transition-transform disabled:opacity-50"
              >
                Preview this name
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={() => { setViaEscape(true); setFork("movement"); }}
            className="mt-4 inline-flex items-center gap-0.5 text-[12px] font-semibold text-slate-500 dark:text-slate-400 active:opacity-70 transition-opacity"
          >
            This was money I moved
            <ChevronRight size={13} className="flex-shrink-0" aria-hidden="true" />
          </button>
        </>
      )}

      {/* Movement fork, debit — same three destinations + escape hatch as
          TeachingSheet's movement-root, minus the two nested sub-steps
          (goal list / offline-pot naming), which this preview collapses
          into the same one-tap confirmation as the debit-here option, since
          none of the three actually writes anywhere here. */}
      {fork === "movement" && !isCredit && (
        <>
          <p className="mt-4 text-[13px] text-slate-500 dark:text-slate-400">
            {viaEscape
              ? "Money moved has a destination, not a category. Where did it go?"
              : "This looks like money you moved. It left for an account I can't see."}
          </p>
          <p className="mt-3 text-[14px] font-semibold text-slate-900 dark:text-slate-100">
            Is this account yours?
          </p>
          <div className="mt-3 space-y-2">
            <button
              type="button"
              onClick={() => chooseMovement("Would file as a transfer.")}
              className="w-full min-h-[44px] rounded-xl bg-slate-50 dark:bg-slate-700/60 px-3 py-2.5 text-left active:opacity-70 transition-opacity"
            >
              <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">
                Yes: to another of my accounts here
              </span>
              <span className="block text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">filed as a transfer</span>
            </button>
            <button
              type="button"
              onClick={() => chooseMovement("Would file as money funding a goal.")}
              className="w-full min-h-[44px] rounded-xl bg-slate-50 dark:bg-slate-700/60 px-3 py-2.5 text-left active:opacity-70 transition-opacity"
            >
              <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">Yes: it funds a goal</span>
            </button>
            <button
              type="button"
              onClick={() => chooseMovement("Would file as money moved to an account elsewhere.")}
              className="w-full min-h-[44px] rounded-xl bg-slate-50 dark:bg-slate-700/60 px-3 py-2.5 text-left active:opacity-70 transition-opacity"
            >
              <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">
                Yes: just an account of mine elsewhere
              </span>
              <span className="block text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">tracked as an offline pot</span>
            </button>
            <button
              type="button"
              onClick={() => setFork("spend")}
              className="w-full min-h-[44px] rounded-xl bg-slate-50 dark:bg-slate-700/60 px-3 py-2.5 text-left active:opacity-70 transition-opacity"
            >
              <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">No: this was spending</span>
              <span className="block text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">opens the category picker</span>
            </button>
          </div>
        </>
      )}

      {/* Movement fork, credit — mirrors TeachingSheet's credit branch. */}
      {fork === "movement" && isCredit && (
        <>
          <p className="mt-4 text-[13px] text-slate-500 dark:text-slate-400">Money arrived. Where is it from?</p>
          <p className="mt-3 text-[14px] font-semibold text-slate-900 dark:text-slate-100">
            Is this from one of your own accounts?
          </p>
          <div className="mt-3 space-y-2">
            <button
              type="button"
              onClick={() => chooseMovement("Would file as a transfer.")}
              className="w-full min-h-[44px] rounded-xl bg-slate-50 dark:bg-slate-700/60 px-3 py-2.5 text-left active:opacity-70 transition-opacity"
            >
              <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">
                Yes: from another of my accounts
              </span>
              <span className="block text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">filed as a transfer</span>
            </button>
            <button
              type="button"
              onClick={() => chooseMovement("Would file as income.")}
              className="w-full min-h-[44px] rounded-xl bg-slate-50 dark:bg-slate-700/60 px-3 py-2.5 text-left active:opacity-70 transition-opacity"
            >
              <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">No: this was income</span>
            </button>
            <button
              type="button"
              onClick={() => setFork("spend")}
              className="w-full min-h-[44px] rounded-xl bg-slate-50 dark:bg-slate-700/60 px-3 py-2.5 text-left active:opacity-70 transition-opacity"
            >
              <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">No: something else</span>
              <span className="block text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">opens the category picker</span>
            </button>
          </div>
        </>
      )}

      {previewNote && (
        <div className="mt-4 glass-tile rounded-2xl p-4 flex items-center gap-3">
          <span className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
            <Check size={15} className="text-emerald-600 dark:text-emerald-400" />
          </span>
          <p className="flex-1 text-[13px] font-semibold text-slate-800 dark:text-slate-100">{previewNote}</p>
          <button
            type="button"
            onClick={undoPreview}
            className="flex-shrink-0 flex items-center gap-1 text-[12px] font-semibold text-indigo-600 dark:text-indigo-400 active:opacity-70 transition-opacity"
          >
            <Undo2 size={13} />
            Reset
          </button>
        </div>
      )}

      {/* "Apply to" scope — TransactionSheet.tsx's own concept, ported into
          the full-screen layout only (Variant C). With real data this makes
          one genuine read call (GET /transactions/{id}/similar); with
          fixture data it says so instead of faking a network round trip. */}
      {layout === "full" && (
        <div className="mt-6 pt-5 border-t border-slate-200 dark:border-slate-700">
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">
            Apply to
          </p>
          <div className="flex items-center gap-2">
            {(["single", "all", "future"] as Scope[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setScope(s)}
                className={`min-h-[44px] px-3 rounded-full text-[12px] font-semibold transition-colors ${
                  scope === s
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                }`}
              >
                {s === "single" ? "Just this one" : s === "all" ? "All from this merchant" : "Future from this merchant"}
              </button>
            ))}
          </div>
          {scope !== "single" && (
            <div className="mt-3">
              {!isLive ? (
                <p className="text-[12px] text-slate-500 dark:text-slate-400">
                  Real matches appear here once you're signed in — this preview row has no history behind it.
                </p>
              ) : loadingSimilar ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-12 rounded-xl bg-slate-100 dark:bg-slate-700 animate-pulse" />
                  ))}
                </div>
              ) : similar && similar.length > 0 ? (
                <div className="space-y-1 rounded-xl border border-slate-100 dark:border-slate-700 overflow-hidden">
                  {similar.slice(0, 8).map((tx) => (
                    <div key={tx.id} className="flex items-center gap-3 px-3 py-2.5 bg-white dark:bg-slate-800">
                      <span className="flex-1 min-w-0 text-xs font-medium text-slate-700 dark:text-slate-200 truncate">
                        {tx.merchant_name || tx.description}
                      </span>
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 flex-shrink-0">{formatDate(tx.date)}</span>
                      <span className="text-xs font-semibold flex-shrink-0 text-slate-700 dark:text-slate-200">
                        {tx.transaction_type === "credit" ? "+" : MINUS}
                        {formatCurrency(tx.amount, tx.currency)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[12px] text-slate-500 dark:text-slate-400">No similar transactions found.</p>
              )}
            </div>
          )}
        </div>
      )}

      <p className="mt-6 text-center text-[11px] text-slate-600 dark:text-slate-400">
        I learn from every correction, you shouldn&apos;t have to do this twice.
      </p>
    </div>
  );

  if (layout === "sheet") {
    return (
      <>
        <div className="fixed inset-0 bg-black/40 z-[65] fade-in" onClick={onClose} />
        <div className={shell} style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
          <div className="flex justify-center pt-3 pb-1 lg:hidden">
            <div className="w-10 h-1 bg-slate-200 dark:bg-slate-600 rounded-full" />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute top-3 right-3 w-11 h-11 flex items-center justify-center rounded-full text-slate-400 dark:text-slate-500 active:scale-95 transition-transform"
          >
            <X size={18} />
          </button>
          {body}
        </div>
      </>
    );
  }

  if (layout === "full") {
    return (
      <div className={shell}>
        <div className="sticky top-0 z-10 bg-[#f0f2f7]/90 dark:bg-[#0f172a]/90 backdrop-blur-sm border-b border-slate-200/60 dark:border-slate-700/60">
          <div className="px-4 pt-6 pb-3 flex items-center gap-3 max-w-2xl mx-auto">
            <button
              type="button"
              onClick={onClose}
              aria-label="Back to list"
              className="w-11 h-11 flex items-center justify-center rounded-full glass-tile flex-shrink-0 active:scale-95 transition-transform"
            >
              <ChevronLeft size={18} className="text-slate-500 dark:text-slate-400" />
            </button>
            <div>
              <p className="text-xs text-slate-600 dark:text-slate-400 font-medium uppercase tracking-wide">Transaction</p>
              <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Detail</h1>
            </div>
          </div>
        </div>
        {body}
      </div>
    );
  }

  // inline — mounted directly under the tapped row, no backdrop/chrome of
  // its own; the parent row keeps a visible "collapse" affordance.
  return <div className={shell}>{body}</div>;
}
