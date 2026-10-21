"use client";

import { useEffect, useRef, type FormEvent, type ReactNode } from "react";
import { editorQuiet } from "@/components/upcoming/editorSupport";

export const PLAN_EDITOR_STEPS = ["purpose", "details", "source", "destination", "tracking", "review"] as const;
export type PlanEditorStep = typeof PLAN_EDITOR_STEPS[number];
const labels: Record<PlanEditorStep, string> = {
  purpose: "Purpose", details: "Details", source: "Source", destination: "Destination", tracking: "Tracking", review: "Review",
};
const primary = "min-h-11 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-60";

type ActionProps = {
  step: PlanEditorStep;
  reviewing?: boolean;
  busy?: boolean;
  locked?: boolean;
  needsRefresh?: boolean;
  formId: string;
  onBack(): void;
  onContinue(): void;
  continueDisabled?: boolean;
  canSave?: boolean;
  submitLabel?: string;
  backLabel?: string;
  reviewLabel?: string;
};

/** One final save action, shared by goal and set-aside edit sheets. */
export function PlanEditorActions({ step, reviewing = false, busy = false, locked = busy, needsRefresh = false, formId, onBack, onContinue, continueDisabled = false, canSave = true, submitLabel = "Save changes", backLabel = "Back to plan", reviewLabel = "Review changes" }: ActionProps) {
  return <div className="grid grid-cols-2 gap-3">
    <button type="button" onClick={onBack} disabled={busy} className={editorQuiet}>{backLabel}</button>
    {step === "review"
      ? <button type="submit" form={formId} disabled={busy || !canSave} className={primary}>{needsRefresh ? "Retry refresh" : busy ? "Saving…" : submitLabel}</button>
      : <button type="button" onClick={event => { event.preventDefault(); onContinue(); }} disabled={locked || continueDisabled} className={primary}>{reviewing ? "Return to review" : step === "tracking" ? reviewLabel : "Continue"}</button>}
  </div>;
}

type FlowProps = ActionProps & {
  onSubmit(event: FormEvent<HTMLFormElement>): void;
  children: ReactNode;
  error?: ReactNode;
  onPrevious?(): void;
  renderActions?: (actions: ReactNode) => ReactNode;
  className?: string;
};

/** The approved Small steps editor shell. Domain-specific fields, validation
 * and persistence stay with their controller; navigation never writes. */
export default function PlanEditorFlow({ children, error, onSubmit, onPrevious, renderActions, className = "space-y-5", ...actions }: FlowProps) {
  const heading = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: "nearest" });
  }, [actions.step]);
  const footer = <PlanEditorActions {...actions} />;
  return <form id={actions.formId} data-plan-editor-step={actions.step} onSubmit={onSubmit} aria-busy={actions.busy || undefined}
    onKeyDown={event => {
      const target = event.target;
      if (event.key === "Enter" && target instanceof HTMLInputElement && !["radio", "checkbox"].includes(target.type)) {
        event.preventDefault();
        if (actions.step !== "review" && !actions.busy && !actions.locked && !actions.continueDisabled) actions.onContinue();
      }
    }} className={className}>
    <fieldset disabled={actions.locked ?? actions.busy} className="min-w-0 space-y-5 [&_input]:text-base">
      <p ref={heading} tabIndex={-1} className="text-xs font-semibold text-slate-600 outline-none dark:text-slate-300">{labels[actions.step]} · {PLAN_EDITOR_STEPS.indexOf(actions.step) + 1} of {PLAN_EDITOR_STEPS.length}</p>
      {children}
      {onPrevious && actions.step !== "purpose" && actions.step !== "review" && <button type="button" onClick={onPrevious} className={editorQuiet}>Previous step</button>}
    </fieldset>
    {error}
    {renderActions ? renderActions(footer) : footer}
  </form>;
}
