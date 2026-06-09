"use client";

import { useRef, useState } from "react";
import { Upload, X, CheckCircle, FileText, Eye, EyeOff, Loader2, TrendingUp } from "lucide-react";
import { api } from "@/lib/api";

interface InvestmentUploadProps {
  onSuccess: () => void;
  onClose: () => void;
}

export default function InvestmentUpload({ onSuccess, onClose }: InvestmentUploadProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{
    provider: string;
    account_type: string;
    total_value: number;
    holdings_count: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSelectedFile(e.target.files?.[0] ?? null);
    setError(null);
  }

  async function handleSubmit() {
    if (!selectedFile || uploading) return;
    setUploading(true);
    setError(null);
    try {
      const res = await api.uploadInvestmentStatement(selectedFile, password || undefined);
      setResult({
        provider: res.provider,
        account_type: res.account_type,
        total_value: res.total_value,
        holdings_count: res.holdings_count,
      });
      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white dark:bg-slate-800 rounded-t-3xl px-5 pb-28 pt-5 shadow-xl">
        <div className="mx-auto w-10 h-1 bg-slate-200 dark:bg-slate-600 rounded-full mb-5" />

        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Upload Investment Statement</h2>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
              Vanguard, Wealthify, Hargreaves Lansdown, Fidelity, AJ Bell and more
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700"
          >
            <X size={16} className="text-slate-500" />
          </button>
        </div>

        {result ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <CheckCircle size={40} className="text-emerald-500" />
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 text-center">
              {result.provider} {result.account_type} imported
            </p>
            <p className="text-xs text-slate-400 dark:text-slate-500">
              {result.holdings_count} holdings · £{result.total_value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <button
              onClick={onClose}
              className="mt-2 px-6 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold active:scale-95 transition-transform"
            >
              Done
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">
                Password <span className="font-normal text-slate-400">(if PDF is protected)</span>
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Leave blank if not password-protected"
                  className="w-full text-sm bg-slate-50 dark:bg-slate-700 dark:text-slate-100 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 pr-10 outline-none focus:ring-2 focus:ring-indigo-400"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">
                Statement file
              </label>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-full border-2 border-dashed border-slate-200 dark:border-slate-600 rounded-2xl p-5 flex items-center gap-3 hover:border-indigo-300 hover:bg-indigo-50/50 dark:hover:bg-indigo-900/10 transition-colors"
              >
                <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center flex-shrink-0">
                  {selectedFile
                    ? <FileText size={20} className="text-indigo-600" />
                    : <TrendingUp size={20} className="text-indigo-400" />}
                </div>
                <div className="text-left min-w-0">
                  {selectedFile ? (
                    <>
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{selectedFile.name}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{(selectedFile.size / 1024).toFixed(0)} KB — tap to change</p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">Tap to choose a file</p>
                      <p className="text-xs text-slate-400 mt-0.5">.pdf</p>
                    </>
                  )}
                </div>
              </button>
              <input ref={fileRef} type="file" accept=".pdf" className="sr-only" onChange={handleFileChange} />
            </div>

            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 rounded-xl px-4 py-3">
                <p className="text-xs font-semibold text-red-600 dark:text-red-400 mb-0.5">Upload failed</p>
                <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={!selectedFile || uploading}
              className="w-full py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-semibold flex items-center justify-center gap-2 active:scale-95 transition-all"
            >
              {uploading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Analysing holdings…
                </>
              ) : (
                <>
                  <Upload size={16} />
                  Import Statement
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
