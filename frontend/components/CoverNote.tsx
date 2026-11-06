import type { ReactNode } from "react";

/** G428: a watch-tone sentence is ink with a small leading amber dot, never amber prose (DESIGN.md, Figures Are Ink). */
export default function CoverNote({ children, className = "text-[12px]", ...rest }: { children: ReactNode; className?: string } & Record<`data-${string}`, string | boolean | undefined>) {
  return (
    <p {...rest} className={`flex items-start gap-2 leading-snug text-slate-700 dark:text-slate-200 ${className}`}>
      <span aria-hidden="true" className="mt-[5px] size-1.5 shrink-0 rounded-full bg-amber-500" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}
