"use client";

// The quiet route from Spend to the Mirror (G242, moved by G262): one 44px row
// at the head of "The rest of your spending", "How your money behaves".
// Informational, so no Penny gradient. `from=spend` lets the Mirror offer
// "Back to Spend".
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import PennyMark from "@/components/PennyMark";

export default function MirrorRouteLink({ href = "/mirror?from=spend" }: { href?: string }) {
  return (
    <Link
      href={href}
      className="flex min-h-[44px] items-center gap-2 border-b border-slate-100 px-4 text-[13px] font-semibold text-slate-700 transition-[opacity,background-color] hover:bg-slate-50 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:border-slate-700/50 dark:text-slate-200 dark:hover:bg-slate-800/60"
    >
      <PennyMark size={13} className="text-slate-500 dark:text-slate-400" />
      <span className="min-w-0 flex-1">How your money behaves</span>
      <ChevronRight size={15} aria-hidden="true" className="shrink-0 text-slate-400 dark:text-slate-500" />
    </Link>
  );
}
