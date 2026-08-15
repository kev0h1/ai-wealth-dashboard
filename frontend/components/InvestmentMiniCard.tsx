"use client";

import { TrendingUp } from "lucide-react";
import { InvestmentAccount } from "@/lib/api";

const PROVIDER_META: Record<string, { bg: string }> = {
  VANGUARD:              { bg: "linear-gradient(135deg,#8b0000,#c0392b)" },
  WEALTHIFY:             { bg: "linear-gradient(135deg,#006d6d,#00a896)" },
  "HARGREAVES LANSDOWN": { bg: "linear-gradient(135deg,#002d72,#0057c2)" },
  HL:                    { bg: "linear-gradient(135deg,#002d72,#0057c2)" },
  FIDELITY:              { bg: "linear-gradient(135deg,#7b3f00,#c0602a)" },
  "AJ BELL":             { bg: "linear-gradient(135deg,#003087,#c0932a)" },
  NUTMEG:                { bg: "linear-gradient(135deg,#1a1a2e,#e94560)" },
  MONEYBOX:              { bg: "linear-gradient(135deg,#1b4f72,#2e86c1)" },
  TRADING212:            { bg: "linear-gradient(135deg,#006400,#228b22)" },
  FREETRADE:             { bg: "linear-gradient(135deg,#1a0a4a,#5e35b1)" },
};

function providerKey(provider: string) {
  return provider.toUpperCase().replace(/[\s-]+/g, " ").trim();
}

export function investmentBrandBg(provider: string): string {
  return (PROVIDER_META[providerKey(provider)] ?? { bg: "linear-gradient(135deg,#3730a3,#4f46e5)" }).bg;
}

/** Short kind word for the "provider · kind" line — mirrors AccountMiniCard's
 *  typeLabel() (Current/Savings/ISA/Credit). account_type is free text off a
 *  statement ("Stocks & Shares ISA", "SIPP"…), so this maps it down to a word
 *  short enough to never truncate next to the provider name. "Investment"
 *  only when nothing more specific is recognised. */
function investmentKindLabel(accountType: string | null | undefined): string {
  const t = (accountType ?? "").toLowerCase();
  if (t.includes("isa")) return "ISA";
  if (t.includes("sipp") || t.includes("pension")) return "Pension";
  if (t.includes("gia") || t.includes("general investment")) return "GIA";
  return "Investment";
}

interface Props {
  grid?: boolean;
  account: InvestmentAccount;
  onClick?: () => void;
  hidden?: boolean;
  /** Calm/quiet variant for the Home grid — whisper surfaces, no brand flood */
  calm?: boolean;
  /** Liquid-glass surface — requires calm=true */
  glass?: boolean;
  /** Position in a grid — drives the staggered entrance animation via
   *  --card-index (see .card-rise-in in globals.css). Omit to skip the
   *  animation. */
  index?: number;
}

export default function InvestmentMiniCard({ account, onClick, hidden, grid, calm, glass, index }: Props) {
  const meta = PROVIDER_META[providerKey(account.provider)] ?? { bg: "linear-gradient(135deg,#3730a3,#4f46e5)" };
  const value = account.display_value ?? account.total_value;
  const valueStr = `£${Math.abs(value).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  // ── Calm variant (Home grid) ─────────────────────────────────────────────
  // Structure mirrors AccountMiniCard's calm branch exactly — same badge/name
  // row, same balance-as-hero slot, same bottom-pinned secondary line — so
  // investment/ISA cards sit in the grid as one family with bank cards
  // instead of rendering through a divergent layout.
  if (calm) {
    const kindColour = "#34d399"; // matches ACCOUNT_KIND_COLOUR.ISA in AccountMiniCard
    const kindLabel = investmentKindLabel(account.account_type);
    return (
      <button
        onClick={onClick}
        style={index !== undefined ? ({ "--card-index": index } as React.CSSProperties) : undefined}
        className={`relative w-full h-[13rem] flex flex-col rounded-2xl text-left ${glass ? "glass-card" : "bg-white/60 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700/60"} ${index !== undefined ? "card-rise-in" : ""} active:scale-[0.98] transition-transform overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500`}
      >
        <div className="p-4 flex flex-col flex-1">
          {/* Top row: brand chip + name / provider·type — same slot as bank cards */}
          <div className="flex items-start gap-2.5 mb-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ring-1 ring-black/[0.06] dark:ring-white/[0.12]"
              style={{ background: meta.bg }}
            >
              <TrendingUp size={16} color="white" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-slate-700 dark:text-slate-200 leading-snug line-clamp-2">
                {account.account_type || "Investment"}
              </p>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate mt-0.5">
                {account.provider} · <span style={{ color: kindColour }}>{kindLabel}</span>
              </p>
            </div>
          </div>

          {/* Value — the hero, same slot as balance on bank cards */}
          <p className="text-2xl font-bold text-slate-900 dark:text-slate-100 num leading-none">
            {hidden ? "••••" : valueStr}
          </p>

          {/* Freshness cue — pinned to the bottom (mt-auto), same slot as the
              optional terms/APR chip on bank cards, so a bank card without a
              chip still shares this card's vertical rhythm. */}
          <p className="mt-auto pt-2 text-[11px] font-medium text-slate-400 dark:text-slate-500">
            {`Updated ${new Date(account.updated_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`}
          </p>
        </div>
      </button>
    );
  }
  // ── End calm variant ─────────────────────────────────────────────────────

  return (
    <button
      onClick={onClick}
      className={`${grid ? "w-full" : "flex-shrink-0 w-44"} rounded-2xl p-4 text-left active:scale-95 transition-transform shadow-md overflow-hidden relative`}
      style={{ background: meta.bg, color: "#fff" }}
    >
      {/* Top row: icon + account type chip */}
      <div className="flex items-start justify-between mb-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center ring-1 ring-black/[0.06] dark:ring-white/[0.12]" style={{ background: "rgba(255,255,255,0.2)" }}>
          <TrendingUp size={18} color="white" />
        </div>
        <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full mt-0.5" style={{ background: "rgba(255,255,255,0.2)", color: "#fff" }}>
          {account.account_type || "Investment"}
        </span>
      </div>

      {/* Provider name */}
      <p className="text-[10px] font-semibold uppercase tracking-widest mb-0.5 truncate" style={{ color: "rgba(255,255,255,0.6)" }}>
        {account.provider}
      </p>

      {/* Value */}
      <p className="text-xl font-bold tracking-tight leading-none text-white">
        {hidden ? "••••" : valueStr}
      </p>

      <div className="absolute -bottom-5 -right-5 w-20 h-20 rounded-full opacity-10 bg-white pointer-events-none" />
    </button>
  );
}
