"use client";

import { useEffect, useState } from "react";
import { GraduationCap, ChevronDown } from "lucide-react";
import { api, MoneyBasic } from "@/lib/api";

export default function MoneyBasicCard({ className = "mx-4 mt-3 mb-5 lg:mx-0" }: { className?: string } = {}) {
  const [card, setCard] = useState<MoneyBasic | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api
      .getDailyMoneyBasic()
      .then(setCard)
      .catch(() => setCard(null))
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded || !card) return null;

  return (
    <div className={className}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-amber-100 dark:border-amber-900/40 overflow-hidden active:scale-[0.99] transition-transform"
      >
        <div className="p-4">
          <div className="flex items-center justify-between gap-2 mb-2.5">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 rounded-full px-2.5 py-1">
              <GraduationCap size={13} />
              Money basics
            </span>
            <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
              {card.topic} · UK {card.tax_year}
            </span>
          </div>

          <div className="flex items-start gap-2.5">
            <span className="text-xl leading-none mt-0.5">{card.icon}</span>
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-bold text-slate-900 dark:text-slate-100 leading-snug">
                {card.title}
              </p>
              {!open && card.takeaway && (
                <p className="text-[13px] text-slate-500 dark:text-slate-400 leading-relaxed mt-1 line-clamp-2">
                  {card.takeaway}
                </p>
              )}
            </div>
            <ChevronDown
              size={18}
              className={`text-slate-400 flex-shrink-0 mt-0.5 transition-transform ${open ? "rotate-180" : ""}`}
            />
          </div>

          {open && (
            <div className="mt-3 pl-[30px]">
              <p className="text-[13px] text-slate-600 dark:text-slate-300 leading-relaxed">
                {card.body}
              </p>
              {card.takeaway && (
                <div className="flex items-start gap-2 mt-3 bg-amber-50 dark:bg-amber-900/20 rounded-xl px-3 py-2.5">
                  <span className="text-amber-500 text-sm leading-none mt-0.5">💡</span>
                  <p className="text-[13px] font-semibold text-slate-700 dark:text-slate-200 leading-snug">
                    {card.takeaway}
                  </p>
                </div>
              )}
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-3">
                General information, not financial advice.
              </p>
            </div>
          )}
        </div>
      </button>
    </div>
  );
}
