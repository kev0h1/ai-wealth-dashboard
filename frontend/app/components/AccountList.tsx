"use client";

import { Building2, CheckCircle2 } from "lucide-react";
import { Account } from "@/lib/api";

function typeColor(type: string) {
  if (type === "crypto") return "text-amber-400";
  if (type === "pension") return "text-purple-400";
  return "text-emerald-400";
}

export default function AccountList({
  accounts,
  loading,
  selectedAccount,
  onSelectAccount,
}: {
  accounts: Account[];
  loading: boolean;
  selectedAccount: string | null;
  onSelectAccount: (id: string | null) => void;
}) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl">
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">Accounts</h2>
        {accounts.length > 0 && (
          <span className="text-xs text-slate-500">{accounts.length} connected</span>
        )}
      </div>

      {loading ? (
        <div className="p-4 space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 bg-slate-800 animate-pulse rounded-lg" />
          ))}
        </div>
      ) : accounts.length === 0 ? (
        <div className="px-4 py-8 text-center text-slate-500 text-sm">
          No accounts connected yet
        </div>
      ) : (
        <div className="p-2 space-y-1">
          {accounts.map((acc) => {
            const selected = selectedAccount === acc.id;
            return (
              <button
                key={acc.id}
                onClick={() => onSelectAccount(selected ? null : acc.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                  selected
                    ? "bg-indigo-500/20 border border-indigo-500/30"
                    : "hover:bg-slate-800 border border-transparent"
                }`}
              >
                <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center shrink-0">
                  <Building2 className="w-4 h-4 text-slate-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-200 truncate">{acc.name}</p>
                  <p className="text-xs text-slate-500 truncate">{acc.provider}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold text-white">
                    £{acc.balance.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                  <p className={`text-xs ${typeColor(acc.type)}`}>{acc.type}</p>
                </div>
                {acc.status === "connected" && (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      )}

      {accounts.length > 0 && (
        <div className="px-4 py-3 border-t border-slate-800">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Total balance</span>
            <span className="font-semibold text-slate-300">
              £{accounts.reduce((s, a) => s + a.balance, 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
