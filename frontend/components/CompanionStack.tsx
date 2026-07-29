"use client";

import { useRouter } from "next/navigation";
import { ArrowRightLeft, CalendarClock, Sparkles, X } from "lucide-react";
import type { CompanionItem } from "@/lib/api";

interface CompanionStackProps {
  items: CompanionItem[];
  onDismiss: (id: string) => void;
}

function itemIcon(type: CompanionItem["type"]) {
  switch (type) {
    case "move":
      return <ArrowRightLeft size={16} className="text-amber-500 flex-shrink-0" />;
    case "celebration":
      return <Sparkles size={16} className="text-emerald-500 flex-shrink-0" />;
    case "rhythm":
    default:
      return <CalendarClock size={16} className="text-indigo-400 flex-shrink-0" />;
  }
}

function itemAccent(type: CompanionItem["type"]): string {
  switch (type) {
    case "move":
      return "bg-amber-50 dark:bg-amber-900/10 border-amber-100 dark:border-amber-800/40";
    case "celebration":
      return "bg-emerald-50 dark:bg-emerald-900/10 border-emerald-100 dark:border-emerald-800/40";
    case "rhythm":
    default:
      return "bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700";
  }
}

export default function CompanionStack({ items, onDismiss }: CompanionStackProps) {
  const router = useRouter();

  if (!items || items.length === 0) return null;

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div
          key={item.id}
          className={`rounded-2xl shadow-sm border px-4 py-3.5 ${itemAccent(item.type)}`}
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5">{itemIcon(item.type)}</div>
            <div className="flex-1 min-w-0">
              <p className="text-base font-bold text-slate-900 dark:text-slate-100 leading-snug">
                {item.headline}
              </p>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                {item.body}
              </p>
              {item.action && (
                <button
                  onClick={() => router.push(item.action!.route)}
                  className="mt-2.5 text-sm font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 px-3 py-1.5 rounded-xl active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  {item.action.label}
                </button>
              )}
            </div>
            <button
              onClick={() => onDismiss(item.id)}
              aria-label="Dismiss"
              className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-400 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
