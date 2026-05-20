"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, AlertCircle } from "lucide-react";

export default function LoginPage() {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const router = useRouter();

  const unlock = () => {
    if (pin === "8048") {
      localStorage.setItem("wealth_auth", "true");
      router.replace("/");
    } else {
      setError(true);
      setPin("");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950">
      <div className="w-full max-w-xs mx-4 bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center shadow-2xl">
        <div className="flex justify-center mb-5">
          <div className={`w-14 h-14 rounded-full border flex items-center justify-center ${error ? "bg-red-900/30 border-red-500/50" : "bg-indigo-500/20 border-indigo-500/30"}`}>
            <ShieldCheck className={`w-7 h-7 ${error ? "text-red-400" : "text-indigo-400"}`} />
          </div>
        </div>

        <h1 className="text-lg font-semibold text-white mb-1">Wealth Dashboard</h1>
        <p className="text-sm text-slate-400 mb-6">Enter your 4-digit PIN</p>

        <input
          type="password"
          inputMode="numeric"
          maxLength={4}
          autoFocus
          autoComplete="off"
          placeholder="••••"
          value={pin}
          onChange={(e) => { setPin(e.target.value); setError(false); }}
          onKeyDown={(e) => e.key === "Enter" && unlock()}
          className={`w-full text-center text-2xl tracking-widest rounded-xl border-2 bg-slate-800 text-white py-4 outline-none transition-colors placeholder:text-slate-600 ${error ? "border-red-500" : "border-slate-700 focus:border-indigo-500"}`}
        />

        <button
          onClick={unlock}
          className="mt-4 w-full py-3 rounded-xl font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
        >
          Unlock
        </button>

        {error && (
          <div className="flex items-center justify-center gap-1.5 text-red-400 text-sm mt-4">
            <AlertCircle className="w-4 h-4" /> Incorrect PIN
          </div>
        )}
      </div>
    </div>
  );
}
