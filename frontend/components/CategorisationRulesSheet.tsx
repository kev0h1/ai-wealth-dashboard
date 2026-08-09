"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, ArrowLeftRight, CreditCard, ReceiptText, SlidersHorizontal } from "lucide-react";
import { useLockBodyScroll } from "@/lib/useLockBodyScroll";
import { useSheetOpen } from "@/lib/useSheetOpen";

interface CategorisationRulesSheetProps {
  onClose: () => void;
}

export default function CategorisationRulesSheet({ onClose }: CategorisationRulesSheetProps) {
  useLockBodyScroll();
  useSheetOpen();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  return createPortal(
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-[65] fade-in" onClick={onClose} />

      {/* Sheet — bottom sheet on mobile, centered modal on desktop */}
      <div
        className="fixed left-1/2 -translate-x-1/2 w-full max-w-[500px] glass-sheet z-[70] overflow-y-auto
                    bottom-0 rounded-t-3xl slide-up max-h-[88dvh]
                    lg:bottom-auto lg:top-1/2 lg:-translate-y-1/2 lg:rounded-3xl lg:max-h-[85dvh] lg:shadow-2xl"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        {/* Handle — mobile only */}
        <div className="flex justify-center pt-3 pb-1 lg:hidden">
          <div className="w-10 h-1 bg-slate-200 dark:bg-slate-600 rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-2 pb-4 lg:pt-5">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 truncate flex-1 mr-4">
            How we categorise your money
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors flex-shrink-0"
          >
            <X size={16} color="#64748b" />
          </button>
        </div>

        {/* Penny explainer */}
        <div className="mx-5 mb-4 glass-card rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <span
              className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-white rounded-full px-2.5 py-1"
              style={{ background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)" }}
            >
              ✦ Penny
            </span>
          </div>
          <p className="text-[14px] text-slate-700 dark:text-slate-200 leading-relaxed">
            Money moving between your own accounts isn&apos;t spending — it should be a{" "}
            <strong className="font-semibold text-slate-900 dark:text-slate-100">Transfer</strong>{" "}
            (or <strong className="font-semibold text-slate-900 dark:text-slate-100">Savings</strong>{" "}
            if it&apos;s going to a savings account, <strong className="font-semibold text-slate-900 dark:text-slate-100">Debt</strong>{" "}
            if it&apos;s a card payment). Here&apos;s the full picture of how it works.
          </p>
        </div>

        {/* Rule list */}
        <div className="px-5 pb-8 lg:pb-6 space-y-2">
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
                Everything else is categorised by who you paid — a supermarket lands in{" "}
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
                spending category, we flag it for review — you can recategorise it or dismiss the flag if it&apos;s
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
                You can override any category yourself at any time, and set your own rules in{" "}
                <strong className="font-semibold text-slate-900 dark:text-slate-100">Settings → Rules</strong>.
              </p>
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
