"use client";

import { createElement, type ReactNode, type RefObject, useId, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import MoneyText from "@/components/MoneyText";
import { AimRing } from "@/components/AimProgress";
import { useColours } from "@/components/ColourProvider";
import { getCategoryColour } from "@/lib/categories";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { mirrorMoney, mirrorText, periodLabel } from "@/lib/mirrorFeedback";
import type { ActiveAim, CompletedAim, MirrorTrait } from "@/lib/api";
import styles from "./mirrorFeedback.module.css";

type Choice = "keep" | "change";

export default function MirrorFeedbackCard({
  trait,
  category,
  activeAim,
  completed,
  loading,
  error,
  masked,
  nextStep,
  onChoice,
  onEdit,
  onKeep,
  onStop,
  onRetry,
}: {
  trait: MirrorTrait;
  category: string | null;
  activeAim: ActiveAim | null;
  completed: CompletedAim | null;
  loading: boolean;
  error: string | null;
  masked: boolean;
  nextStep?: ReactNode;
  onChoice(choice: Choice): Promise<void>;
  onEdit(amount?: number): void;
  onKeep(amount: number): Promise<void>;
  onStop(): Promise<void>;
  onRetry(): void;
}) {
  const { colours } = useColours();
  const categoryName = category ?? trait.ref_category ?? null;
  const categoryColour = getCategoryColour(categoryName ?? undefined, colours);
  const statusId = useId();
  const stopTrigger = useRef<HTMLButtonElement>(null);
  const changeTrigger = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState<"choice" | "keep" | "stop" | null>(null);
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [confirmStop, setConfirmStop] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const completedId = useId();

  const choice = trait.choice;
  const canCoach = choice === "change";
  const hasFeedback = Boolean(activeAim || completed);

  async function run(kind: "choice" | "keep" | "stop", work: () => Promise<void>, success: string): Promise<boolean> {
    if (busy) return false;
    setBusy(kind);
    setActionError("");
    setMessage("");
    try {
      await work();
      setMessage(success);
      if (kind === "choice" || kind === "keep") setConfirmStop(false);
      return true;
    } catch {
      setActionError("That did not save. Please try again.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  function cancelStop() {
    setConfirmStop(false);
    stopTrigger.current?.focus();
  }

  const activePeriodDays = activeAim?.period_start && activeAim.period_end
    ? Math.max(1, Math.round((Date.parse(activeAim.period_end) - Date.parse(activeAim.period_start)) / 86_400_000) + 1)
    : Math.max(1, (activeAim?.days_left ?? 0) + 1);

  return (
    <section className={styles.card} aria-labelledby={`${statusId}-title`} aria-describedby={statusId}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          {categoryName && (
            <span className={styles.category} style={{ backgroundColor: `${categoryColour}26`, color: categoryColour }} aria-hidden="true">
              {createElement(getCategoryIcon(categoryName ?? undefined), { size: 18, strokeWidth: 2 })}
            </span>
          )}
          <div className={styles.titleCopy}>
            <h2 id={`${statusId}-title`}><MoneyText text={mirrorText(trait.title, masked)} /></h2>
            <p id={statusId}><MoneyText text={mirrorText(trait.narrative, masked)} /></p>
          </div>
        </div>
        {trait.evidence.length > 0 && (
          <div className={styles.evidence}>
            {trait.evidence.map((item, index) => <p key={`${trait.id}-${index}`}><MoneyText text={mirrorText(item, masked)} /></p>)}
          </div>
        )}
        <div className={styles.choiceGrid} aria-label={mirrorText(`Choose what to do with ${trait.title}`, masked)}>
          <button
            type="button"
            className={styles.choice}
            aria-pressed={choice === "keep"}
            disabled={busy !== null}
            onClick={() => { if (choice !== "keep") void run("choice", () => onChoice("keep"), "Your choice has been saved."); }}
          >
            Keep this trait
          </button>
          <button
            type="button"
            ref={changeTrigger}
            className={styles.choice}
            aria-pressed={choice === "change"}
            disabled={busy !== null}
            onClick={() => { if (choice !== "change") void run("choice", () => onChoice("change"), "Your choice has been saved."); }}
          >
            Change this trait
          </button>
        </div>
      </header>

      <div className={styles.body}>
        {!canCoach ? (
          <p className={styles.quiet}>
            {choice === "keep"
              ? "That is part of how you do things. It stays as it is, with no coaching on this trait."
              : "Choose what feels right for this trait. Coaching stays off until you choose change."}
          </p>
        ) : loading ? (
          <div className={styles.loading} aria-label="Loading aim feedback">
            <span /><span /><span />
          </div>
        ) : error ? (
          <div className={styles.notice} role="status">
            <p>We could not load this check yet.</p>
            <button type="button" className={styles.textButton} onClick={onRetry}><RotateCcw size={15} aria-hidden="true" /> Try again</button>
          </div>
        ) : hasFeedback ? (
          <>
            {activeAim && <ActiveFeedback aim={activeAim} masked={masked} periodDays={activePeriodDays} onEdit={onEdit} onStop={() => setConfirmStop(true)} busy={busy} stopRef={stopTrigger} />}
            {completed && activeAim && (
              <div className={styles.completedToggle}>
                <button type="button" aria-expanded={showCompleted} aria-controls={completedId} className={styles.textButton} onClick={() => setShowCompleted(value => !value)}>
                  {showCompleted ? "Hide previous check" : "Show previous check"}
                </button>
              </div>
            )}
            {completed && <CompletedFeedback completed={completed} masked={masked} id={completedId} hidden={Boolean(activeAim && !showCompleted)} actions={!activeAim ? { onKeep: () => run("keep", () => onKeep(completed.aim_amount), "This pace is saved for the current pay period."), onEdit: () => onEdit(completed.aim_amount), busy } : undefined} />}
            {confirmStop && activeAim && (
              <div className={styles.confirmation} role="group" aria-label="Confirm stop checking this aim">
                <p>Stop checking this aim for the current period?</p>
                <p className={styles.quiet}>Your trait choice will stay unchanged.</p>
                <div className={styles.confirmActions}>
                  <button type="button" className={styles.primaryButton} disabled={busy !== null} onClick={() => { void run("stop", onStop, "This aim is no longer being checked.").then(saved => { if (saved) { setConfirmStop(false); changeTrigger.current?.focus(); } }); }}>Confirm stop</button>
                  <button type="button" className={styles.textButton} disabled={busy !== null} onClick={cancelStop}>Keep checking</button>
                </div>
              </div>
            )}
          </>
        ) : nextStep ? nextStep : (
          <p className={styles.quiet}>There is no current check for this trait yet.</p>
        )}
        {(message || actionError) && <p className={styles.status} role="status">{actionError || message}</p>}
      </div>
    </section>
  );
}

function ActiveFeedback({ aim, masked, periodDays, onEdit, onStop, busy, stopRef }: { aim: ActiveAim; masked: boolean; periodDays: number; onEdit(amount?: number): void; onStop(): void; busy: string | null; stopRef: RefObject<HTMLButtonElement | null> }) {
  const period = periodLabel(aim.period_start, aim.period_end);
  return <section className={styles.feedback} aria-label="Current aim">
    <div className={styles.feedbackHead}>
      <div>
        <h3>Your chosen pace is being checked</h3>
        {period && <p className={styles.quiet}>{period}</p>}
      </div>
      {!masked && <AimRing aim={aim} periodDays={periodDays} />}
    </div>
    <p className={styles.comparison}><MoneyText text={mirrorMoney(aim.spent_so_far, masked)} /> <span>of a</span> <MoneyText text={mirrorMoney(aim.aim_amount, masked)} /> <span>aim</span></p>
    <p className={styles.quiet}>{daysLeftLabel(aim.days_left)}. {aim.pace?.phrase ?? "Current pace is being checked"}. A pace check, not a limit.</p>
    <p className={styles.quiet}>The result will be checked from transactions at period end. There is nothing to tick off.</p>
    <div className={styles.actions}>
      <button type="button" className={styles.textButton} disabled={busy !== null} onClick={() => onEdit(aim.aim_amount)}>Adjust this aim</button>
      <button type="button" ref={stopRef} className={styles.textButton} disabled={busy !== null} onClick={onStop}>Stop checking this aim</button>
    </div>
  </section>;
}

function CompletedFeedback({ completed, masked, id, hidden, actions }: { completed: CompletedAim; masked: boolean; id: string; hidden: boolean; actions?: { onKeep(): void; onEdit(): void; busy: string | null } }) {
  const difference = Math.abs(completed.result_amount - completed.aim_amount);
  const comparison = completed.result_amount === completed.aim_amount ? "Matched the aim exactly" : completed.result_amount < completed.aim_amount ? "below the chosen pace" : "above the chosen pace";
  const checked = completed.resolved_at ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(completed.resolved_at)) : null;
  return <section id={id} hidden={hidden} className={styles.feedback} aria-label="Previous completed check">
    <div className={styles.feedbackHead}>
      <div><h3>What happened</h3><p className={styles.quiet}>{periodLabel(completed.period_start, completed.period_end)}</p></div>
      {checked && <p className={styles.checked}>Checked {checked}</p>}
    </div>
    <p className={styles.comparison}><MoneyText text={mirrorMoney(completed.result_amount, masked)} /> <span>against a</span> <MoneyText text={mirrorMoney(completed.aim_amount, masked)} /> <span>aim</span></p>
    <p className={styles.quiet}>{masked ? "Comparison amounts are hidden." : completed.result_amount === completed.aim_amount ? `${comparison}.` : <><MoneyText text={mirrorMoney(difference, false)} /> {comparison}.</>} Passing an aim is not a payment risk.</p>
    {!actions && <p className={styles.quiet}>This check is complete.</p>}
    {actions && <p className={styles.quiet}>Does this pace still fit? Choose a pace for the current pay period, or leave this check complete.</p>}
    {actions && <div className={styles.actions}>
      <button type="button" className={styles.compactButton} disabled={actions.busy !== null} onClick={actions.onKeep}>Keep this pace</button>
      <button type="button" className={styles.compactButton} disabled={actions.busy !== null} onClick={actions.onEdit}>Adjust aim</button>
    </div>}
  </section>;
}

function daysLeftLabel(days: number): string {
  if (days === 1) return "1 day left";
  return `${Math.max(0, days)} days left`;
}
