"use client";

import { useEffect, useState, useRef } from "react";
import { RotateCcw, Plus, Trash2, Loader2, Check, AlertCircle, X } from "lucide-react";
import { CATEGORIES, CATEGORY_COLOURS, DEFAULT_CUSTOM_COLOUR } from "@/lib/categories";
import { useColours } from "@/components/ColourProvider";
import { useCategories } from "@/components/CategoriesContext";
import { api } from "@/lib/api";
import { useLockBodyScroll } from "@/lib/useLockBodyScroll";

interface Rule {
  id: string;
  description: string;
  pattern: string;
  category: string;
  created_at: string;
}

const PALETTE = [
  "#ef4444","#f97316","#eab308","#84cc16","#22c55e","#14b8a6",
  "#06b6d4","#3b82f6","#6366f1","#8b5cf6","#a855f7","#ec4899",
  "#f43f5e","#64748b","#0ea5e9","#10b981","#f59e0b","#d97706",
  "#7c3aed","#be185d",
];

function isValidHex(h: string) { return /^#[0-9a-fA-F]{6}$/.test(h); }

function ColourPicker({ colour, onChange, onClose }: {
  colour: string; onChange: (hex: string) => void; onClose: () => void;
}) {
  const [hex, setHex] = useState(colour);
  const preview = isValidHex(hex) ? hex : colour;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-5 mx-4 w-full max-w-[280px]"
        onClick={e => e.stopPropagation()}
      >
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">Choose colour</p>

        {/* Palette grid */}
        <div className="grid grid-cols-5 gap-2 mb-4">
          {PALETTE.map(p => (
            <button
              key={p}
              onClick={() => { onChange(p); setHex(p); onClose(); }}
              className="w-10 h-10 rounded-xl transition-transform active:scale-90 flex items-center justify-center"
              style={{ backgroundColor: p }}
            >
              {p === colour && <Check size={14} stroke="white" strokeWidth={3} />}
            </button>
          ))}
        </div>

        {/* Divider */}
        <div className="border-t border-slate-100 dark:border-slate-700 mb-4" />

        {/* Hex input + preview */}
        <div className="flex items-center gap-2 mb-4 min-w-0">
          <div className="w-9 h-9 rounded-xl flex-shrink-0 border border-slate-200 dark:border-slate-600" style={{ backgroundColor: preview }} />
          <input
            value={hex}
            onChange={e => {
              const v = e.target.value.startsWith("#") ? e.target.value : "#" + e.target.value;
              setHex(v);
              if (isValidHex(v)) onChange(v);
            }}
            maxLength={7}
            placeholder="#6366f1"
            className="min-w-0 flex-1 text-sm font-mono px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-700 text-sm font-medium text-slate-600 dark:text-slate-300"
          >Cancel</button>
          <button
            onClick={() => { if (isValidHex(hex)) { onChange(hex); } onClose(); }}
            className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-sm font-semibold text-white"
          >Set</button>
        </div>
      </div>
    </div>
  );
}

function ColourDot({ cat, colour, onChange, onReset, isModified }: {
  cat: string; colour: string; onChange: (hex: string) => void;
  onReset: () => void; isModified: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative flex-shrink-0">
      <button
        onClick={() => setOpen(true)}
        title={`Change colour for ${cat}`}
        className="w-4 h-4 rounded-full shadow-sm ring-2 ring-white dark:ring-slate-700 active:scale-90 transition-transform"
        style={{ backgroundColor: colour }}
      />
      {isModified && (
        <button
          onClick={(e) => { e.stopPropagation(); onReset(); }}
          title="Reset to default"
          className="absolute -top-1 -right-1 w-3 h-3 bg-slate-400 rounded-full flex items-center justify-center"
        >
          <RotateCcw size={6} color="#fff" />
        </button>
      )}
      {open && (
        <ColourPicker
          colour={colour}
          onChange={onChange}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

export default function CategoryManagerSheet({ onClose }: { onClose: () => void }) {
  useLockBodyScroll();
  const { colours, setColour, resetColour, resetAllColours } = useColours();
  const [confirmReset, setConfirmReset] = useState(false);
  const { customCategories, addCategory, deleteCategory } = useCategories();

  const [newCatName, setNewCatName] = useState("");
  const [addingCat, setAddingCat] = useState(false);
  const [catError, setCatError] = useState("");

  const [rules, setRules] = useState<Rule[]>([]);
  const [ruleText, setRuleText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [pending, setPending] = useState<{ pattern: string; category: string } | null>(null);
  const [ruleError, setRuleError] = useState("");
  const [savingRule, setSavingRule] = useState(false);

  useEffect(() => {
    api.getRules().then(({ rules: r }) => setRules(r)).catch(() => {});
  }, []);

  async function handleAddCategory() {
    const name = newCatName.trim();
    if (!name) return;
    setAddingCat(true); setCatError("");
    try {
      await addCategory(name);
      setNewCatName("");
    } catch (e: unknown) {
      setCatError(e instanceof Error ? e.message : "Failed to add category");
    } finally {
      setAddingCat(false);
    }
  }

  async function handleParseRule() {
    const text = ruleText.trim();
    if (!text) return;
    setParsing(true); setRuleError(""); setPending(null);
    try {
      const result = await api.parseRule(text) as { pattern?: string; category?: string; error?: string };
      if (result.error) setRuleError(result.error);
      else if (result.pattern && result.category) setPending({ pattern: result.pattern, category: result.category });
    } catch {
      setRuleError("Couldn't understand that rule — try rephrasing it");
    } finally {
      setParsing(false);
    }
  }

  async function handleConfirmRule() {
    if (!pending) return;
    setSavingRule(true);
    try {
      const saved = await api.addRule(ruleText.trim(), pending.pattern, pending.category);
      setRules((prev) => [{ ...saved, created_at: new Date().toISOString() }, ...prev]);
      setRuleText(""); setPending(null); setRuleError("");
    } catch {
      setRuleError("Failed to save rule");
    } finally {
      setSavingRule(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-[65]" onClick={onClose} />
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] bg-[#f0f2f7] dark:bg-[#0f172a] rounded-t-3xl z-[70] overflow-y-auto max-h-[88vh]">
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-slate-200 dark:bg-slate-600 rounded-full" />
        </div>
        <div className="flex items-center justify-between px-5 pt-2 pb-4">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Manage categories</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700">
            <X size={16} color="#64748b" />
          </button>
        </div>

        <div className="px-4 pb-8 space-y-3">

          {/* ── Categories ── */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Categories</p>
                {confirmReset ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 dark:text-slate-400">Reset all colours?</span>
                    <button
                      onClick={() => { resetAllColours(); setConfirmReset(false); }}
                      className="text-xs font-semibold text-rose-500 px-2 py-1 rounded-lg bg-rose-50 dark:bg-rose-900/20"
                    >Yes</button>
                    <button
                      onClick={() => setConfirmReset(false)}
                      className="text-xs text-slate-400 px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-700"
                    >No</button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmReset(true)}
                    className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors flex-shrink-0"
                  >
                    <RotateCcw size={11} /> Reset defaults
                  </button>
                )}
              </div>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Tap a colour dot to customise it</p>
            </div>

            {/* Built-in grid */}
            <div className="px-4 pt-3 pb-3">
              <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2">Default</p>
              <div className="grid grid-cols-2 gap-1.5">
                {[...CATEGORIES].map((cat) => {
                  const colour = colours[cat] ?? CATEGORY_COLOURS[cat];
                  const def = CATEGORY_COLOURS[cat];
                  const isModified = colour !== def;
                  return (
                    <div
                      key={cat}
                      className="flex items-center gap-2 py-1.5 px-2.5 rounded-xl bg-slate-50 dark:bg-slate-700/50 shadow-[0_1px_4px_rgba(0,0,0,0.07)] dark:shadow-[0_1px_4px_rgba(0,0,0,0.22)]"
                    >
                      <ColourDot
                        cat={cat} colour={colour} isModified={isModified}
                        onChange={(hex) => setColour(cat, hex)}
                        onReset={() => resetColour(cat)}
                      />
                      <span className="text-xs text-slate-700 dark:text-slate-200 truncate">{cat}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Custom categories */}
            <div className="px-4 pb-3 border-t border-slate-50 dark:border-slate-700/50 pt-3">
              <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2">Mine</p>
              {customCategories.length === 0 && (
                <p className="text-xs text-slate-400 dark:text-slate-500 mb-2">No custom categories yet</p>
              )}
              {customCategories.map((cat) => {
                const colour = colours[cat] ?? DEFAULT_CUSTOM_COLOUR;
                const isModified = colour !== DEFAULT_CUSTOM_COLOUR;
                return (
                  <div key={cat} className="flex items-center justify-between py-2 border-b border-slate-50 dark:border-slate-700/50 last:border-0">
                    <div className="flex items-center gap-2">
                      <ColourDot
                        cat={cat} colour={colour} isModified={isModified}
                        onChange={(hex) => setColour(cat, hex)}
                        onReset={() => resetColour(cat)}
                      />
                      <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{cat}</span>
                    </div>
                    <button onClick={() => deleteCategory(cat)} className="w-7 h-7 flex items-center justify-center rounded-full bg-red-50 dark:bg-red-900/20">
                      <Trash2 size={13} color="#ef4444" />
                    </button>
                  </div>
                );
              })}
              <div className="flex items-center gap-2 mt-2">
                <input
                  className="flex-1 text-sm bg-slate-50 dark:bg-slate-700 dark:text-slate-100 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Add a category…"
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAddCategory(); }}
                  maxLength={40}
                />
                <button
                  onClick={handleAddCategory}
                  disabled={!newCatName.trim() || addingCat}
                  className="w-9 h-9 rounded-xl bg-indigo-500 flex items-center justify-center disabled:opacity-40 active:scale-90 transition-transform flex-shrink-0"
                >
                  <Plus size={16} color="#fff" />
                </button>
              </div>
              {catError && <p className="mt-1 text-xs text-red-500">{catError}</p>}
            </div>
          </div>

          {/* ── Categorisation Rules ── */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Categorisation Rules</p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Automatically categorise transactions by keyword</p>
            </div>

            <div className="px-4 py-3 border-b border-slate-50 dark:border-slate-700/50">
              <textarea
                className="w-full text-sm bg-slate-50 dark:bg-slate-700 dark:text-slate-100 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                placeholder={`e.g. "Always put Greggs as Eating Out" or "Mark Amazon as Shopping"`}
                rows={2}
                value={ruleText}
                onChange={(e) => { setRuleText(e.target.value); setPending(null); setRuleError(""); }}
              />

              {pending && (
                <div className="mt-2 p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800">
                  <p className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wide mb-1">Preview</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="text-xs font-mono text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-700 px-2 py-0.5 rounded">{pending.pattern}</code>
                    <span className="text-slate-400 text-xs">→</span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: colours[pending.category] ?? CATEGORY_COLOURS[pending.category] ?? DEFAULT_CUSTOM_COLOUR }} />
                      <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">{pending.category}</span>
                    </span>
                  </div>
                </div>
              )}

              {ruleError && (
                <div className="mt-2 flex items-center gap-1.5">
                  <AlertCircle size={13} className="text-red-500 flex-shrink-0" />
                  <p className="text-xs text-red-500">{ruleError}</p>
                </div>
              )}

              <div className="flex gap-2 mt-2">
                {!pending ? (
                  <button
                    onClick={handleParseRule}
                    disabled={!ruleText.trim() || parsing}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-500 text-white text-xs font-semibold disabled:opacity-40 active:scale-95 transition-transform"
                  >
                    {parsing && <Loader2 size={13} className="animate-spin" />}
                    {parsing ? "Understanding…" : "Understand rule"}
                  </button>
                ) : (
                  <>
                    <button
                      onClick={handleConfirmRule}
                      disabled={savingRule}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-500 text-white text-xs font-semibold disabled:opacity-40 active:scale-95 transition-transform"
                    >
                      {savingRule ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                      Save rule
                    </button>
                    <button
                      onClick={() => { setPending(null); setRuleText(""); }}
                      className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-semibold active:scale-95 transition-transform"
                    >
                      Cancel
                    </button>
                  </>
                )}
              </div>
            </div>

            {rules.length === 0 ? (
              <p className="px-4 py-3 text-xs text-slate-400 dark:text-slate-500">No rules yet — add one above</p>
            ) : (
              rules.map((rule) => (
                <div key={rule.id} className="flex items-start gap-3 px-4 py-3 border-t border-slate-50 dark:border-slate-700/50">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-slate-700 dark:text-slate-200 leading-snug">{rule.description}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <code className="text-[10px] font-mono text-slate-400 dark:text-slate-500">{rule.pattern}</code>
                      <span className="text-slate-300 dark:text-slate-600 text-[10px]">→</span>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: colours[rule.category] ?? CATEGORY_COLOURS[rule.category] ?? DEFAULT_CUSTOM_COLOUR }} />
                      <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">{rule.category}</span>
                    </div>
                  </div>
                  <button onClick={() => {
                    api.deleteRule(rule.id).then(() => setRules(prev => prev.filter(r => r.id !== rule.id))).catch(() => {});
                  }} className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-red-50 dark:bg-red-900/20 mt-0.5">
                    <Trash2 size={12} color="#ef4444" />
                  </button>
                </div>
              ))
            )}
          </div>

        </div>
      </div>
    </>
  );
}
