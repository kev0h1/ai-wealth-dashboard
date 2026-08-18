"use client";

import { useState } from "react";
import { RefreshCw, Pin, Percent } from "lucide-react";
import { Account } from "@/lib/api";

/** Card-terms pill content (Accounts page credit-card rows). APR is
 *  information, not alarm — muted slate ink; amber only when a 0% promo is
 *  genuinely close to ending (Red-is-Risk keeps red out of this entirely). */
export interface TermsPill {
  label: string;
  amber?: boolean;
}

interface AccountMiniCardProps {
  account: Account;
  onClick?: () => void;
  onReconnect?: () => void;
  fullWidth?: boolean;
  /** Two-column grid cell: full width of the cell, compact content */
  grid?: boolean;
  pinned?: boolean;
  onTogglePin?: () => void;
  hidden?: boolean;
  /** Calm/quiet variant for the Home grid — whisper surfaces, no brand flood */
  calm?: boolean;
  /** Liquid-glass surface — requires calm=true */
  glass?: boolean;
  /** Confirmed card-terms pill; replaces the legacy apr chip when provided (calm variant) */
  termsPill?: TermsPill | null;
  /** Tap on the terms pill — opens the card-terms sheet at this card */
  onTermsClick?: () => void;
  /** Quiet "Add rates" affordance for credit cards without confirmed terms (calm variant) */
  onAddRates?: () => void;
  /** Position in a grid — drives the staggered entrance animation via
   *  --card-index (see .card-rise-in in globals.css). Omit to skip the
   *  animation (e.g. cards rendered outside a fresh-load grid). */
  index?: number;
}

export interface BankMeta {
  label: string;
  bg: string;
  domain?: string;       // for Google favicon service
  logoFile?: string;     // local /banks/{file}
  initials: string;
  initialsSize?: string;
}

/**
 * Finexer stable provider_id → canonical BANK_META key.
 * Add new entries here when Finexer adds new UK providers.
 */
const FINEXER_ALIAS: Record<string, string> = {
  natwest:               "NATWEST",
  natwest_bankline:      "NATWEST",
  natwest_clearspend:    "NATWEST",
  rbs:                   "NATWEST",
  rbs_bankline:          "NATWEST",
  rbs_clearspend:        "NATWEST",
  chase_uk:              "CHASE",
  amex:                  "AMEX",
  first_direct:          "FIRST_DIRECT",
  barclays_personal:     "BARCLAYS",
  barclays_business:     "BARCLAYS",
  barclays_corporate:    "BARCLAYS",
  barclays_wealth:       "BARCLAYS",
  barclaycard_uk:        "BARCLAYS",
  barclaycard_bcp:       "BARCLAYS",
  hsbc_personal:         "HSBC",
  hsbc_business:         "HSBC",
  hsbc_kinetic:          "HSBC",
  hsbc_net:              "HSBC",
  hsbc_ms:               "HSBC",
  lloyds_personal:       "LLOYDS",
  lloyds_business:       "LLOYDS",
  lloyds_commercial:     "LLOYDS",
  halifax:               "HALIFAX",
  santander:             "SANTANDER",
  santander_business:    "SANTANDER",
  santander_corporate:   "SANTANDER",
  nationwide:            "NATIONWIDE",
  tsb:                   "TSB",
  monzo:                 "MONZO",
  starling:              "STARLING",
  revolut:               "REVOLUT",
};

/**
 * Resolve an account to a canonical BANK_META key.
 * Priority:
 *   1. Finexer provider_id alias (most reliable for Finexer accounts)
 *   2. Normalised display name (covers TrueLayer + manual accounts)
 */
export function bankKey(account: { provider?: string; provider_id?: string }): string {
  // 1. Finexer stable code
  const pid = (account.provider_id ?? "").toLowerCase();
  if (pid && FINEXER_ALIAS[pid]) return FINEXER_ALIAS[pid];

  // 2. Normalise display name
  const n = (account.provider ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (!n) return "";
  if (BANK_META[n]) return n;

  // Strip common suffixes and retry
  const stripped = n.replace(/_(UK|PERSONAL|BUSINESS|CORPORATE|COMMERCIAL|WEALTH|CURRENT|SAVINGS|ONLINE|365)$/, "");
  if (stripped !== n && BANK_META[stripped]) return stripped;

  return n;
}

export const BANK_META: Record<string, BankMeta> = {
  BARCLAYS:     { label: "Barclays",     bg: "linear-gradient(135deg,#00aeef,#002d72)", logoFile: "barclays.png",  initials: "B" },
  NATWEST:      { label: "NatWest",      bg: "linear-gradient(135deg,#5a0069,#d9006c)", logoFile: "natwest.png",   initials: "NW" },
  HSBC:         { label: "HSBC",         bg: "linear-gradient(135deg,#db0011,#6b0008)", domain: "hsbc.co.uk",      initials: "HSBC", initialsSize: "8px" },
  MONZO:        { label: "Monzo",        bg: "linear-gradient(135deg,#ff3464,#ff6b35)", domain: "monzo.com",       initials: "M" },
  STARLING:     { label: "Starling",     bg: "linear-gradient(135deg,#6935d8,#00d4aa)", logoFile: "starling.png",  initials: "SB" },
  LLOYDS:       { label: "Lloyds",       bg: "linear-gradient(135deg,#024731,#006a4d)", logoFile: "lloyds.png",    initials: "L" },
  AMEX:         { label: "Amex",         bg: "linear-gradient(135deg,#007bc1,#003f6b)", logoFile: "amex.png",      initials: "AX" },
  REVOLUT:      { label: "Revolut",      bg: "linear-gradient(135deg,#191c1f,#3d4451)", domain: "revolut.com",     initials: "R" },
  SANTANDER:    { label: "Santander",    bg: "linear-gradient(135deg,#ec0000,#8b0000)", domain: "santander.co.uk", initials: "S" },
  HALIFAX:      { label: "Halifax",      bg: "linear-gradient(135deg,#1c5aa0,#003580)", domain: "halifax.co.uk",   initials: "HFX", initialsSize: "9px" },
  NATIONWIDE:   { label: "Nationwide",   bg: "linear-gradient(135deg,#1a2e6b,#3c5fa0)", domain: "nationwide.co.uk",initials: "NBS", initialsSize: "9px" },
  CHASE:        { label: "Chase",        bg: "linear-gradient(135deg,#117aca,#003087)", domain: "chase.co.uk",     initials: "Ch" },
  FIRST_DIRECT: { label: "first direct", bg: "linear-gradient(135deg,#111,#444)",       domain: "firstdirect.com", initials: "fd" },
  TSB:          { label: "TSB",          bg: "linear-gradient(135deg,#006ab0,#003f6b)", domain: "tsb.co.uk",       initials: "TSB", initialsSize: "9px" },
  MONO:         { label: "Mono",         bg: "linear-gradient(135deg,#1a1a2e,#16213e)", domain: "mono.co",         initials: "M" },
  MPESA:        { label: "M-Pesa",       bg: "linear-gradient(135deg,#4caf50,#1b5e20)", domain: "safaricom.co.ke", initials: "MP", initialsSize: "10px" },
  // Kenyan banks (statement uploads)
  EQUITY:       { label: "Equity Bank",  bg: "linear-gradient(135deg,#e60000,#8b0000)",  initials: "EQ" },
  KCB:          { label: "KCB",          bg: "linear-gradient(135deg,#006400,#003300)",  initials: "KCB", initialsSize: "10px" },
  NCBA:         { label: "NCBA",         bg: "linear-gradient(135deg,#00205b,#001133)",  initials: "NCBA", initialsSize: "8px" },
  STANBIC:      { label: "Stanbic",      bg: "linear-gradient(135deg,#003087,#001f5b)",  initials: "SB" },
  ABSA:         { label: "Absa",         bg: "linear-gradient(135deg,#dc143c,#8b0000)",  initials: "ABS", initialsSize: "9px" },
  COOP:         { label: "Co-op Bank",   bg: "linear-gradient(135deg,#003087,#1a5276)",  initials: "CO" },
  DTB:          { label: "DTB",          bg: "linear-gradient(135deg,#1a237e,#0d47a1)",  initials: "DTB", initialsSize: "10px" },
  STANCHART:    { label: "Std Chartered",bg: "linear-gradient(135deg,#00a0e3,#005b9f)",  initials: "SC" },
  FAMILY:       { label: "Family Bank",  bg: "linear-gradient(135deg,#ff6600,#cc3300)",  initials: "FB" },
  IMBANK:       { label: "I&M Bank",     bg: "linear-gradient(135deg,#b22222,#7b0000)",  initials: "I&M", initialsSize: "9px" },
};

/** Parse a hex colour like "#RRGGBB" or "#RGB" into [r, g, b] 0-255. Returns null on failure. */
function hexToRgb(hex: string): [number, number, number] | null {
  const h = hex.replace("#", "");
  if (h.length === 3) {
    const r = parseInt(h[0] + h[0], 16);
    const g = parseInt(h[1] + h[1], 16);
    const b = parseInt(h[2] + h[2], 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    return [r, g, b];
  }
  if (h.length === 6) {
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    return [r, g, b];
  }
  return null;
}

/** Darken an RGB triple by multiplying each channel by factor (0-1). */
function darkenRgb([r, g, b]: [number, number, number], factor: number): string {
  return `rgb(${Math.round(r * factor)},${Math.round(g * factor)},${Math.round(b * factor)})`;
}

/** sRGB relative luminance (0-255 range). */
function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export interface AccountBrand {
  background: string;
  logoSrc: string | null;
  textOnBrand: "#fff" | "#0f172a";
  initials: string;
  label: string;
}

/** Build a Google favicon URL for a domain. */
function googleFaviconURL(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
}

/**
 * Single brand resolver.
 *
 * Priority:
 *   1. BANK_META (curated) — ensures the same bank looks identical across
 *      TrueLayer and Finexer. bankKey() resolves both provider display names
 *      and Finexer provider_id codes to the same canonical key.
 *   2. Finexer dynamic data (bg_colors / logo_url) — fallback for banks that
 *      are not yet in BANK_META.
 *   3. Neutral default gradient.
 *
 * TrueLayer accounts have no logo_url/bg_colors so they are unaffected by the
 * priority change — they still fall through to BANK_META as before.
 */
export function accountBrand(account: Account): AccountBrand {
  const key = bankKey(account);
  const meta = BANK_META[key];

  // --- BRANCH 1: curated entry exists ---
  if (meta) {
    const background = meta.bg;

    // Extract first hex from the gradient for luminance check
    const m = meta.bg.match(/#[0-9a-fA-F]{3,6}/);
    const firstHex = m ? m[0] : null;
    let textOnBrand: "#fff" | "#0f172a" = "#fff";
    if (firstHex) {
      const rgb = hexToRgb(firstHex);
      if (rgb && luminance(rgb[0], rgb[1], rgb[2]) > 150) {
        textOnBrand = "#0f172a";
      }
    }

    // Never use account.logo_url here — keep it consistent across providers
    const logoSrc: string | null = meta.logoFile
      ? `/banks/${meta.logoFile}`
      : meta.domain
      ? googleFaviconURL(meta.domain)
      : null;

    return {
      background,
      logoSrc,
      textOnBrand,
      initials: meta.initials,
      label: meta.label,
    };
  }

  // --- BRANCH 2: no curated entry — fall back to Finexer dynamic data ---
  let background: string;
  let firstHex: string | null = null;

  if (account.bg_colors && account.bg_colors.length > 0) {
    firstHex = account.bg_colors[0];
    if (account.bg_colors.length >= 2) {
      background = `linear-gradient(135deg,${account.bg_colors[0]},${account.bg_colors[1]})`;
    } else {
      // Single colour: darken for the second stop
      const rgb = hexToRgb(account.bg_colors[0]);
      const darker = rgb ? darkenRgb(rgb, 0.62) : account.bg_colors[0];
      background = `linear-gradient(135deg,${account.bg_colors[0]},${darker})`;
    }
  } else {
    // --- BRANCH 3: neutral default ---
    background = "linear-gradient(135deg,#2563eb,#1d4ed8)";
    firstHex = "#2563eb";
  }

  let textOnBrand: "#fff" | "#0f172a" = "#fff";
  if (firstHex) {
    const rgb = hexToRgb(firstHex);
    if (rgb && luminance(rgb[0], rgb[1], rgb[2]) > 150) {
      textOnBrand = "#0f172a";
    }
  }

  const logoSrc: string | null = account.logo_url ?? null;
  const initials = (account.provider ?? "?").slice(0, 2).toUpperCase();
  const label = account.provider || "Bank";

  return { background, logoSrc, textOnBrand, initials, label };
}

/** Account-type → spine colour (Estate area, account-card Variant A).
 *  Matches the approved account-cards preview's type→colour map. ISA/Offline
 *  are defensive branches — real bank `Account` objects from Open Banking
 *  practically never carry those subtypes (investments and offline accounts
 *  render through their own components), but the mapping stays correct if
 *  one ever does. */
type AccountKind = "Current" | "Savings" | "ISA" | "Credit" | "Offline";

const ACCOUNT_KIND_COLOUR: Record<AccountKind, string> = {
  Current: "#60a5fa",
  Savings: "#fbbf24",
  ISA: "#34d399",
  Credit: "#f87171",
  Offline: "#94a3b8",
};

function typeLabel(account: Account): AccountKind {
  if (account.manual) return "Offline";
  const type = account.type.toLowerCase();
  const sub = (account.subtype ?? "").toLowerCase();
  if (type.includes("credit") || sub.includes("credit")) return "Credit";
  if (sub.includes("isa") || sub.includes("invest") || sub.includes("stocks") || sub.includes("pension")) return "ISA";
  if (sub.includes("saving")) return "Savings";
  return "Current";
}

export function BankBadge({
  logoSrc,
  initials,
  initialsSize,
  altText,
  brandBg,
}: {
  logoSrc: string | null;
  initials: string;
  initialsSize?: string;
  altText: string;
  /** When provided, use this as the chip background for the initials fallback (calm branch). */
  brandBg?: string;
}) {
  const [imgFailed, setImgFailed] = useState(false);

  if (logoSrc && !imgFailed) {
    return (
      <img
        src={logoSrc}
        alt={altText}
        onError={() => setImgFailed(true)}
        className="w-9 h-9 rounded-xl object-contain bg-white p-0.5 ring-1 ring-black/[0.06] dark:ring-white/[0.12]"
      />
    );
  }

  const text = initials;
  const fontSize = initialsSize ?? (text.length >= 4 ? "8px" : text.length === 3 ? "10px" : "13px");

  return (
    <div
      className="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-white ring-1 ring-black/[0.06] dark:ring-white/[0.12]"
      style={{ background: brandBg ?? "rgba(255,255,255,0.25)", fontSize }}
    >
      {text}
    </div>
  );
}

export default function AccountMiniCard({ account, onClick, onReconnect, fullWidth, grid, hidden, pinned, onTogglePin, calm, glass, termsPill, onTermsClick, onAddRates, index }: AccountMiniCardProps) {
  const brand = accountBrand(account);
  const isCredit = account.type.toLowerCase().includes("credit");
  const balance = account.balance;
  const currSym = account.currency === "KES" ? "KES " : "£";
  const balanceStr = `${currSym}${Math.abs(balance).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  const tc = brand.textOnBrand;

  // ── Calm variant (Home grid) ─────────────────────────────────────────────
  // Quiet-card surface: no brand flood, no shadow. Brand colour lives only in
  // the 36px chip — the rest is neutral slate ink on white/slate-800 glass.
  if (calm) {
    const kind = typeLabel(account);
    const kindColour = ACCOUNT_KIND_COLOUR[kind];
    return (
      <button
        onClick={onClick}
        style={index !== undefined ? ({ "--card-index": index } as React.CSSProperties) : undefined}
        className={`relative w-full h-[13rem] flex flex-col rounded-2xl text-left ${glass ? "glass-card" : "bg-white/60 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700/60"} ${index !== undefined ? "card-rise-in" : ""} active:scale-[0.98] transition-transform overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500`}
      >
        <div className="p-4 flex flex-col flex-1">
          {/* Top row: brand chip + name / bank·type */}
          <div className="flex items-start gap-2.5 mb-3">
            <BankBadge
              logoSrc={brand.logoSrc}
              initials={brand.initials}
              altText={brand.label}
              brandBg={brand.background}
            />
            <div className="min-w-0 flex-1">
              {/* Account name — wraps to 2 lines rather than truncating, so a
                  long name never eats the balance/hierarchy below it. */}
              <p className="text-[13px] font-medium text-slate-700 dark:text-slate-200 leading-snug line-clamp-2">
                {account.name.trim()}
              </p>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate mt-0.5">
                {brand.label} · <span style={{ color: kindColour }}>{kind}</span>
              </p>
            </div>
          </div>

          {/* Balance — the hero. Neutral ink even when negative (Red Is Risk rule) */}
          <p className="text-2xl font-bold text-slate-900 dark:text-slate-100 num leading-none">
            {hidden ? "••••" : `${balance < 0 ? "-" : ""}${balanceStr}`}
          </p>
          {isCredit && !hidden && (
            <p className="mt-1 text-[11px] font-medium text-slate-400 dark:text-slate-500">owed</p>
          )}

          {/* Card-terms pill / Add-rates affordance / legacy APR chip — pinned
              to the bottom (mt-auto) so a card without one still keeps the
              same top rhythm (logo/name/balance) as a card with one.
              44px hit targets wrap the small visuals (visual pill stays quiet). */}
          {termsPill && onTermsClick ? (
            <button
              onClick={(e) => { e.stopPropagation(); onTermsClick(); }}
              aria-label={`${termsPill.label}, edit this card's rates`}
              className="-ml-1.5 mt-auto pt-2 min-h-[44px] flex items-center px-1.5 active:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-lg"
            >
              <span
                className={`text-[10px] font-semibold px-2 py-0.5 rounded-full num ${
                  termsPill.amber
                    ? "bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400"
                    : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400"
                }`}
              >
                {termsPill.label}
              </span>
            </button>
          ) : isCredit && onAddRates ? (
            <button
              onClick={(e) => { e.stopPropagation(); onAddRates(); }}
              className="-ml-1.5 mt-auto pt-2 min-h-[44px] flex items-center gap-1 px-1.5 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 active:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-lg"
            >
              <Percent size={11} aria-hidden="true" />
              Add rates
            </button>
          ) : isCredit && account.apr != null ? (
            <span className="inline-block mt-auto pt-2 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 num self-start">
              {account.apr}% APR
            </span>
          ) : null}
        </div>

        {/* Pin toggle */}
        {onTogglePin && account.status !== "expired" && (
          <button
            onClick={(e) => { e.stopPropagation(); onTogglePin(); }}
            title={pinned ? "Unpin from Home" : "Pin to Home"}
            className={`absolute bottom-3 right-3 flex items-center justify-center w-7 h-7 rounded-lg transition-transform active:scale-95 ${
              pinned
                ? "bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400"
                : "bg-slate-100 dark:bg-slate-700 text-slate-400 hover:text-slate-600"
            }`}
          >
            <Pin size={12} className={pinned ? "fill-current" : ""} />
          </button>
        )}

        {/* Reconnect */}
        {onReconnect && account.status === "expired" && (
          <button
            onClick={(e) => { e.stopPropagation(); onReconnect(); }}
            title="Reconnect this bank"
            className={`absolute flex items-center gap-1 text-[10px] font-semibold rounded-lg px-2 py-1 transition-transform active:scale-95 ${
              fullWidth || grid ? "bottom-3 right-3" : "top-2 right-2"
            } bg-amber-500 hover:bg-amber-600 text-white`}
          >
            <RefreshCw size={10} />
            <span>Reconnect</span>
          </button>
        )}
      </button>
    );
  }
  // ── End calm variant ─────────────────────────────────────────────────────

  return (
    <button
      onClick={onClick}
      className={`${fullWidth || grid ? "w-full" : "flex-shrink-0 w-44"} rounded-2xl p-4 text-left active:scale-95 transition-transform shadow-sm overflow-hidden relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70`}
      style={{ background: brand.background, color: tc }}
    >
      {/* Top: badge + type chip */}
      <div className="flex items-start justify-between mb-3">
        <BankBadge
          logoSrc={brand.logoSrc}
          initials={brand.initials}
          altText={brand.label}
        />
        <span
          className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full mt-0.5"
          style={{ background: "rgba(255,255,255,0.2)", color: tc }}
        >
          {typeLabel(account)}
        </span>
      </div>

      {/* Bank label */}
      <p
        className="text-[10px] font-semibold uppercase tracking-widest mb-0.5 truncate"
        style={{ color: tc === "#fff" ? "rgba(255,255,255,0.6)" : "rgba(15,23,42,0.55)" }}
      >
        {brand.label}
      </p>

      {/* Account name */}
      <p
        className="text-[11px] mb-1 truncate"
        style={{ color: tc === "#fff" ? "rgba(255,255,255,0.5)" : "rgba(15,23,42,0.45)" }}
      >
        {account.name.trim()}
      </p>

      {/* Balance */}
      <p
        className={`text-xl font-bold tracking-tight leading-none`}
        style={{ color: balance < 0 ? (tc === "#fff" ? "#fca5a5" : "#b91c1c") : tc }}
      >
        {hidden ? "••••" : `${balance < 0 ? "-" : ""}${balanceStr}`}
      </p>

      {/* Masked account number — own line so reconnect button doesn't overlap */}
      {fullWidth && (account.account_number || account.sort_code) && (
        <p className="text-[10px] font-mono mt-1" style={{ color: tc === "#fff" ? "rgba(255,255,255,0.45)" : "rgba(15,23,42,0.4)" }}>
          {account.sort_code
            ? `${account.sort_code.replace(/(\d{2})(\d{2})(\d{2})/, "$1-$2-$3")} ••••${(account.account_number ?? "").slice(-4)}`
            : `••••${(account.account_number ?? "").slice(-4)}`}
        </p>
      )}

      <div aria-hidden="true" className="absolute -bottom-5 -right-5 w-20 h-20 rounded-full opacity-10 bg-white pointer-events-none" />

      {/* Pin-to-Home toggle — bottom-right, yields to the expired pill */}
      {onTogglePin && account.status !== "expired" && (
        <button
          onClick={(e) => { e.stopPropagation(); onTogglePin(); }}
          title={pinned ? "Unpin from Home" : "Pin to Home"}
          className={`absolute bottom-3 right-3 flex items-center justify-center w-7 h-7 rounded-lg transition-transform active:scale-95 ${
            pinned ? "bg-white text-indigo-700" : "bg-white/15 hover:bg-white/30 text-white/80"
          }`}
        >
          <Pin size={12} className={pinned ? "fill-current" : ""} />
        </button>
      )}

      {/* Reconnect — only when the connection actually needs it */}
      {onReconnect && account.status === "expired" && (
        <button
          onClick={(e) => { e.stopPropagation(); onReconnect(); }}
          title="Reconnect this bank"
          className={`
            absolute flex items-center gap-1 text-[10px] font-semibold rounded-lg px-2 py-1 transition-transform active:scale-95
            ${fullWidth || grid ? "bottom-3 right-3" : "top-2 right-2"}
            ring-1 ring-amber-400/60 bg-amber-500/40 hover:bg-amber-500/60 text-white
          `}
        >
          <RefreshCw size={10} />
          <span>Reconnect</span>
        </button>
      )}
    </button>
  );
}
