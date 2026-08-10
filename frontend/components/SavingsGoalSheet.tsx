"use client";

// Safety-net goal editor, extracted from the old Insights "Savings" tab
// (SafetyNetCard's inline setup form) into a standalone bottom sheet so it
// can be opened from the Grow buffer readout. Faithful extraction — the
// form logic and copy are unchanged, only the chrome (portal sheet, backdrop,
// mobile handle, desktop centered modal) is new, matching the pattern used
// by CategorisationRulesSheet.

import { useState } from "react";
import { createPortal } from "react-dom";
import { X, CheckCircle2, Circle, Shield, Pencil, Plus, ChevronDown } from "lucide-react";
import { api, SavingsInsights, SavingsGoalInput, SavingsAccountOption } from "@/lib/api";
import { useLockBodyScroll } from "@/lib/useLockBodyScroll";
import { useSheetOpen } from "@/lib/useSheetOpen";
import { fmt } from "@/lib/format";

interface SavingsGoalSheetProps {
  data: SavingsInsights | null;
  sym: string;
  hideValues: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export default function SavingsGoalSheet({ data, sym, hideValues, onClose, onSaved }: SavingsGoalSheetProps) {
  useLockBodyScroll();
  useSheetOpen();

  const [targetChoice, setTargetChoice] = useState<"3" | "6" | "custom">(
    data?.target_type === "amount" ? "custom" : data?.target_months === 6 ? "6" : "3"
  );
  const [customAmount, setCustomAmount] = useState(
    data?.target_type === "amount" ? String(data.target_amount || "") : ""
  );
  const [selected, setSelected] = useState<string[]>(
    data?.accounts.filter(a => a.selected).map(a => a.account_id) ?? []
  );
  const [saving, setSaving] = useState(false);
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualEditId, setManualEditId] = useState<string | null>(null);
  const [manualName, setManualName] = useState("");
  const [manualBalance, setManualBalance] = useState("");
  const [savingManual, setSavingManual] = useState(false);
  const [acctsOpen, setAcctsOpen] = useState(false);

  const openAddManual = () => { setManualEditId(null); setManualName(""); setManualBalance(""); setShowManualForm(true); };
  const openEditManual = (a: SavingsAccountOption) => { setManualEditId(a.account_id); setManualName(a.name); setManualBalance(String(a.balance)); setShowManualForm(true); };

  async function saveManual() {
    const name = manualName.trim();
    const bal = Number(manualBalance);
    if (!name || isNaN(bal) || bal < 0) return;
    setSavingManual(true);
    try {
      if (manualEditId) {
        await api.updateSavingsManualAccount(manualEditId, { name, balance: bal });
      } else {
        const before = new Set((data?.accounts ?? []).map(a => a.account_id));
        const res = await api.addSavingsManualAccount({ name, balance: bal });
        const created = res.accounts.find(a => !before.has(a.account_id));
        if (created) setSelected(s => s.includes(created.account_id) ? s : [...s, created.account_id]);
      }
      setShowManualForm(false);
      setManualEditId(null);
      setManualName("");
      setManualBalance("");
      onSaved();
    } catch {} finally { setSavingManual(false); }
  }

  async function removeManual(id: string) {
    try {
      await api.deleteSavingsManualAccount(id);
      setSelected(s => s.filter(x => x !== id));
      onSaved();
    } catch {}
  }

  async function save() {
    if (selected.length === 0) return;
    setSaving(true);
    try {
      const body: SavingsGoalInput = targetChoice === "custom"
        ? { target_type: "amount", target_amount: Number(customAmount) || 0, account_ids: selected }
        : { target_type: "months", target_months: targetChoice === "6" ? 6 : 3, account_ids: selected };
      await api.saveSavingsGoal(body);
      onSaved();
      onClose();
    } catch {} finally { setSaving(false); }
  }

  const toggle = (id: string) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  const customInvalid = targetChoice === "custom" && (!Number(customAmount) || Number(customAmount) <= 0);
  const accounts = data?.accounts ?? [];

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
        <div className="flex items-center justify-between px-5 pt-2 pb-1 lg:pt-5">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 truncate flex-1 mr-4">
            Safety net goal
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors flex-shrink-0"
          >
            <X size={16} color="#64748b" />
          </button>
        </div>

        <div className="px-5 pb-8 lg:pb-6">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-emerald-100 dark:bg-emerald-900/30">
              <Shield className="w-5 h-5 text-emerald-600" />
            </div>
            <div className="flex-1">
              <p className="text-base font-bold text-slate-900 dark:text-slate-100">Build your safety net</p>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                An emergency fund of 3–6 months&rsquo; spending protects you from surprises. Pick a target and the accounts that hold it.
              </p>
            </div>
          </div>

          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-4 mb-2">Target size</p>
          <div className="flex gap-2">
            {([["3", "3 months"], ["6", "6 months"], ["custom", "Custom"]] as const).map(([v, label]) => (
              <button key={v} onClick={() => setTargetChoice(v)}
                className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                  targetChoice === v ? "bg-emerald-600 text-white border-emerald-600" : "border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300"}`}>
                {label}
              </button>
            ))}
          </div>
          {targetChoice !== "custom" && (data?.monthly_spending ?? 0) > 0 && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5">
              ≈ {hideValues ? "••••" : fmt((targetChoice === "6" ? 6 : 3) * (data?.monthly_spending ?? 0), sym)} based on your spending
            </p>
          )}
          {targetChoice === "custom" && (
            <div className="mt-2 flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-600 px-3 py-2">
              <span className="text-slate-400 text-sm">{sym.trim() || sym}</span>
              <input type="number" inputMode="decimal" value={customAmount}
                onChange={e => setCustomAmount(e.target.value)} placeholder="Amount"
                className="flex-1 bg-transparent text-sm outline-none text-slate-900 dark:text-slate-100" />
            </div>
          )}

          <button type="button" onClick={() => setAcctsOpen(o => !o)} aria-expanded={acctsOpen} className="w-full flex items-center justify-between mt-4 mb-2">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Accounts holding your savings{selected.length > 0 ? ` · ${selected.length} selected` : ""}
            </span>
            <ChevronDown size={16} className={`text-slate-500 dark:text-slate-400 transition-transform ${acctsOpen ? "rotate-180" : ""}`} />
          </button>
          {!acctsOpen && selected.length === 0 && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-1">Tap to choose where you keep your savings.</p>
          )}
          {acctsOpen && (<>
          <div className="space-y-1.5">
            {accounts.map(a => {
              const on = selected.includes(a.account_id);
              return (
                <div key={a.account_id} className="flex items-center gap-1">
                  <button onClick={() => toggle(a.account_id)}
                    className="flex-1 min-w-0 flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-left transition-colors"
                    style={on ? { borderColor: "#059669", background: "#05966910" } : undefined}>
                    {on ? <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" /> : <Circle className="w-5 h-5 text-slate-300 dark:text-slate-600 flex-shrink-0" />}
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{a.name}</span>
                      <span className="block text-[11px] text-slate-500 dark:text-slate-400">{a.manual ? "Offline account" : a.provider}</span>
                    </span>
                    <span className="text-sm font-semibold text-slate-600 dark:text-slate-300">{hideValues ? "••••" : fmt(a.balance, sym)}</span>
                  </button>
                  {a.manual && (
                    <>
                      <button onClick={() => openEditManual(a)} aria-label="Edit account" className="flex-shrink-0 p-2.5 text-slate-400 hover:text-emerald-600 transition-colors"><Pencil size={14} /></button>
                      <button onClick={() => removeManual(a.account_id)} aria-label="Remove account" className="flex-shrink-0 p-2.5 text-slate-400 hover:text-red-500 transition-colors"><X size={14} /></button>
                    </>
                  )}
                </div>
              );
            })}
            {accounts.length === 0 && !showManualForm && (
              <p className="text-sm text-slate-500 dark:text-slate-400">No connected accounts. Add an offline account to track savings you hold elsewhere.</p>
            )}
          </div>

          {showManualForm ? (
            <div className="mt-2 rounded-xl border border-slate-200 dark:border-slate-600 p-3 space-y-2">
              <input value={manualName} onChange={e => setManualName(e.target.value)} placeholder="Account name (e.g. Cash ISA)" maxLength={60}
                className="w-full bg-transparent text-sm outline-none text-slate-900 dark:text-slate-100 border-b border-slate-200 dark:border-slate-600 pb-1.5" />
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-2">
                <span className="text-slate-400 text-sm">{sym.trim() || sym}</span>
                <input type="number" inputMode="decimal" value={manualBalance} onChange={e => setManualBalance(e.target.value)} placeholder="Current balance"
                  className="flex-1 bg-transparent text-sm outline-none text-slate-900 dark:text-slate-100" />
              </div>
              <div className="flex gap-2 pt-0.5">
                <button onClick={() => { setShowManualForm(false); setManualEditId(null); }} className="px-3 py-2 rounded-lg text-sm font-semibold text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-600">Cancel</button>
                <button onClick={saveManual} disabled={!manualName.trim() || !manualBalance || isNaN(Number(manualBalance)) || Number(manualBalance) < 0 || savingManual}
                  className="flex-1 py-2 rounded-lg text-white text-sm font-semibold bg-emerald-600 disabled:opacity-40 active:scale-[0.98] transition-all">
                  {savingManual ? "Saving…" : manualEditId ? "Save changes" : "Add account"}
                </button>
              </div>
            </div>
          ) : (
            <button onClick={openAddManual} className="mt-2 flex items-center gap-1 text-sm font-medium text-emerald-600">
              <Plus size={14} /> Add an offline account
            </button>
          )}
          </>)}

          <div className="flex gap-2 mt-4">
            <button onClick={onClose} className="px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-600">
              Cancel
            </button>
            <button onClick={save} disabled={selected.length === 0 || customInvalid || saving}
              className="flex-1 py-2.5 rounded-xl text-white text-sm font-semibold bg-emerald-600 disabled:opacity-40 active:scale-[0.98] transition-all">
              {saving ? "Saving…" : data?.configured ? "Update target" : "Start tracking"}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
