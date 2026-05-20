"use client";

import { useState } from "react";
import { Transaction } from "@/lib/api";
import { useColours } from "@/components/ColourProvider";
import { CATEGORY_COLOURS } from "@/lib/categories";
import { formatDate } from "@/lib/payPeriod";

interface TransactionRowProps {
  transaction: Transaction;
  onClick?: () => void;
  showAccount?: boolean;
}

const CATEGORY_EMOJI: Record<string, string> = {
  Groceries: "🛒",
  "Eating Out": "🍽️",
  Transport: "🚌",
  Entertainment: "🎬",
  Shopping: "🛍️",
  Bills: "📄",
  Subscriptions: "📱",
  Health: "💊",
  Travel: "✈️",
  Software: "💻",
  Savings: "💰",
  Debt: "💳",
  Transfer: "↔️",
  Income: "💵",
  Other: "📦",
};

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

function MerchantIcon({ transaction, colour }: { transaction: Transaction; colour: string }) {
  const [imgFailed, setImgFailed] = useState(false);
  const name = transaction.merchant_name || transaction.description || "";
  const domain = !imgFailed ? getMerchantDomain(name) : null;
  const emoji = CATEGORY_EMOJI[transaction.category ?? "Other"] ?? "📦";

  if (domain) {
    return (
      <div
        className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center overflow-hidden"
        style={{ background: "#f1f5f9" }}
      >
        <img
          src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
          alt={name}
          onError={() => setImgFailed(true)}
          className="w-6 h-6 object-contain"
        />
      </div>
    );
  }

  return (
    <div
      className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-lg"
      style={{ background: colour + "22" }}
    >
      {emoji}
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
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
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
        {isCredit ? "+" : "-"}£
        {Math.abs(amount).toLocaleString("en-GB", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}
      </span>
    </button>
  );
}
