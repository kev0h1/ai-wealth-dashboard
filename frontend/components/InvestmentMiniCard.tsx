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

interface Props {
  account: InvestmentAccount;
  onClick?: () => void;
  hidden?: boolean;
}

export default function InvestmentMiniCard({ account, onClick, hidden }: Props) {
  const meta = PROVIDER_META[providerKey(account.provider)] ?? { bg: "linear-gradient(135deg,#3730a3,#4f46e5)" };
  const value = account.total_value;
  const valueStr = `£${Math.abs(value).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  return (
    <button
      onClick={onClick}
      className="flex-shrink-0 w-44 rounded-2xl p-4 text-left active:scale-95 transition-transform shadow-md overflow-hidden relative"
      style={{ background: meta.bg, color: "#fff" }}
    >
      {/* Top row: icon + account type chip */}
      <div className="flex items-start justify-between mb-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "rgba(255,255,255,0.2)" }}>
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
