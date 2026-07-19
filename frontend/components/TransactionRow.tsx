"use client";

import { useState } from "react";
import { Transaction, logoUrl } from "@/lib/api";
import { useColours } from "@/components/ColourProvider";
import { CATEGORY_COLOURS } from "@/lib/categories";
import { formatDate } from "@/lib/payPeriod";
import { formatCurrency } from "@/lib/currency";

interface TransactionRowProps {
  transaction: Transaction;
  onClick?: () => void;
  showAccount?: boolean;
}

// Map merchant name keywords to known domains for favicon lookup
const MERCHANT_DOMAINS: Array<[RegExp, string]> = [
  [/tesco/i, "tesco.com"],
  [/sainsbury/i, "sainsburys.co.uk"],
  [/asda/i, "asda.com"],
  [/waitrose/i, "waitrose.com"],
  [/lidl/i, "lidl.co.uk"],
  [/aldi/i, "aldi.co.uk"],
  [/morrisons?/i, "morrisons.com"],
  [/amazon/i, "amazon.co.uk"],
  [/netflix/i, "netflix.com"],
  [/spotify/i, "spotify.com"],
  [/apple/i, "apple.com"],
  [/google/i, "google.com"],
  [/uber/i, "uber.com"],
  [/deliveroo/i, "deliveroo.co.uk"],
  [/just.?eat/i, "just-eat.co.uk"],
  [/mcdonald/i, "mcdonalds.com"],
  [/starbucks/i, "starbucks.com"],
  [/costa/i, "costa.co.uk"],
  [/greggs/i, "greggs.co.uk"],
  [/pret/i, "pret.co.uk"],
  [/nando/i, "nandos.co.uk"],
  [/tfl|oyster|transport for london/i, "tfl.gov.uk"],
  [/trainline/i, "thetrainline.com"],
  [/bp\b/i, "bp.com"],
  [/shell\b/i, "shell.co.uk"],
  [/boots\b/i, "boots.com"],
  [/superdrug/i, "superdrug.com"],
  [/asos/i, "asos.com"],
  [/next\b/i, "next.co.uk"],
  [/john lewis/i, "johnlewis.com"],
  [/argos/i, "argos.co.uk"],
  [/currys/i, "currys.co.uk"],
  [/ebay/i, "ebay.co.uk"],
  [/paypal/i, "paypal.com"],
  [/monzo/i, "monzo.com"],
  [/revolut/i, "revolut.com"],
  [/barclays/i, "barclays.co.uk"],
  [/natwest/i, "natwest.com"],
  [/hsbc/i, "hsbc.co.uk"],
  [/starling/i, "starlingbank.com"],
  [/amex|american express/i, "americanexpress.com"],
  [/vodafone/i, "vodafone.co.uk"],
  [/sky\b/i, "sky.com"],
  [/bt\b/i, "bt.com"],
  [/virgin/i, "virginmedia.com"],
  [/octopus/i, "octopusenergy.com"],
  [/british gas/i, "britishgas.co.uk"],
  [/disney/i, "disneyplus.com"],
  [/microsoft/i, "microsoft.com"],
  [/github/i, "github.com"],
  [/notion/i, "notion.so"],
  [/figma/i, "figma.com"],
  [/slack/i, "slack.com"],
  [/zoom/i, "zoom.us"],
  [/airbnb/i, "airbnb.com"],
  [/booking\.com/i, "booking.com"],
  [/ryanair/i, "ryanair.com"],
  [/easyjet/i, "easyjet.com"],
  [/british airways/i, "britishairways.com"],
  [/odeon/i, "odeon.co.uk"],
  [/vue/i, "myvue.com"],
  [/cineworld/i, "cineworld.co.uk"],
  [/puregym/i, "puregym.com"],
  [/ticketmaster/i, "ticketmaster.co.uk"],
  [/goldman sachs|marcus/i, "goldmansachs.com"],
];

function getMerchantDomain(name: string): string | null {
  for (const [pattern, domain] of MERCHANT_DOMAINS) {
    if (pattern.test(name)) return domain;
  }
  return null;
}

function initialFor(name: string): string {
  const m = name.match(/[a-z0-9]/i);
  return m ? m[0].toUpperCase() : "•";
}

function MerchantIcon({ transaction, colour }: { transaction: Transaction; colour: string }) {
  const [imgFailed, setImgFailed] = useState(false);
  const name = transaction.merchant_name || transaction.description || "";
  const domain = !imgFailed ? getMerchantDomain(name) : null;

  if (domain) {
    return (
      <div className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center overflow-hidden bg-white dark:bg-slate-700">
        <img
          src={logoUrl(domain)}
          alt={name}
          onError={() => setImgFailed(true)}
          className="w-7 h-7 object-contain"
        />
      </div>
    );
  }

  return (
    <div
      className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold text-white"
      style={{ background: colour }}
    >
      {initialFor(name)}
    </div>
  );
}

function displayName(tx: Transaction): string {
  return tx.merchant_name || tx.description || "Unknown";
}

export default function TransactionRow({
  transaction,
  onClick,
  showAccount = false,
}: TransactionRowProps) {
  const { colours } = useColours();
  const colour = colours[transaction.category ?? "Other"] ?? CATEGORY_COLOURS.Other;
  const isCredit = transaction.transaction_type === "credit";
  const amount = transaction.amount;

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/40 active:bg-slate-100 dark:active:bg-slate-700 transition-colors text-left"
    >
      <MerchantIcon transaction={transaction} colour={colour} />

      {/* Name + date */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
          {displayName(transaction)}
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          {formatDate(transaction.date)}
          {transaction.category ? ` · ${transaction.category}` : ""}
        </p>
      </div>

      {/* Amount */}
      <span
        className={`text-sm font-semibold flex-shrink-0 ${
          isCredit ? "text-emerald-500" : "text-slate-800 dark:text-slate-100"
        }`}
      >
        {isCredit ? "+" : "-"}
        {formatCurrency(amount, transaction.currency)}
      </span>
    </button>
  );
}
