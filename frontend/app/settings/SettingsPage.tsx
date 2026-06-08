"use client";

import { useRef, useEffect, useState } from "react";
import { RotateCcw, LogOut, Plus, Trash2, Loader2, Check, AlertCircle } from "lucide-react";
import { CATEGORIES, CATEGORY_COLOURS, DEFAULT_CUSTOM_COLOUR } from "@/lib/categories";
import { useColours } from "@/components/ColourProvider";
import { useAuth } from "@/components/AuthProvider";
import { usePreferences, Region } from "@/components/PreferencesContext";
import { useCategories } from "@/components/CategoriesContext";
import { api } from "@/lib/api";
import BottomNav from "@/components/BottomNav";

interface Rule {
  id: string;
  description: string;
  pattern: string;
  category: string;
  created_at: string;
}

// Inline colour-editable dot for a category
function ColourDot({ cat, colour, onChange, onReset, isModified }: {
  cat: string; colour: string; onChange: (hex: string) => void;
  onReset: () => void; isModified: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="relative flex-shrink-0">
      <button
        onClick={() => ref.current?.click()}
        title={`Change colour for ${cat}`}
        className="w-4 h-4 rounded-full shadow-sm ring-2 ring-white dark:ring-slate-700 active:scale-90 transition-transform"
        style={{ backgroundColor: colour }}
      />
      <input type="color" ref={ref} value={colour} onChange={(e) => onChange(e.target.value)} className="sr-only" tabIndex={-1} />
      {isModified && (
        <button
          onClick={(e) => { e.stopPropagation(); onReset(); }}
          title="Reset to default"
          className="absolute -top-1 -right-1 w-3 h-3 bg-slate-400 rounded-full flex items-center justify-center"
        >
          <RotateCcw size={6} color="#fff" />
        </button>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const { colours, setColour, resetColour } = useColours();
  const { user, logout } = useAuth();
  const { darkMode, setDarkMode, region, setRegion } = usePreferences();
  const { allCategories, customCategories, addCategory, deleteCategory, defaultColour: catDefaultColour } = useCategories();

  const [newCatName, setNewCatName] = useState("");
  const [addingCat, setAddingCat] = useState(false);
  const [catError, setCatError] = useState("");

  const [rules, setRules] = useState<Rule[]>([]);
  const [ruleText, setRuleText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [pending, setPending] = useState<{ pattern: string; category: string } | null>(null);
  const [ruleError, setRuleError] = useState("");
  const [savingRule, setSavingRule] = useState(false);

  const [syncingHistory, setSyncingHistory] = useState(false);
  const [syncHistoryMsg, setSyncHistoryMsg] = useState<{ text: string; ok: boolean } | null>(null);

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

  async function handleSyncHistory() {
    setSyncingHistory(true); setSyncHistoryMsg(null);
    try {
      const res = await api.syncHistory();
      setSyncHistoryMsg({ text: res.message || "Full sync complete", ok: true });
    } catch (e: unknown) {
      setSyncHistoryMsg({ text: e instanceof Error ? e.message : "Sync failed", ok: false });
    } finally {
      setSyncingHistory(false);
      setTimeout(() => setSyncHistoryMsg(null), 4000);
    }
  }

  return (
    <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-20 lg:pb-8 lg:max-w-6xl lg:mx-auto">
      <div className="px-4 pb-5 text-white" style={{ background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)", paddingTop: "calc(env(safe-area-inset-top, 0px) + 1.5rem)" }}>
        <h1 className="text-xl font-bold">Settings</h1>
        <p className="text-sm opacity-70 mt-1">Customise your dashboard</p>
      </div>

      <div className="px-4 pt-4 space-y-3">

        {/* ── Display ── */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Display</p>
          </div>
          <div className="flex items-center justify-between px-4 py-3.5">
            <div>
              <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Dark Mode</p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Easier on the eyes at night</p>
            </div>
            <button
              onClick={() => setDarkMode(!darkMode)}
              className={`relative w-12 h-6 rounded-full transition-colors ${darkMode ? "bg-indigo-500" : "bg-slate-200 dark:bg-slate-600"}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${darkMode ? "translate-x-6" : "translate-x-0"}`} />
            </button>
          </div>
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 dark:border-slate-700">
            <div>
              <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Region</p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                {region === "UK" ? "TrueLayer open banking" : "Mono + M-Pesa + statements"}
              </p>
            </div>
            <div className="relative">
              <select
                value={region}
                onChange={(e) => setRegion(e.target.value as Region)}
                className="appearance-none bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-100 text-sm font-medium rounded-xl pl-3 pr-8 py-2 outline-none focus:ring-2 focus:ring-indigo-400 border border-transparent focus:border-indigo-400 cursor-pointer"
              >
                <option value="UK">🇬🇧 UK</option>
                <option value="Kenya">🇰🇪 Kenya</option>
              </select>
              <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
            </div>
          </div>
        </div>

        {/* ── Categories ── */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Categories</p>
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
                  <div key={cat} className="flex items-center gap-2 py-1.5 px-2.5 rounded-xl bg-slate-50 dark:bg-slate-700/50">
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

        {/* ── Data ── */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Data</p>
          </div>
          <div className="px-4 py-3.5">
            <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Sync all history</p>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 mb-3">Re-fetch the last 90 days from all connected banks.</p>
            <button
              onClick={handleSyncHistory}
              disabled={syncingHistory}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-500 text-white text-sm font-medium disabled:opacity-50 active:scale-95 transition-transform"
            >
              <RotateCcw size={14} className={syncingHistory ? "animate-spin" : ""} />
              {syncingHistory ? "Syncing…" : "Sync history (90 days)"}
            </button>
            {syncHistoryMsg && (
              <p className={`mt-2 text-xs font-medium ${syncHistoryMsg.ok ? "text-emerald-500" : "text-red-500"}`}>{syncHistoryMsg.text}</p>
            )}
          </div>
        </div>

        {/* ── Account ── */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-50 dark:border-slate-700">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-0.5">Account</p>
            {user?.name && <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{user.name}</p>}
            {user?.email && <p className="text-xs text-slate-400 dark:text-slate-500">{user.email}</p>}
          </div>
          <button
            onClick={logout}
            className="w-full flex items-center gap-3 px-4 py-3.5 text-left text-red-500 hover:bg-red-50 dark:hover:bg-red-900/10 active:bg-red-100 transition-colors"
          >
            <LogOut size={16} />
            <span className="text-sm font-medium">Sign out</span>
          </button>
        </div>

      </div>
      <BottomNav />
    </div>
  );
}
