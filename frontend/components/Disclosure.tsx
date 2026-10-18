"use client";

import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { ChevronDown } from "lucide-react";

type DisclosureSummaryProps = ComponentPropsWithoutRef<"summary">;

const iconClass = "shrink-0 pointer-events-none transition-transform duration-150 motion-reduce:transition-none";
const neutralTone = "text-slate-500 dark:text-slate-400";

/** Controlled inline disclosures share the native summary's indicator. */
export function DisclosureChevron({ open, className = "", inverse = false }: { open: boolean; className?: string; inverse?: boolean }) {
  return <ChevronDown aria-hidden="true" size={16} className={`${iconClass} ${inverse ? "text-white dark:text-white" : neutralTone} ${open ? "rotate-180" : ""} ${className}`} />;
}

/**
 * Native disclosure heading with one consistent, accessible indicator.
 *
 * The indicator is deliberately styled through the direct parent details
 * selector in globals.css. A nested disclosure therefore never inherits the
 * open state of an ancestor disclosure.
 */
export const DisclosureSummary = forwardRef<HTMLElement, DisclosureSummaryProps>(
  function DisclosureSummary({ className = "", children, ...props }, ref) {
    return (
      <summary ref={ref} className={`disclosure-summary flex items-center justify-between gap-2 list-none marker:content-none [&::-webkit-details-marker]:hidden ${className}`} {...props}>
        {children}
        <ChevronDown aria-hidden="true" size={16} className={`disclosure-chevron ${iconClass} ${neutralTone}`} />
      </summary>
    );
  },
);

DisclosureSummary.displayName = "DisclosureSummary";
