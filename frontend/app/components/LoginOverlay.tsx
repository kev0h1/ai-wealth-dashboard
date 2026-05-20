"use client";

import { useState } from "react";
import { ShieldCheck, AlertCircle } from "lucide-react";

const CORRECT_PIN = "8048";

interface Props {
  onAuthenticated: () => void;
}

export default function LoginOverlay({ onAuthenticated }: Props) {
  const [error, setError] = useState(false);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const pin = (form.elements.namedItem("pin") as HTMLInputElement).value;
    if (pin === CORRECT_PIN) {
      localStorage.setItem("wealth_auth", "true");
      window.location.reload();
    } else {
      setError(true);
      (form.elements.namedItem("pin") as HTMLInputElement).value = "";
      (form.elements.namedItem("pin") as HTMLInputElement).focus();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950">
      <div className="w-full max-w-xs mx-4">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center shadow-2xl">
          <div className="flex justify-center mb-5">
            <div className={`w-14 h-14 rounded-full border flex items-center justify-center ${error ? "bg-red-900/30 border-red-500/50" : "bg-indigo-500/20 border-indigo-500/30"}`}>
              <ShieldCheck className={`w-7 h-7 ${error ? "text-red-400" : "text-indigo-400"}`} />
            </div>
          </div>

          <h1 className="text-lg font-semibold text-white mb-1">Wealth Dashboard</h1>
          <p className="text-sm text-slate-400 mb-6">Enter your 4-digit PIN</p>

          <form onSubmit={handleSubmit}>
            <input
              name="pin"
              type="password"
              inputMode="numeric"
              maxLength={4}
              autoFocus
              autoComplete="off"
              placeholder="••••"
              onChange={() => setError(false)}
              className={`w-full text-center text-2xl tracking-widest rounded-xl border-2 bg-slate-800 text-white py-4 outline-none transition-colors placeholder:text-slate-600 ${error ? "border-red-500" : "border-slate-700 focus:border-indigo-500"}`}
            />

            <button
              type="submit"
              className="mt-4 w-full py-3 rounded-xl font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
            >
              Unlock
            </button>
          </form>

          {error && (
            <div className="flex items-center justify-center gap-1.5 text-red-400 text-sm mt-4">
              <AlertCircle className="w-4 h-4" /> Incorrect PIN — try again
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
