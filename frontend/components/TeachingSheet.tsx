"use client";

// The Engine's teaching surface (ENGINE.md "Input Contract" + "The Destination
// Rule") — the real sheet that replaces the /design/spend-b mockup and absorbs
// TransactionSheet's recategorise flow wherever categorisation is the point.
//
// Progressive disclosure, two forks decided by the transaction's CURRENT
// category kind (backend/app/services/categories.py via CategoriesContext):
//   - movement-kind read  -> "Is this account yours?" (goal / offline pot /
//     "no, this was spending" / "no, someone else") -> POST
//     /transactions/{id}/resolve-movement
//   - spend-kind read     -> category picker, user vocabulary first,
//     "Something else…" born-in-context naming (spend-only kinds, per the
//     Destination Rule — movement never gets named inline) -> PATCH
//     /transactions/{id}
// A spend-fork escape hatch ("This was money I moved") and a movement-fork
// "No — this was spending" option let the two forks reach each other, so a
// mis-filed transaction can move either direction in one sheet.
//
// After a spend commit, the propagation offer reads {matches_past,
// rule_suggestion} straight off the PATCH response (no second round-trip) —
// "Always file X as Y?" -> POST /rules; either choice ends on an undo toast
// that reverts the categorisation (and the rule, if one was saved).

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X, Check, Undo2 } from "lucide-react";
import { Transaction, Commitment, api } from "@/lib/api";
import { useLockBodyScroll } from "@/lib/useLockBodyScroll";
import { useSheetOpen } from "@/lib/useSheetOpen";
import { useSheetA11y } from "@/lib/useSheetA11y";
import { getCategoryColour, inferCategoryKind, type CategoryKind } from "@/lib/categories";
import { useColours } from "@/components/ColourProvider";
import { useCategories } from "@/components/CategoriesContext";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { useCategoryIcons } from "@/components/IconProvider";
import { formatDate } from "@/lib/payPeriod";
import { formatCurrency } from "@/lib/currency";

const MINUS = "−"; // U+2212, never ASCII hyphen-minus, for money (copy rule)

type Step =
  | "spend-root"
  | "spend-naming"
  | "movement-root"
  | "movement-goal"
  | "movement-offline"
  | "movement-someone"
  | "propose-rule"
  | "done";

interface TeachingSheetProps {
  transaction: Transaction;
  onClose: () => void;
  /** Mirrors TransactionSheet's contract so existing callers (SpendPage's
   *  cache invalidation / verdict refetch) plug in unchanged. */
  onUpdated: (tx: Transaction, additionalIds?: string[]) => void;
  account?: { name: string; provider: string };
  /** Opens straight on "Is this account yours?" instead of the category
   *  picker, without changing what `transaction.category` says (so the
   *  header/undo copy stays honest). For the Spend ask card's "Tell me
   *  what this was": the row is genuinely unresolved ("Other"), and for a
   *  payment the engine cannot place, the Destination Rule's movement
   *  question is the better first question — not a synthesised category
   *  guess. Keeps preview (/design/spend-live) and production identical:
   *  both now land on movement-root for the ask handoff. */
  forceMovementRoot?: boolean;
}

export default function TeachingSheet({ transaction, onClose, onUpdated, account, forceMovementRoot }: TeachingSheetProps) {
  useLockBodyScroll();
  useSheetOpen();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const panelRef = useSheetA11y<HTMLDivElement>(onClose);

  const { colours } = useColours();
  const { icons: iconOverrides } = useCategoryIcons();
  const { allCategories, customCategories, kinds, addCategory } = useCategories();

  const originalCategory = transaction.category || "Other";
  const originalKind = kinds[originalCategory] ?? inferCategoryKind(originalCategory);
  const isMovementRead = originalKind === "movement";
  const isCredit = transaction.transaction_type === "credit";
  const name = transaction.merchant_name || transaction.description || "(no description)";
  // The ask card's "Tell me what this was" hands off here without any
  // movement-kind read behind it (the row is genuinely "Other") — asserting
  // "this looks like money you moved" would be a claim the engine hasn't
  // earned. Ask the question honestly instead of asserting the answer.
  const isAskHandoff = forceMovementRoot && !isMovementRead;

  const [step, setStep] = useState<Step>(isMovementRead || forceMovementRoot ? "movement-root" : "spend-root");
  // True once the movement fork was reached via the spend fork's escape
  // hatch (not because the row was already filed as movement) — suppresses
  // the redundant "No — this was spending" option and shows a back link.
  const [viaEscape, setViaEscape] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [goals, setGoals] = useState<Commitment[] | null>(null);
  // Distinct from "genuinely none" (goals === []) — a failed read must never
  // collapse into the empty-state copy, which would push the user toward
  // creating a duplicate offline pot for a goal that actually exists.
  const [goalsFailed, setGoalsFailed] = useState(false);
  const [goalFallbackOpen, setGoalFallbackOpen] = useState(false);
  const [goalFallbackName, setGoalFallbackName] = useState("");
  useEffect(() => {
    if (step !== "movement-goal" || goals !== null || goalsFailed) return;
    api.listCommitments()
      .then((r) => setGoals(r.items.filter((c) => c.status === "active")))
      .catch(() => setGoalsFailed(true));
  }, [step, goals, goalsFailed]);

  const [offlineName, setOfflineName] = useState("");
  const [someoneNote, setSomeoneNote] = useState("");

  const [namingText, setNamingText] = useState("");
  const [namingKind, setNamingKind] = useState<CategoryKind>("discretionary");
  useEffect(() => {
    if (step !== "spend-naming") return;
    const guess = inferCategoryKind(namingText);
    setNamingKind(guess === "movement" ? "discretionary" : guess);
  }, [namingText, step]);

  const [proposal, setProposal] = useState<{ category: string; matchesPast: number; pattern: string } | null>(null);
  const [toast, setToast] = useState<{ message: string; undo: () => void | Promise<void> } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  function finish(message: string, undo: () => void | Promise<void>) {
    setStep("done");
    setToast({ message, undo });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(onClose, 5000);
  }

  // ── Spend fork: existing category or newly-named one ──────────────────
  // Whenever the row is CURRENTLY a movement-kind read, route through
  // resolve-movement's "spending" branch instead of a plain PATCH — that
  // branch also unsets any linked_goal_id/linked_offline_account_id, so a
  // reverted movement doesn't leave a stale destination link behind.
  async function commitSpend(category: string) {
    setBusy(true);
    setError(null);
    try {
      if (isMovementRead) {
        await api.resolveMovement(transaction.id, { resolution: "spending", category });
        onUpdated({ ...transaction, category });
        finish(`Filed as ${category}.`, () => undoToSpend(category));
        return;
      }
      const res = await api.patchTransaction(transaction.id, { category });
      onUpdated({ ...transaction, category });
      if (res.matches_past > 0 && res.rule_suggestion) {
        setProposal({ category, matchesPast: res.matches_past, pattern: res.rule_suggestion.pattern });
        setStep("propose-rule");
      } else {
        finish(`Filed as ${category}.`, () => undoToSpend(category));
      }
    } catch {
      setError("That didn't save — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function undoToSpend(_appliedCategory: string) {
    try {
      if (isMovementRead) {
        await api.resolveMovement(transaction.id, { resolution: "spending", category: originalCategory });
      } else {
        await api.patchTransaction(transaction.id, { category: originalCategory });
      }
      onUpdated({ ...transaction, category: originalCategory });
    } catch {
      // Undo failing quietly is the least-bad outcome here — the sheet is
      // already closing and there's no surface left to report to.
    }
  }

  async function handleSaveNewCategory() {
    const trimmed = namingText.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await addCategory(trimmed, namingKind);
      await commitSpend(trimmed);
    } catch {
      setError("Couldn't save that name — try a different one.");
      setBusy(false);
    }
  }

  // ── Movement fork: destination resolutions ─────────────────────────────
  async function commitMovement(
    resolution: "mine-goal" | "mine-offline" | "someone-else",
    extra: { goal_id?: string; offline_pot_name?: string; note?: string },
    successMessage: string,
  ) {
    setBusy(true);
    setError(null);
    try {
      await api.resolveMovement(transaction.id, { resolution, ...extra });
      onUpdated({ ...transaction, category: resolution === "someone-else" ? originalCategory : "Transfer" });
      finish(successMessage, undoMovement);
    } catch {
      setError("That didn't save — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function undoMovement() {
    try {
      await api.resolveMovement(transaction.id, { resolution: "spending", category: originalCategory });
      onUpdated({ ...transaction, category: originalCategory });
    } catch {
      // see undoToSpend
    }
  }

  // ── Propagation offer ───────────────────────────────────────────────────
  async function handleAlways() {
    if (!proposal) return;
    setBusy(true);
    try {
      const merchantLabel = name;
      const saved = await api.addRule(`${merchantLabel} → ${proposal.category}`, proposal.pattern, proposal.category);
      finish("Filed and rule saved. Undo", async () => {
        await undoToSpend(proposal.category);
        try { await api.deleteRule(saved.id); } catch { /* best-effort */ }
        // Revert every sibling row the rule bulk-recategorised too — without
        // this, "Undo" only touched the primary transaction and left the
        // rest silently mis-filed (fix-round HIGH finding).
        await Promise.all(
          (saved.affected || [])
            .filter((a) => a.id !== transaction.id)
            .map((a) =>
              api.patchTransaction(a.id, { category: a.previous_category || "Other" }).catch(() => {
                /* best-effort — see undoToSpend */
              }),
            ),
        );
      });
    } catch {
      // Rule save failed (e.g. free-tier gate) — the categorisation itself
      // already succeeded, so still land on a clean undo toast rather than
      // stranding the user on the propagation card.
      finish("Filed.", () => undoToSpend(proposal.category));
    } finally {
      setBusy(false);
    }
  }

  function handleJustThisOnce() {
    if (!proposal) return;
    finish("Filed.", () => undoToSpend(proposal.category));
  }

  if (!mounted) return null;

  const colour = getCategoryColour(originalCategory, colours);
  const CategoryIcon = getCategoryIcon(originalCategory, iconOverrides);

  // kinds populates async from GET /categories and fails open to {} on a
  // slow/failed fetch — fall back to inferCategoryKind so an unresolved
  // fetch never lets movement/income categories leak into the spend picker
  // (the Destination Rule). "Income" is an explicit name exclusion: it
  // matches no MOVEMENT_PATTERN and would otherwise infer discretionary.
  const kindOf = (c: string) => kinds[c] ?? inferCategoryKind(c);
  const spendPickable = allCategories.filter(
    (c) => c !== "Other" && c !== "Income" && kindOf(c) !== "movement" && kindOf(c) !== "income",
  );
  const orderedSpend = [
    ...spendPickable.filter((c) => customCategories.includes(c)),
    ...spendPickable.filter((c) => !customCategories.includes(c)),
  ];

  return createPortal(
    <>
      <div className="fixed inset-0 bg-black/40 z-[65] fade-in" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Tell me what this was"
        className="fixed left-1/2 -translate-x-1/2 w-full max-w-[500px] glass-sheet z-[70] overflow-y-auto
                    bottom-0 rounded-t-3xl slide-up max-h-[88dvh]
                    lg:bottom-auto lg:top-1/2 lg:-translate-y-1/2 lg:rounded-3xl lg:max-h-[85dvh] lg:shadow-2xl"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
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

        <div className="px-5 pb-6 pt-1">
          {/* 1. Transaction header — shared shape across every step */}
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
              <p className="text-xl font-bold text-slate-900 dark:text-slate-100">
                {isCredit ? "+" : MINUS}
                {formatCurrency(transaction.amount, transaction.currency)}
              </p>
              <p className="text-[13px] text-slate-500 dark:text-slate-400">
                {formatDate(transaction.date)}
                {account ? ` · ${account.name}` : ""}
              </p>
            </div>
          </div>

          {/* 2/3. The step content */}
          {step === "movement-root" && (
            <>
              <p className="mt-4 text-[13px] text-slate-500 dark:text-slate-400">
                {viaEscape
                  ? "Money moved has a destination, not a category — where did it go?"
                  : isAskHandoff
                  ? "I can't place this one yet — I don't know enough to guess, so I'm asking."
                  : "This looks like money you moved — it left for an account I can't see."}
              </p>
              <p className="mt-3 text-[14px] font-semibold text-slate-900 dark:text-slate-100">
                Is this account yours?
              </p>
              <div className="mt-3 space-y-2">
                <button
                  type="button"
                  onClick={() => setStep("movement-goal")}
                  className="w-full min-h-[44px] rounded-xl bg-slate-50 dark:bg-slate-700/60 px-3 py-2.5 text-left active:opacity-70 transition-opacity"
                >
                  <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">
                    Yes — it funds a goal
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setStep("movement-offline")}
                  className="w-full min-h-[44px] rounded-xl bg-slate-50 dark:bg-slate-700/60 px-3 py-2.5 text-left active:opacity-70 transition-opacity"
                >
                  <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">
                    Yes — just an account of mine elsewhere
                  </span>
                  <span className="block text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                    tracked as an offline pot
                  </span>
                </button>
                {!viaEscape && (
                  <button
                    type="button"
                    onClick={() => { setViaEscape(false); setStep("spend-root"); }}
                    className="w-full min-h-[44px] rounded-xl bg-slate-50 dark:bg-slate-700/60 px-3 py-2.5 text-left active:opacity-70 transition-opacity"
                  >
                    <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">
                      No — this was spending
                    </span>
                    <span className="block text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                      opens the category picker
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setStep("movement-someone")}
                  className="w-full min-h-[44px] rounded-xl bg-slate-50 dark:bg-slate-700/60 px-3 py-2.5 text-left active:opacity-70 transition-opacity"
                >
                  <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">
                    No — it went to someone else
                  </span>
                </button>
              </div>
              {viaEscape && (
                <button
                  type="button"
                  onClick={() => setStep("spend-root")}
                  className="mt-3 text-[12px] font-semibold text-slate-500 dark:text-slate-400 active:opacity-70 transition-opacity"
                >
                  ← Back to categories
                </button>
              )}
            </>
          )}

          {step === "movement-goal" && (
            <>
              <p className="mt-4 text-[13px] text-slate-500 dark:text-slate-400">Which goal does this fund?</p>
              {goalsFailed ? (
                <>
                  <p className="mt-3 text-[12px] font-semibold text-red-600 dark:text-red-400" role="alert">
                    I couldn&apos;t check your goals just now — try again in a moment.
                  </p>
                  <button
                    type="button"
                    onClick={() => setGoalsFailed(false)}
                    className="mt-2 text-[12px] font-semibold text-indigo-600 dark:text-indigo-400 active:opacity-70 transition-opacity"
                  >
                    Try again
                  </button>
                </>
              ) : goals === null ? (
                <p className="mt-3 text-[13px] text-slate-600 dark:text-slate-400">Loading your goals…</p>
              ) : goals.length === 0 ? (
                <p className="mt-3 text-[13px] text-slate-600 dark:text-slate-400">No active goals yet — name this pot below.</p>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  {goals.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      disabled={busy}
                      onClick={() => commitMovement("mine-goal", { goal_id: g.id }, `Filed as money to ${g.name}.`)}
                      className="min-h-[44px] px-3 flex items-center rounded-full text-[13px] font-semibold bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 active:scale-95 transition-transform disabled:opacity-50"
                    >
                      {g.name}
                    </button>
                  ))}
                </div>
              )}
              {/* Goals-read failure never offers the offline-pot escape as the
                  primary route — the four-live-goals-collapse-to-zero bug
                  this guards against would otherwise steer straight into a
                  duplicate pot. Only a genuinely-empty read (goals.length ===
                  0) or a successful load offers it. */}
              {!goalsFailed && (!goalFallbackOpen ? (
                <button
                  type="button"
                  onClick={() => setGoalFallbackOpen(true)}
                  className="mt-3 text-[12px] font-semibold text-indigo-600 dark:text-indigo-400 active:opacity-70 transition-opacity"
                >
                  My goal isn't listed →
                </button>
              ) : (
                <div className="mt-3 flex items-center gap-2">
                  <input
                    autoFocus
                    value={goalFallbackName}
                    onChange={(e) => setGoalFallbackName(e.target.value)}
                    placeholder="Name this pot"
                    maxLength={60}
                    className="flex-1 h-11 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 px-3 text-[14px] text-slate-900 dark:text-slate-100 outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <button
                    type="button"
                    disabled={busy || !goalFallbackName.trim()}
                    onClick={() => commitMovement("mine-offline", { offline_pot_name: goalFallbackName.trim() }, "Filed as money you moved.")}
                    className="flex-shrink-0 h-11 px-4 rounded-xl bg-indigo-600 text-white text-[13px] font-semibold active:scale-95 transition-transform disabled:opacity-50"
                  >
                    Save
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setStep("movement-root")}
                className="mt-4 block text-[12px] font-semibold text-slate-500 dark:text-slate-400 active:opacity-70 transition-opacity"
              >
                ← Back
              </button>
            </>
          )}

          {step === "movement-offline" && (
            <>
              <p className="mt-4 text-[13px] text-slate-500 dark:text-slate-400">
                What should I call this account? (optional)
              </p>
              <input
                autoFocus
                value={offlineName}
                onChange={(e) => setOfflineName(e.target.value)}
                placeholder="e.g. Premium Bonds"
                maxLength={60}
                className="mt-3 w-full h-11 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 px-3 text-[14px] text-slate-900 dark:text-slate-100 outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => commitMovement("mine-offline", { offline_pot_name: offlineName.trim() || undefined }, "Filed as money you moved.")}
                  className="h-11 px-4 rounded-xl bg-indigo-600 text-white text-[13px] font-semibold active:scale-95 transition-transform disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setStep("movement-root")}
                  className="text-[12px] font-semibold text-slate-500 dark:text-slate-400 active:opacity-70 transition-opacity"
                >
                  ← Back
                </button>
              </div>
            </>
          )}

          {step === "movement-someone" && (
            <>
              <p className="mt-4 text-[13px] text-slate-500 dark:text-slate-400">
                Who was it for? (optional, up to 50 characters)
              </p>
              <input
                autoFocus
                value={someoneNote}
                onChange={(e) => setSomeoneNote(e.target.value.slice(0, 50))}
                placeholder="e.g. my mum's rent"
                maxLength={50}
                className="mt-3 w-full h-11 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 px-3 text-[14px] text-slate-900 dark:text-slate-100 outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => commitMovement(
                    "someone-else",
                    { note: someoneNote.trim() || undefined },
                    // The backend only excludes this from spend when the row
                    // was ALREADY movement-kind — reached via the spend
                    // fork's escape hatch, it keeps its original spend-kind
                    // category (backend/app/routers/transactions.py
                    // resolve_movement's someone-else branch), so it still
                    // counts as spending. Promising otherwise there was a
                    // false-reassurance bug (fix-round MEDIUM finding).
                    isMovementRead ? "Noted — it won't count as spending." : `Noted — still filed as ${originalCategory}.`,
                  )}
                  className="h-11 px-4 rounded-xl bg-indigo-600 text-white text-[13px] font-semibold active:scale-95 transition-transform disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setStep("movement-root")}
                  className="text-[12px] font-semibold text-slate-500 dark:text-slate-400 active:opacity-70 transition-opacity"
                >
                  ← Back
                </button>
              </div>
            </>
          )}

          {step === "spend-root" && (
            <>
              <p className="mt-4 text-[13px] text-slate-500 dark:text-slate-400">
                I&apos;ve filed this as {originalCategory} — correct it and I learn.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {orderedSpend.map((c) => {
                  const active = c === originalCategory;
                  return (
                    <button
                      key={c}
                      type="button"
                      disabled={busy}
                      onClick={() => commitSpend(c)}
                      className={`min-h-[44px] px-3 flex items-center rounded-full text-[13px] font-semibold active:scale-95 transition-transform disabled:opacity-50 ${
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
                  onClick={() => setStep("spend-naming")}
                  className="min-h-[44px] px-3 flex items-center rounded-full text-[13px] font-semibold border border-dashed border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 active:scale-95 transition-transform"
                >
                  Something else…
                </button>
              </div>
              <button
                type="button"
                onClick={() => { setViaEscape(true); setStep("movement-root"); }}
                className="mt-4 text-[12px] font-semibold text-slate-500 dark:text-slate-400 active:opacity-70 transition-opacity"
              >
                This was money I moved →
              </button>
            </>
          )}

          {step === "spend-naming" && (
            <>
              <div className="mt-4 rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 ring-1 ring-indigo-100 dark:ring-indigo-500/20 p-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-500 dark:text-indigo-300">
                  New category
                </p>
                <input
                  autoFocus
                  value={namingText}
                  onChange={(e) => setNamingText(e.target.value)}
                  placeholder="What should I call this?"
                  maxLength={40}
                  className="mt-1.5 w-full h-11 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 px-3 text-[14px] font-semibold text-slate-900 dark:text-slate-100 outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <div className="mt-2.5 flex items-center gap-2">
                  <button
                    type="button"
                    aria-pressed={namingKind === "discretionary"}
                    onClick={() => setNamingKind("discretionary")}
                    className={`min-h-[36px] px-3 rounded-full text-[12px] font-semibold transition-colors ${
                      namingKind === "discretionary"
                        ? "bg-indigo-600 text-white"
                        : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                    }`}
                  >
                    Everyday spending
                  </button>
                  <button
                    type="button"
                    aria-pressed={namingKind === "commitment"}
                    onClick={() => setNamingKind("commitment")}
                    className={`min-h-[36px] px-3 rounded-full text-[12px] font-semibold transition-colors ${
                      namingKind === "commitment"
                        ? "bg-indigo-600 text-white"
                        : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                    }`}
                  >
                    A bill I have to pay
                  </button>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy || !namingText.trim()}
                  onClick={handleSaveNewCategory}
                  className="h-11 px-4 rounded-xl bg-indigo-600 text-white text-[13px] font-semibold active:scale-95 transition-transform disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setStep("spend-root")}
                  className="text-[12px] font-semibold text-slate-500 dark:text-slate-400 active:opacity-70 transition-opacity"
                >
                  ← Back
                </button>
              </div>
            </>
          )}

          {step === "propose-rule" && proposal && (
            <div className="mt-4 glass-tile rounded-2xl p-4">
              <p className="text-[14px] font-bold text-slate-900 dark:text-slate-100 leading-snug">
                Always file {name} as{" "}
                <span className="text-indigo-600 dark:text-indigo-400">{proposal.category}</span>?
              </p>
              <p className="mt-1 text-[12px] text-slate-600 dark:text-slate-400">
                Matches {proposal.matchesPast} past payment{proposal.matchesPast !== 1 ? "s" : ""} · will catch future ones
              </p>
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleAlways}
                  className="flex-1 h-11 rounded-xl bg-indigo-600 text-white text-[13px] font-semibold active:scale-95 transition-transform disabled:opacity-50"
                >
                  Always
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleJustThisOnce}
                  className="flex-1 h-11 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[13px] font-semibold active:scale-95 transition-transform disabled:opacity-50"
                >
                  Just this once
                </button>
              </div>
              <p className="mt-2 text-[11px] text-slate-600 dark:text-slate-400">
                You can undo this any time.
              </p>
            </div>
          )}

          {step === "done" && toast && (
            <div className="mt-4 glass-tile rounded-2xl p-4 flex items-center gap-3">
              <span className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
                <Check size={15} className="text-emerald-600 dark:text-emerald-400" />
              </span>
              <p className="flex-1 text-[13px] font-semibold text-slate-800 dark:text-slate-100">{toast.message}</p>
              <button
                type="button"
                onClick={async () => {
                  if (toastTimer.current) clearTimeout(toastTimer.current);
                  await toast.undo();
                  onClose();
                }}
                className="flex-shrink-0 flex items-center gap-1 text-[12px] font-semibold text-indigo-600 dark:text-indigo-400 active:opacity-70 transition-opacity"
              >
                <Undo2 size={13} />
                Undo
              </button>
            </div>
          )}

          {error && (
            <p className="mt-3 text-[12px] font-semibold text-red-600 dark:text-red-400" role="alert">{error}</p>
          )}

          {/* Footer whisper — every step, first person, never "the engine" */}
          {step !== "done" && (
            <p className="mt-4 text-center text-[11px] text-slate-600 dark:text-slate-400">
              I learn from every correction — you shouldn&apos;t have to do this twice.
            </p>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
