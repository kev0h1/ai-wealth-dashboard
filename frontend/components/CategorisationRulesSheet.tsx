"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeftRight, CreditCard, ReceiptText, SlidersHorizontal } from "lucide-react";
import { SheetFrame } from "@/components/SheetFrame";
import PennyMark from "@/components/PennyMark";
import { api, ApiError } from "@/lib/api";

type Rule = Awaited<ReturnType<typeof api.getRules>>["rules"][number];

type RulesProps = {
  ruleId?: string;
  onRuleRemoved?: (id: string) => void;
  onBusyChange?: (busy: boolean) => void;
};

type SheetProps = Omit<RulesProps, "onBusyChange"> & {
  onClose: () => void;
  rulesOnly?: boolean;
  nested?: boolean;
};

const linkAction = "min-h-11 rounded-lg px-1 text-sm font-semibold text-indigo-700 hover:underline disabled:opacity-50 dark:text-indigo-300";
const secondaryAction = "min-h-11 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700";

export function CategoryRulesPanel({ ruleId, onRuleRemoved, onBusyChange }: RulesProps) {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loadRevision, setLoadRevision] = useState(0);
  const [removeError, setRemoveError] = useState(false);
  const [notice, setNotice] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const deleting = useRef(false);
  const keepButton = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const focusAfterCancel = useRef<string | null>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const actionId = useId();

  useEffect(() => {
    let active = true;
    api.getRules().then(result => {
      if (active) setRules(result.rules);
    }).catch(() => {
      if (active) setLoadError(true);
    });
    return () => { active = false; };
  }, [loadRevision]);

  useEffect(() => {
    if (confirmId) keepButton.current?.focus({ preventScroll: true });
    else if (focusAfterCancel.current) {
      document.getElementById(`${actionId}-${focusAfterCancel.current}`)?.focus();
      focusAfterCancel.current = null;
    }
  }, [actionId, confirmId]);

  useEffect(() => {
    if (notice) statusRef.current?.focus({ preventScroll: true });
    else if (removeError) confirmButton.current?.focus({ preventScroll: true });
  }, [notice, removeError]);

  const visibleRules = (rules ?? []).filter(rule => !ruleId || rule.id === ruleId);

  async function removeRule(id: string) {
    if (deleting.current) return;
    deleting.current = true;
    setRemoving(true);
    onBusyChange?.(true);
    setRemoveError(false);
    setNotice("");
    try {
      try {
        await api.deleteRule(id);
      } catch (error) {
        // A lost response can be retried after the rule was already removed.
        if (!(error instanceof ApiError && error.status === 404)) throw error;
      }
      setRules(current => current?.filter(rule => rule.id !== id) ?? current);
      setConfirmId(null);
      setNotice("Future filing rule removed. Booked payments keep their categories.");
      onRuleRemoved?.(id);
    } catch {
      setRemoveError(true);
    } finally {
      deleting.current = false;
      setRemoving(false);
      onBusyChange?.(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">Rules file new matching payments. Booked payments keep their categories when you remove a rule.</p>
      <p ref={statusRef} tabIndex={-1} role="status" className={notice ? "rounded-xl bg-slate-100 p-3 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200" : "sr-only"}>{notice}</p>
      {loadError ? (
        <div className="rounded-xl border border-slate-200 p-3 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-200">
          <p role="alert">Rules could not be loaded. Try again.</p>
          <button
            type="button"
            className={linkAction}
            onClick={() => { setLoadError(false); setLoadRevision(revision => revision + 1); }}
          >
            Try again
          </button>
        </div>
      ) : rules === null ? (
        <p role="status" className="text-sm text-slate-600 dark:text-slate-300">Loading rules…</p>
      ) : visibleRules.length === 0 && !notice ? (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {ruleId ? "This future filing rule is no longer available." : "You have no category rules yet."}
        </p>
      ) : null}
      {visibleRules.length > 0 && (
        <ul className="space-y-3">
          {visibleRules.map(rule => (
            <li key={rule.id} className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
              <p className="break-words text-sm font-semibold text-slate-900 dark:text-slate-100">{rule.description}</p>
              <p className="mt-1 break-words text-sm text-slate-600 dark:text-slate-300">New matching payments file as {rule.category}.</p>
              {confirmId === rule.id ? (
                <div className="mt-3 space-y-3">
                  <p className="text-sm text-slate-700 dark:text-slate-200">Remove this future filing rule?</p>
                  {removeError && <p role="alert" className="text-sm text-slate-700 dark:text-slate-200">The rule could not be removed. Try again.</p>}
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" ref={keepButton} disabled={removing} className={secondaryAction} onClick={() => {
                      focusAfterCancel.current = rule.id;
                      setConfirmId(null);
                    }}>
                      Keep rule
                    </button>
                    <button type="button" ref={confirmButton} disabled={removing} className="min-h-11 rounded-xl bg-indigo-600 px-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50" onClick={() => void removeRule(rule.id)}>
                      {removing ? "Removing…" : "Remove rule"}
                    </button>
                  </div>
                </div>
              ) : (
                <button id={`${actionId}-${rule.id}`} type="button" className={linkAction} disabled={removing} onClick={() => {
                  setNotice("");
                  setRemoveError(false);
                  setConfirmId(rule.id);
                }}>
                  Remove rule
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function CategorisationRulesSheet({ onClose, rulesOnly, nested, ruleId, onRuleRemoved }: SheetProps) {
  const [busy, setBusy] = useState(false);
  if (!rulesOnly) return <CategorisationExplainer onClose={onClose} />;

  return (
    <SheetFrame
      title={ruleId ? "Future filing rule" : "Category rules"}
      onClose={onClose}
      nested={nested}
      dismissDisabled={busy}
      footer={({ close }) => (
        <button type="button" disabled={busy} onClick={close} className={`${secondaryAction} w-full`}>
          Done
        </button>
      )}
    >
      <CategoryRulesPanel ruleId={ruleId} onRuleRemoved={onRuleRemoved} onBusyChange={setBusy} />
    </SheetFrame>
  );
}

function CategorisationExplainer({ onClose }: Pick<SheetProps, "onClose">) {
  return (
    <SheetFrame title="How we categorise your money" onClose={onClose}>

        {/* Penny explainer */}
        <div className="mb-4 glass-card rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <span
              className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-white rounded-full px-2.5 py-1"
              style={{ background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)" }}
            >
              <PennyMark size={11} />
              Penny
            </span>
          </div>
          <p className="text-[14px] text-slate-700 dark:text-slate-200 leading-relaxed">
            Money moving between your own accounts isn&apos;t spending, it should be a{" "}
            <strong className="font-semibold text-slate-900 dark:text-slate-100">Transfer</strong>{" "}
            (or <strong className="font-semibold text-slate-900 dark:text-slate-100">Savings</strong>{" "}
            if it&apos;s going to a savings account, <strong className="font-semibold text-slate-900 dark:text-slate-100">Debt</strong>{" "}
            if it&apos;s a card payment). Here&apos;s the full picture of how it works.
          </p>
        </div>

        {/* Rule list */}
        <div className="space-y-2">
          <div className="glass-card rounded-2xl p-4 flex gap-3">
            <span className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "#4f46e526" }}>
              <ArrowLeftRight size={15} style={{ color: "#4f46e5" }} />
            </span>
            <div>
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Your own money moving isn&apos;t spending</p>
              <p className="text-[13px] text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                Money leaving your current account to a{" "}
                <strong className="font-semibold text-slate-900 dark:text-slate-100">savings</strong> account is{" "}
                <strong className="font-semibold text-slate-900 dark:text-slate-100">Savings</strong>. To a{" "}
                <strong className="font-semibold text-slate-900 dark:text-slate-100">credit card</strong> is{" "}
                <strong className="font-semibold text-slate-900 dark:text-slate-100">Debt</strong>. Any other move between
                your own accounts is a <strong className="font-semibold text-slate-900 dark:text-slate-100">Transfer</strong>.
                None of it counts as spend.
              </p>
            </div>
          </div>

          <div className="glass-card rounded-2xl p-4 flex gap-3">
            <span className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "#34d39926" }}>
              <ReceiptText size={15} style={{ color: "#34d399" }} />
            </span>
            <div>
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Real purchases go by merchant</p>
              <p className="text-[13px] text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                Everything else is categorised by who you paid, a supermarket lands in{" "}
                <strong className="font-semibold text-slate-900 dark:text-slate-100">Groceries</strong>, a restaurant in{" "}
                <strong className="font-semibold text-slate-900 dark:text-slate-100">Eating Out</strong>, and so on.
              </p>
            </div>
          </div>

          <div className="glass-card rounded-2xl p-4 flex gap-3">
            <span className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "#f59e0b26" }}>
              <CreditCard size={15} style={{ color: "#f59e0b" }} />
            </span>
            <div>
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">We flag anything that looks off</p>
              <p className="text-[13px] text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                If something looks like it should have been a transfer between your own accounts but landed in a
                spending category, we flag it for review, you can recategorise it or dismiss the flag if it&apos;s
                genuinely spending.
              </p>
            </div>
          </div>

          <div className="glass-card rounded-2xl p-4 flex gap-3">
            <span className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "#6366f126" }}>
              <SlidersHorizontal size={15} style={{ color: "#6366f1" }} />
            </span>
            <div>
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">You&apos;re always in control</p>
              <p className="text-[13px] text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                Manage your future filing rules in{" "}
                <Link href="/settings?section=rules" className="font-semibold text-indigo-700 underline dark:text-indigo-300">Settings → Category rules</Link>.
              </p>
            </div>
          </div>
        </div>
    </SheetFrame>
  );
}
