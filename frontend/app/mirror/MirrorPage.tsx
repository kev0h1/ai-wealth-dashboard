"use client";

import { Suspense, useEffect, useState, useCallback, useId, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, RefreshCw } from "lucide-react";
import { api, MirrorPortrait, MirrorTrait, ActiveAim, type CompletedAim } from "@/lib/api";
import { goBack } from "@/lib/goBack";
import AimSheet from "@/components/AimSheet";
import MirrorNextStep, { type MirrorStepKind } from "@/components/MirrorNextStep";
import MirrorFeedbackCard from "@/components/MirrorFeedbackCard";
import MirrorEvidence from "@/components/MirrorEvidence";
import { DisclosureChevron } from "@/components/Disclosure";
import { usePreferences } from "@/components/PreferencesContext";
import { completedFor, leadingTrait, mirrorCategory } from "@/lib/mirrorFeedback";
import { invalidateSignalsCache, fetchSignals, type SignalMap } from "@/lib/signalsCache";

// Kind → colour chip accent (Category Voice Rule: ~15% tint bg + full-strength icon)
// chip text uses a dark hue-matched shade (not neutral gray) for contrast on the tinted bg
const KIND_ACCENT: Record<string, { bg: string; darkBg: string; dot: string; text: string; darkText: string }> = {
  structure: { bg: "bg-indigo-50", darkBg: "dark:bg-indigo-900/20", dot: "bg-indigo-500", text: "text-indigo-800", darkText: "dark:text-indigo-200" },
  habit:     { bg: "bg-emerald-50", darkBg: "dark:bg-emerald-900/20", dot: "bg-emerald-500", text: "text-emerald-800", darkText: "dark:text-emerald-200" },
  pleasure:  { bg: "bg-violet-50", darkBg: "dark:bg-violet-900/20", dot: "bg-violet-500", text: "text-violet-800", darkText: "dark:text-violet-200" },
  hygiene:   { bg: "bg-slate-100", darkBg: "dark:bg-slate-700/40", dot: "bg-slate-400", text: "text-slate-700", darkText: "dark:text-slate-200" },
};


// Category a trait is anchored to: prefer the machine-readable ref_category the
// backend now sends; fall back to parsing "Your Signature: {X}" titles for
// portraits computed before the field existed.
export function traitCategory(trait: MirrorTrait): string | null {
  if (trait.ref_category) return trait.ref_category;
  const m = trait.title.match(/^Your Signature:\s*(.+)$/i);
  return m ? m[1].trim() : null;
}

/** The ONE next step a "change it" leads to, by trait kind (G242): an aim for a
 *  category-backed trait, a checkpoint for the Front-Loader, a plan for the saving
 *  habit. Traits with none of these (the Orchestrator, hygiene) get the plain note. */
export function nextStepKind(trait: MirrorTrait): MirrorStepKind | null {
  if (traitCategory(trait)) return "aim";
  if (trait.id === "front_loader") return "checkpoint";
  if (trait.id === "saving_habit") return "plan";
  return null;
}

export const KEEP_NOTE = "That is part of how you do things, so it stays as it is and I will not nag you about it.";

export function TraitCard({ trait, activeAim, onChoice, onSetAim, nextStep }: {
  trait: MirrorTrait;
  activeAim: ActiveAim | null;
  onChoice: (id: string, choice: "keep" | "change") => void;
  onSetAim: (category: string) => void;
  // The ONE concrete step shown after "change it", in place of the generic line.
  nextStep?: React.ReactNode;
}) {
  const accent = KIND_ACCENT[trait.kind] ?? KIND_ACCENT.structure;
  const [saving, setSaving] = useState(false);
  const category = traitCategory(trait);

  async function handleChoice(choice: "keep" | "change") {
    if (saving || trait.choice === choice) return;
    setSaving(true);
    try {
      await api.setMirrorChoice(trait.id, choice);
      onChoice(trait.id, choice);
      // Change on a category-backed trait opens the aim editor at once, so the
      // choice becomes something Penny can track (skipped if an aim exists).
      if (choice === "change" && category && !activeAim) {
        onSetAim(category);
      }
    } catch {
      // silently ignore — UI already reflects optimistic state via parent
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl glass-card overflow-hidden">
      {/* Header band */}
      <div className="px-4 pt-4 pb-3">
        <p className="text-base font-bold text-slate-900 dark:text-slate-100 leading-snug">{trait.title}</p>
        <p className="text-sm text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">{trait.narrative}</p>
      </div>

      {/* Evidence: clean muted lines */}
      {trait.evidence.length > 0 && (
        <div className="px-4 pb-3 space-y-1">
          {trait.evidence.map((e, i) => (
            <p key={i} className="text-[13px] text-slate-500 dark:text-slate-400 leading-snug">{e}</p>
          ))}
        </div>
      )}

      {/* Choice buttons */}
      <div className="px-4 pb-4 flex gap-2">
        <button
          onClick={() => handleChoice("keep")}
          disabled={saving}
          className={`flex-1 text-xs font-semibold py-2 px-3 min-h-[44px] rounded-xl border transition-[transform,opacity,background-color,color,border-color] duration-150 active:scale-[0.98] hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
            trait.choice === "keep"
              ? "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800"
              : "border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300"
          }`}
        >
          This is me, keep it
        </button>
        <button
          onClick={() => handleChoice("change")}
          disabled={saving}
          className={`flex-1 text-xs font-semibold py-2 px-3 min-h-[44px] rounded-xl border transition-[transform,opacity,background-color,color,border-color] duration-150 active:scale-[0.98] hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
            trait.choice === "change"
              ? "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800"
              : "border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300"
          }`}
        >
          This isn&apos;t me, change it
        </button>
      </div>

      {/* Next step (G242): one concrete thing, instead of the generic line */}
      {trait.choice === "change" && nextStep}

      {/* Confirmation line */}
      {trait.choice && !(trait.choice === "change" && nextStep) && (
        <div className="px-4 pb-4 -mt-1">
          {trait.choice === "keep" ? (
            <p className="text-[13px] text-slate-500 dark:text-slate-400">
              {KEEP_NOTE}
            </p>
          ) : category && activeAim ? (
            <p className="text-[13px] text-slate-500 dark:text-slate-400">
              Aim set, Penny is tracking it with you.
            </p>
          ) : category ? (
            <p className="text-[13px] text-slate-500 dark:text-slate-400">
              Noted, an aim gives Penny something to track.{" "}
              <button
                onClick={() => onSetAim(category)}
                className="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
              >
                Set an aim
              </button>
            </p>
          ) : (
            <p className="text-[13px] text-slate-500 dark:text-slate-400">
              Noted, Penny will factor this in.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-2xl glass-card p-4 animate-pulse">
      <div className="space-y-2">
        <div className="h-4 w-48 bg-slate-200 dark:bg-slate-700 rounded" />
        <div className="h-3 w-full bg-slate-100 dark:bg-slate-700/60 rounded" />
        <div className="h-3 w-3/4 bg-slate-100 dark:bg-slate-700/60 rounded" />
      </div>
      <div className="mt-3 flex gap-1.5">
        <div className="h-6 w-28 bg-slate-100 dark:bg-slate-700/60 rounded-full" />
        <div className="h-6 w-36 bg-slate-100 dark:bg-slate-700/60 rounded-full" />
      </div>
      <div className="mt-3 flex gap-2">
        <div className="flex-1 h-9 bg-slate-100 dark:bg-slate-700/60 rounded-xl" />
        <div className="flex-1 h-9 bg-slate-100 dark:bg-slate-700/60 rounded-xl" />
      </div>
    </div>
  );
}

export default function MirrorPage() {
  return <Suspense fallback={<div className="mx-auto max-w-2xl p-4"><SkeletonCard /></div>}><MirrorContent /></Suspense>;
}

function MirrorContent() {
  const router = useRouter();
  const fromSpend = useSearchParams().get("from") === "spend";
  const { hideNetWorth, preferencesReady } = usePreferences();
  const masked = !preferencesReady || hideNetWorth;
  const [portrait, setPortrait] = useState<MirrorPortrait | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [aims, setAims] = useState<ActiveAim[]>([]);
  const [history, setHistory] = useState<CompletedAim[]>([]);
  const [feedbackLoading, setFeedbackLoading] = useState(true);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [signals, setSignals] = useState<SignalMap>({});
  const [editor, setEditor] = useState<{ category: string; activeId?: string; seed?: number } | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [otherPatternsOpen, setOtherPatternsOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const portraitRequest = useRef(0);
  const feedbackRequest = useRef(0);
  const primaryPanel = useRef<HTMLDivElement>(null);
  const otherPatternsId = useId();

  const loadFeedback = useCallback(async () => {
    const request = ++feedbackRequest.current;
    setFeedbackLoading(true);
    setFeedbackError(null);
    try {
      // Resolution happens on the server. No browser-date outcome or
      // reconstruction of a completed benchmark from the current aim.
      const [active, completed] = await Promise.all([api.listCheckpoints(), api.completedCheckpoints()]);
      if (request !== feedbackRequest.current) return;
      setAims(active.checkpoints);
      setHistory(completed.checkpoints);
    } catch {
      if (request === feedbackRequest.current) setFeedbackError("Aim feedback could not be loaded.");
    } finally {
      if (request === feedbackRequest.current) setFeedbackLoading(false);
    }
  }, []);

  const loadPortrait = useCallback(async (refresh = false) => {
    const request = ++portraitRequest.current;
    setLoadError(false);
    try {
      const data = await api.getMirror(refresh);
      if (request === portraitRequest.current) setPortrait(data);
    } catch {
      if (request === portraitRequest.current) setLoadError(true);
    } finally {
      if (request === portraitRequest.current) { setLoading(false); setRefreshing(false); }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) { void loadPortrait(); void loadFeedback(); }
    });
    fetchSignals(0).then(data => { if (!cancelled) setSignals(data); }).catch(() => {});
    return () => {
      cancelled = true;
      // These are request generations, not element refs. Invalidate every
      // outstanding response, including a refresh started after mount.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      ++portraitRequest.current;
      // eslint-disable-next-line react-hooks/exhaustive-deps
      ++feedbackRequest.current;
    };
  }, [loadPortrait, loadFeedback]);

  const traits = portrait?.status === "ok" ? portrait.traits : [];
  const primary = traits.find(t => t.id === focusedId) ?? leadingTrait(traits, aims, history);
  const others = traits.filter(t => t.id !== primary?.id);
  const category = primary ? mirrorCategory(primary) : null;
  const current = category ? aims.find(a => a.ref === category) ?? null : null;
  const completed = completedFor(category, history);
  const monthsLabel = portrait?.status === "ok" ? Math.round(portrait.window_days / 30) : 6;

  async function choose(trait: MirrorTrait, choice: "keep" | "change") {
    await api.setMirrorChoice(trait.id, choice);
    setFocusedId(id => id ?? primary?.id ?? trait.id);
    setPortrait(previous => previous?.status === "ok" ? {
      ...previous, traits: previous.traits.map(t => t.id === trait.id ? { ...t, choice } : t),
    } : previous);
  }

  function openEditor(trait: MirrorTrait, seed?: number) {
    const ref = mirrorCategory(trait);
    if (!ref) return;
    if (masked) { setNotice("Show figures to set or adjust an aim."); return; }
    const active = aims.find(a => a.ref === ref);
    setEditor({ category: ref, activeId: active?.id, seed: active?.aim_amount ?? seed });
  }

  function afterAimWrite() {
    invalidateSignalsCache();
    void loadFeedback();
  }

  async function keepPace(trait: MirrorTrait, amount: number) {
    if (masked) throw new Error("Show figures before choosing an aim.");
    const ref = mirrorCategory(trait);
    if (!ref) throw new Error("This trait has no category aim.");
    const active = aims.find(a => a.ref === ref);
    if (active) await api.updateCheckpoint(active.id, amount);
    else await api.createCheckpoint(ref, amount);
    afterAimWrite();
  }

  async function stopAim(trait: MirrorTrait) {
    const active = aims.find(a => a.ref === mirrorCategory(trait));
    if (!active) throw new Error("There is no active aim to stop.");
    await api.cancelCheckpoint(active.id);
    setAims(previous => previous.filter(a => a.id !== active.id));
    afterAimWrite();
  }

  function renderTrait(trait: MirrorTrait) {
    const ref = mirrorCategory(trait);
    const active = ref ? aims.find(a => a.ref === ref) ?? null : null;
    const last = completedFor(ref, history);
    const kind = nextStepKind(trait);
    return <MirrorFeedbackCard
      key={trait.id}
      trait={trait} category={ref} activeAim={active} completed={last}
      loading={feedbackLoading} error={feedbackError} masked={masked}
      onChoice={choice => choose(trait, choice)}
      onEdit={seed => openEditor(trait, seed)}
      onKeep={amount => keepPace(trait, amount)}
      onStop={() => stopAim(trait)}
      onRetry={() => void loadFeedback()}
      nextStep={kind ? <MirrorNextStep
        kind={kind} category={ref ?? undefined}
        amount={masked ? null : ref ? signals[ref]?.suggested_aim ?? null : null}
        onAct={() => kind === "plan" ? router.push("/planning") : openEditor(trait)}
        onSeeNext={() => router.push("/spend?view=period")}
      /> : undefined}
    />;
  }

  return (
    <div className="min-h-dvh pb-[calc(9rem+env(safe-area-inset-bottom,0px))] text-slate-900 dark:text-slate-100 lg:pb-8" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      <main className="mx-auto max-w-[1080px] px-4 pb-2 pt-6">
        <header className="max-w-2xl">
          <button type="button" onClick={() => fromSpend ? router.push("/spend?view=period") : goBack(router)} className="mb-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg text-sm font-medium text-slate-600 active:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:text-slate-300">
            <ChevronLeft size={16} aria-hidden="true" />{fromSpend ? "Back to Spend" : "Back"}
          </button>
          <h1 className="text-[28px] font-bold leading-tight tracking-tight">How your money behaves</h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">Computed from your last {monthsLabel} months of transactions. No judgement, just what the data says.</p>
          {!loading && portrait?.status === "ok" && <button
            type="button" disabled={refreshing} onClick={() => { setRefreshing(true); void loadPortrait(true); void loadFeedback(); }}
            className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-lg text-[13px] font-semibold text-indigo-700 hover:text-indigo-800 active:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:opacity-50 dark:text-indigo-300 dark:hover:text-indigo-200"
          ><RefreshCw size={16} aria-hidden="true" className={`text-slate-500 dark:text-slate-400 ${refreshing ? "animate-spin motion-reduce:animate-none" : ""}`} />{refreshing ? "Recomputing…" : "Recompute"}</button>}
        </header>
        {notice && <p role="status" className="mt-3 text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">{notice}</p>}
        {loading ? <div className="mt-5 max-w-2xl space-y-4" role="status" aria-label="Loading your money patterns">{[1, 2].map(i => <SkeletonCard key={i} />)}</div>
          : loadError && !portrait ? <section className="mt-5 max-w-2xl rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
            <h2 className="text-base font-bold">Your patterns could not be loaded</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">No new result has been estimated. Try again when you have a connection.</p>
            <button type="button" onClick={() => void loadPortrait()} className="mt-2 min-h-11 rounded-lg text-sm font-semibold text-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:text-indigo-300">Try again</button>
          </section>
          : portrait?.status === "insufficient_data" ? <section className="mt-5 max-w-2xl rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
            <h2 className="text-base font-bold">Not enough history yet</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">The Mirror needs at least 60 days of transactions. A result waits until there is enough recorded history.</p>
          </section>
          : primary && portrait?.status === "ok" ? <>
            {loadError && <p role="status" className="mt-3 text-[13px] text-slate-600 dark:text-slate-300">The refresh did not finish. The portrait below is the previous snapshot, checked on {new Date(portrait.computed_at).toLocaleDateString("en-GB")}.</p>}
            <div className="mt-5 grid items-start gap-4 min-[900px]:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] min-[900px]:gap-6">
              <div className="min-w-0">
                <div ref={primaryPanel} tabIndex={-1} className="rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-500">{renderTrait(primary)}</div>
                {others.length > 0 && <section className="mt-4 border-t border-slate-300 dark:border-slate-600">
                  <button type="button" aria-expanded={otherPatternsOpen} aria-controls={otherPatternsId} onClick={() => setOtherPatternsOpen(open => !open)} className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg text-left text-[13px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">
                    Other patterns<DisclosureChevron open={otherPatternsOpen} />
                  </button>
                  <div id={otherPatternsId} hidden={!otherPatternsOpen} className="space-y-4 pt-2">
                    <p className="text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">Each trait has its own choice. Kept traits receive no coaching.</p>
                    {others.map(trait => <div key={trait.id}>
                      {renderTrait(trait)}
                      <button type="button" onClick={() => {
                        setFocusedId(trait.id);
                        setOtherPatternsOpen(false);
                        requestAnimationFrame(() => { primaryPanel.current?.focus(); primaryPanel.current?.scrollIntoView({ block: "start" }); });
                      }} className="mt-1 inline-flex min-h-11 items-center rounded-lg text-[13px] font-semibold text-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:text-indigo-300">View this pattern’s evidence</button>
                    </div>)}
                  </div>
                </section>}
              </div>
              <MirrorEvidence key={`${primary.id}:${current?.id ?? completed?.id ?? "portrait"}`} trait={primary} checkpointId={primary.choice === "change" && !feedbackLoading && !feedbackError ? current?.id ?? completed?.id ?? null : null} masked={masked} computedAt={portrait.computed_at} />
            </div>
          </> : <p className="mt-5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">No distinct patterns are recorded yet. Check again after more transactions have synced.</p>}
      </main>
      {editor && !masked && <AimSheet
        category={editor.category}
        existingAmount={editor.activeId ? editor.seed : undefined}
        baseline={editor.seed != null ? { usual: null, suggestedAim: editor.seed } : undefined}
        onClose={() => setEditor(null)}
        onSubmit={async amount => {
          if (editor.activeId) {
            if (amount == null) throw new Error("Enter an amount for this aim.");
            await api.updateCheckpoint(editor.activeId, amount);
          } else await api.createCheckpoint(editor.category, amount);
          afterAimWrite();
        }}
      />}
    </div>
  );
}
