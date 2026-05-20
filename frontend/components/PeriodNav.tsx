"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatPeriod } from "@/lib/payPeriod";

interface PeriodNavProps {
  start: Date;
  end: Date;
  onPrev: () => void;
  onNext: () => void;
  isCurrentPeriod?: boolean;
}

export default function PeriodNav({
  start,
  end,
  onPrev,
  onNext,
  isCurrentPeriod = false,
}: PeriodNavProps) {
  return (
    <div className="flex items-center justify-between px-4 py-3 bg-white rounded-2xl shadow-sm">
      <button
        onClick={onPrev}
        className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-slate-100 active:bg-slate-200 transition-colors"
        aria-label="Previous period"
      >
        <ChevronLeft size={20} color="#64748b" />
      </button>

      <div className="text-center">
        <p className="text-sm font-semibold text-slate-800">
          {formatPeriod(start, end)}
        </p>
        {isCurrentPeriod && (
          <p className="text-[10px] text-indigo-500 font-medium mt-0.5">
            Current period
          </p>
        )}
      </div>

      <button
        onClick={onNext}
        className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-slate-100 active:bg-slate-200 transition-colors"
        aria-label="Next period"
        disabled={isCurrentPeriod}
      >
        <ChevronRight
          size={20}
          color={isCurrentPeriod ? "#cbd5e1" : "#64748b"}
        />
      </button>
    </div>
  );
}
