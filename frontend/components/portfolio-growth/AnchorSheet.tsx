"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { SheetFrame } from "@/components/SheetFrame";
import { ANCHOR_USER_NOTE, parseMoneyInput, parsePercentInput, type GrowthAnchor, type InvestmentGrowth } from "@/lib/investmentGrowth";
import { ink, label, whisper } from "./Parts";

type Basis = "return" | "paid_in";

const field = "mt-1 w-full min-h-[44px] rounded-xl border border-slate-200 bg-slate-50 px-3 text-[16px] text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100";

/** "Anchor from your provider" (G278). One step: what the provider shows on a
 *  date, as a value plus either the return or the total paid in. Everything
 *  here is entered by the user, editable and clearable. */
export default function AnchorSheet({ accountId, provider, anchor, todayIso, hidden, onClose, onSaved }: {
  accountId: string;
  provider: string | null | undefined;
  anchor: GrowthAnchor | null;
  /** YYYY-MM-DD, the latest date the anchor may carry. */
  todayIso: string;
  /** Balances are hidden: an existing anchor is not shown in clear text until the user taps Show to edit. */
  hidden?: boolean;
  onClose: () => void;
  onSaved: (g: InvestmentGrowth) => void;
}) {
  const who = provider && provider.trim() ? provider.trim() : "your provider";
  const [date, setDate] = useState(anchor?.date ?? todayIso);
  const [value, setValue] = useState(anchor ? String(anchor.provider_value) : "");
  const [basis, setBasis] = useState<Basis>(anchor && anchor.total_paid_in !== null ? "paid_in" : "return");
  const [second, setSecond] = useState(anchor ? String(anchor.total_paid_in ?? anchor.provider_return ?? "") : "");
  const [rate, setRate] = useState(anchor?.provider_rate_of_return_pct != null ? String(anchor.provider_rate_of_return_pct) : "");
  const [revealed, setRevealed] = useState(!(hidden && anchor));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const v = parseMoneyInput(value);
  const s = parseMoneyInput(second);
  const r = rate.trim() === "" ? null : parsePercentInput(rate);
  const ready = revealed && !!date && date <= todayIso && v !== null && v > 0 && s !== null && (rate.trim() === "" || r !== null);

  async function save() {
    if (!ready || v === null || s === null) return;
    setBusy(true);
    setError(null);
    try {
      const g = await api.setInvestmentAnchor(accountId, {
        date, provider_value: v,
        provider_return: basis === "return" ? s : null,
        total_paid_in: basis === "paid_in" ? s : null,
        provider_rate_of_return_pct: r,
      });
      onSaved(g);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "That did not save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.clearInvestmentAnchor(accountId));
    } catch {
      setError("That did not clear. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetFrame
      title="Anchor from your provider"
      description={`Copy what ${who} shows for this account today. Sorted tracks growth forward from it.`}
      onClose={onClose}
      footer={() => (
        <div className="flex items-center gap-2">
          {anchor ? (
            <button type="button" disabled={busy} onClick={clear} className="touch-manipulation min-h-[44px] rounded-xl px-3 text-[14px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-200 dark:hover:bg-slate-800">
              Clear anchor
            </button>
          ) : null}
          <button type="button" disabled={!ready || busy} onClick={save} className="touch-manipulation ml-auto min-h-[44px] flex-1 rounded-xl bg-indigo-600 px-4 text-[14px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">
            {busy ? "Saving" : anchor ? "Save anchor" : "Set anchor"}
          </button>
        </div>
      )}
    >
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
        <div>
          <label htmlFor="anchor-date" className={label}>Date shown</label>
          <input id="anchor-date" type="date" max={todayIso} value={date} onChange={(e) => setDate(e.target.value)} className={field} />
        </div>
        <div>
          <label htmlFor="anchor-value" className={label}>Account value</label>
          <input id="anchor-value" inputMode="decimal" autoComplete="off" placeholder="10,000.00" readOnly={!revealed} value={revealed ? value : "••••"} onChange={(e) => setValue(e.target.value)} className={field} />
        </div>
        <fieldset>
          <legend className={label}>And one of these</legend>
          <div role="radiogroup" aria-label="Return or total paid in" className="mt-1 grid grid-cols-2 gap-2">
            {([["return", "Return"], ["paid_in", "Total paid in"]] as const).map(([k, text]) => (
              <button key={k} type="button" role="radio" aria-checked={basis === k} onClick={() => setBasis(k)}
                className={`touch-manipulation min-h-[44px] rounded-xl border px-3 text-[14px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                  basis === k ? "border-indigo-600 bg-indigo-50 text-indigo-800 dark:border-indigo-400 dark:bg-indigo-900/30 dark:text-indigo-200" : "border-slate-200 text-slate-700 dark:border-slate-600 dark:text-slate-200"
                }`}>
                {text}
              </button>
            ))}
          </div>
          <label htmlFor="anchor-second" className="sr-only">{basis === "return" ? "Return in pounds" : "Total paid in, in pounds"}</label>
          <input id="anchor-second" inputMode="decimal" autoComplete="off" placeholder={basis === "return" ? "500.00" : "9,500.00"} readOnly={!revealed} value={revealed ? second : "••••"} onChange={(e) => setSecond(e.target.value)} className={field} />
          <p className={`mt-1 text-[12px] ${whisper}`}>
            {basis === "return" ? "The gain or loss in pounds, as your provider shows it. Paid in is worked out as value minus return." : "What you have paid in to date, as your provider shows it."}
          </p>
        </fieldset>
        <div>
          <label htmlFor="anchor-rate" className={label}>Personal rate of return, optional</label>
          <input id="anchor-rate" inputMode="decimal" autoComplete="off" placeholder="5.0" readOnly={!revealed} value={revealed ? rate : (rate ? "••••" : "")} onChange={(e) => setRate(e.target.value)} className={field} />
          <p className={`mt-1 text-[12px] ${whisper}`}>Shown as you enter it, with its date, and never recomputed.</p>
        </div>
        {!revealed ? (
          <button type="button" onClick={() => setRevealed(true)} className="touch-manipulation min-h-[44px] rounded-xl text-[14px] font-semibold text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300">
            Show to edit
          </button>
        ) : null}
        <p className={`text-[12px] leading-snug ${whisper}`}>{ANCHOR_USER_NOTE}</p>
        {error ? <p role="alert" className={`text-[13px] ${ink}`}>{error}</p> : null}
      </form>
    </SheetFrame>
  );
}
