import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * The bounded surface used by Settings controls. Keeping the shell shared
 * makes the design preview exercise the same card boundary as production.
 */
export default function SettingsCard({
  children,
  className = "",
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return <div id={id} className={`glass-card overflow-hidden rounded-2xl ${className}`}>{children}</div>;
}

export function SettingsCardHeader({
  icon: Icon,
  hex,
  title,
  subtitle,
}: {
  icon: LucideIcon;
  hex: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex items-start gap-2.5 border-b border-slate-100 px-4 py-3 dark:border-slate-700">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-xl" style={{ background: `${hex}26` }} aria-hidden="true">
        <Icon size={16} style={{ color: hex }} />
      </span>
      <div className="min-w-0 pt-0.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</p>
        {subtitle && <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>
    </div>
  );
}
