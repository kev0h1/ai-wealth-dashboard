"use client";

import { useState } from "react";
import { SheetFrame } from "@/components/SheetFrame";
import PayPeriodPicker from "@/components/PayPeriodPicker";
import { PayPeriodConfig } from "@/lib/payPeriod";
import { configFromDraft, draftFromConfig } from "@/lib/payPeriodDraft";

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function formatPeriodLocal(start: Date, end: Date): string {
  const sd = start.getUTCDate();
  const sm = MONTH_SHORT[start.getUTCMonth()];
  const ed = end.getUTCDate();
  const em = MONTH_SHORT[end.getUTCMonth()];
  return `${sd} ${sm} → ${ed} ${em}`;
}

export default function PayPeriodSettingsSheet({
  current,
  onClose,
  onSave,
}: {
  current: PayPeriodConfig;
  onClose: () => void;
  onSave: (c: PayPeriodConfig) => void;
}) {
  const [draft, setDraft] = useState(() => draftFromConfig(current));
  const config = configFromDraft(draft);

  return (
    <SheetFrame title="Pay period" onClose={onClose} bodyClassName="px-0 py-5" footer={(
      <button
        onClick={() => { if (config) onSave(config); }}
        disabled={!config}
        className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white transition-colors active:scale-[0.98] disabled:opacity-50"
      >
        Save Pay Period
      </button>
    )}>
      <div className="px-5 pb-4">
        <PayPeriodPicker draft={draft} onChange={setDraft} showCalendarMonth />
      </div>
    </SheetFrame>
  );
}
