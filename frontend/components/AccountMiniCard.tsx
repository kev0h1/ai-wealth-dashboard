"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Account } from "@/lib/api";

interface AccountMiniCardProps {
  account: Account;
  onClick?: () => void;
  onReconnect?: () => void;
  fullWidth?: boolean;
  hidden?: boolean;
}

export interface BankMeta {
  label: string;
  bg: string;
  domain?: string;       // for Google favicon service
  logoFile?: string;     // local /banks/{file}
  initials: string;
  initialsSize?: string;
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

function typeLabel(type: string) {
  if (type.toLowerCase().includes("credit")) return "Credit";
  if (type.toLowerCase().includes("saving")) return "Savings";
  return "Current";
}

export function BankBadge({ meta, providerRaw }: { meta?: BankMeta; providerRaw: string }) {
  const [imgFailed, setImgFailed] = useState(false);

  const src = !imgFailed
    ? meta?.logoFile
      ? `/banks/${meta.logoFile}`
      : meta?.domain
        ? `https://www.google.com/s2/favicons?domain=${meta.domain}&sz=64`
        : null
    : null;

  if (src) {
    return (
      <img
        src={src}
        alt={meta?.label ?? providerRaw}
        onError={() => setImgFailed(true)}
        className="w-9 h-9 rounded-xl object-contain bg-white p-0.5"
      />
    );
  }

  const text = meta?.initials ?? providerRaw.slice(0, 2).toUpperCase();
  const fontSize = meta?.initialsSize ?? (text.length >= 4 ? "8px" : text.length === 3 ? "10px" : "13px");

  return (
    <div
      className="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-white"
      style={{ background: "rgba(255,255,255,0.25)", fontSize }}
    >
      {text}
    </div>
  );
}

export default function AccountMiniCard({ account, onClick, onReconnect, fullWidth, hidden }: AccountMiniCardProps) {
  const key = (account.provider ?? "").toUpperCase().replace(/[\s-]+/g, "_");
  const meta = BANK_META[key];
  const isCredit = account.type.toLowerCase().includes("credit");
  const balance = account.balance;
  const currSym = account.currency === "KES" ? "KES " : "£";
  const balanceStr = `${currSym}${Math.abs(balance).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  return (
    <button
      onClick={onClick}
      className={`${fullWidth ? "w-full" : "flex-shrink-0 w-44"} rounded-2xl p-4 text-left active:scale-95 transition-transform shadow-md overflow-hidden relative ${!meta ? "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700" : ""}`}
      style={meta ? { background: meta.bg, color: "#fff" } : undefined}
    >
      {/* Top: badge + type chip */}
      <div className="flex items-start justify-between mb-3">
        <BankBadge meta={meta} providerRaw={account.provider ?? "?"} />
        <span
          className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full mt-0.5"
          style={meta
            ? { background: "rgba(255,255,255,0.2)", color: "#fff" }
            : { background: isCredit ? "#fee2e2" : "#e0e7ff", color: isCredit ? "#b91c1c" : "#4338ca" }}
        >
          {typeLabel(account.type)}
        </span>
      </div>

      {/* Bank label */}
      <p
        className={`text-[10px] font-semibold uppercase tracking-widest mb-0.5 truncate ${!meta ? "text-slate-400 dark:text-slate-500" : ""}`}
        style={meta ? { color: "rgba(255,255,255,0.6)" } : undefined}
      >
        {meta?.label ?? (account.provider || "Bank")}
      </p>

      {/* Account name */}
      <p
        className={`text-[11px] mb-1 truncate ${!meta ? "text-slate-400 dark:text-slate-500" : ""}`}
        style={meta ? { color: "rgba(255,255,255,0.5)" } : undefined}
      >
        {account.name.trim()}
      </p>

      {/* Balance */}
      <p
        className={`text-xl font-bold tracking-tight leading-none ${!meta ? (balance < 0 ? "text-red-500" : "text-slate-900 dark:text-slate-100") : ""}`}
        style={meta ? { color: "#fff" } : undefined}
      >
        {hidden ? "••••" : `${balance < 0 ? "-" : ""}${balanceStr}`}
      </p>

      {/* Masked account number — own line so reconnect button doesn't overlap */}
      {fullWidth && (account.account_number || account.sort_code) && (
        <p className="text-[10px] font-mono mt-1" style={meta ? { color: "rgba(255,255,255,0.45)" } : { color: "#94a3b8" }}>
          {account.sort_code
            ? `${account.sort_code.replace(/(\d{2})(\d{2})(\d{2})/, "$1-$2-$3")} ••••${(account.account_number ?? "").slice(-4)}`
            : `••••${(account.account_number ?? "").slice(-4)}`}
        </p>
      )}

      <div className="absolute -bottom-5 -right-5 w-20 h-20 rounded-full opacity-10 bg-white pointer-events-none" />

      {/* Reconnect button */}
      {onReconnect && (
        <button
          onClick={(e) => { e.stopPropagation(); onReconnect(); }}
          title="Reconnect this bank"
          className={`
            absolute flex items-center gap-1 text-[10px] font-semibold rounded-lg px-2 py-1 transition-all active:scale-95
            ${fullWidth ? "bottom-3 right-3" : "top-2 right-2"}
            ${account.status === "expired"
              ? "ring-1 ring-amber-400/60 bg-amber-500/40 hover:bg-amber-500/60 text-white"
              : "bg-white/15 hover:bg-white/30 text-white"
            }
          `}
        >
          <RefreshCw size={10} />
          {account.status === "expired" && <span>Reconnect</span>}
        </button>
      )}
    </button>
  );
}
