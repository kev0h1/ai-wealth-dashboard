"use client";

import { useEffect, useState } from "react";
import { SheetFrame } from "@/components/SheetFrame";

// G215: the designed replacement for window.alert and window.confirm. A compact
// SheetFrame (G192 anatomy: title, one sentence, 44 px actions in the footer).
// Call `noticeSheet` or `confirmSheet` from anywhere; `<ConfirmSheetHost />`
// (mounted once in Providers) renders whatever is queued, one sheet at a time.

type Request = {
  id: number;
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel: string | null;
  resolve: (ok: boolean) => void;
};

let nextId = 1;
let queue: Request[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

function enqueue(req: Omit<Request, "id" | "resolve">): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    queue = [...queue, { ...req, id: nextId++, resolve }];
    emit();
  });
}

/** Promise-based confirmation. Resolves true on the primary action, false on cancel or dismiss. */
export function confirmSheet(opts: { title: string; body?: string; confirmLabel?: string; cancelLabel?: string }): Promise<boolean> {
  return enqueue({
    title: opts.title,
    body: opts.body,
    confirmLabel: opts.confirmLabel ?? "Confirm",
    cancelLabel: opts.cancelLabel ?? "Cancel",
  });
}

/** One-button notice, the alert() replacement. Resolves when dismissed. */
export function noticeSheet(opts: { title: string; body?: string; closeLabel?: string }): Promise<void> {
  return enqueue({ title: opts.title, body: opts.body, confirmLabel: opts.closeLabel ?? "OK", cancelLabel: null }).then(() => undefined);
}

export function ConfirmSheetHost() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force(n => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  const current = queue[0];
  if (!current) return null;
  const finish = (ok: boolean) => {
    queue = queue.filter(r => r.id !== current.id);
    current.resolve(ok);
    emit();
  };
  return <ConfirmSheetView key={current.id} title={current.title} body={current.body} confirmLabel={current.confirmLabel} cancelLabel={current.cancelLabel} onResult={finish} />;
}

export function ConfirmSheetView({ title, body, confirmLabel, cancelLabel, onResult, manageHistory = true }: {
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel: string | null;
  onResult: (ok: boolean) => void;
  manageHistory?: boolean;
}) {
  return (
    <SheetFrame
      variant="compact"
      title={title}
      description={body}
      onClose={() => onResult(false)}
      manageHistory={manageHistory}
      bodyClassName="px-5 py-0"
      footer={({ close }) => (
        <div className="flex gap-3">
          {cancelLabel && (
            <button type="button" onClick={close} className="min-h-11 flex-1 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 active:scale-95 dark:border-slate-600 dark:text-slate-200">
              {cancelLabel}
            </button>
          )}
          <button type="button" onClick={() => onResult(true)} className="min-h-11 flex-1 rounded-xl bg-indigo-600 text-sm font-semibold text-white active:scale-95 hover:bg-indigo-700">
            {confirmLabel}
          </button>
        </div>
      )}
    >
      <span className="sr-only">{body ?? title}</span>
    </SheetFrame>
  );
}
