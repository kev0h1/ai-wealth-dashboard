import type { ReactNode } from "react";

/** G240 (approved A, Clear runway): the empty-thread state of the Penny sheet
 * on phones. Presentational only: PennyConversation supplies the chips (its
 * own allChips, one source) and /design/penny-fullscreen renders this same
 * component with fixture chips, so the layout cannot drift from what Kevin
 * approved. Hidden at lg (the floating window keeps its chip row) and, via
 * data-penny-fs-secondary, while the software keyboard is up. */
export default function PennyStarterState({ children }: { children?: ReactNode }) {
  return (
    <div data-penny-fs-secondary className="lg:hidden flex min-h-full flex-col items-center justify-center py-6 text-center">
      <p className="text-base font-semibold text-slate-900 dark:text-slate-100">What would you like to check?</p>
      <p className="mt-1 max-w-[20rem] text-balance text-sm text-slate-600 dark:text-slate-300">Ask about your money, or start with one of these.</p>
      {children && <div className="mt-4 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}
