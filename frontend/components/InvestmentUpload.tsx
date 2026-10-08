"use client";

import { useRef, useState } from "react";
import { Upload, CheckCircle, FileText, Eye, EyeOff, Loader2, TrendingUp } from "lucide-react";
import { api } from "@/lib/api";
import { SheetFrame } from "@/components/SheetFrame";

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

  return <SheetFrame
    title="Upload Investment Statement"
    description="Vanguard, Wealthify, Hargreaves Lansdown, Fidelity, AJ Bell and more"
    onClose={onClose}
    dismissDisabled={uploading}
    footer={({ close }) => result ? (
      <button type="button" onClick={close} className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white active:scale-95">Done</button>
    ) : (
      <button type="button" onClick={handleSubmit} disabled={!selectedFile || uploading} className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white active:scale-95 disabled:opacity-40">
        {uploading ? <><Loader2 size={16} className="animate-spin" />Analysing holdings…</> : <><Upload size={16} />Import Statement</>}
      </button>
    )}
  >
        {result ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <CheckCircle size={40} className="text-emerald-500" />
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 text-center">
              {result.provider} {result.account_type} imported
            </p>
            <p className="text-xs text-slate-400 dark:text-slate-500">
              {result.holdings_count} holdings · <span className="font-mono tabular-nums">£{result.total_value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label htmlFor="investment-password" className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">
                Password <span className="font-normal text-slate-400">(if PDF is protected)</span>
              </label>
              <div className="relative">
                <input
                  id="investment-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Leave blank if not password-protected"
                  className="w-full text-sm bg-slate-50 dark:bg-slate-700 dark:text-slate-100 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 pr-10 outline-none focus:ring-2 focus:ring-indigo-400"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide investment statement password" : "Show investment statement password"}
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
                aria-label="Choose an investment statement file"
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
                      <p className="text-xs text-slate-400 mt-0.5">{(selectedFile.size / 1024).toFixed(0)} KB, tap to change</p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">Tap to choose a file</p>
                      <p className="text-xs text-slate-400 mt-0.5">.pdf</p>
                    </>
                  )}
                </div>
              </button>
              <input ref={fileRef} type="file" accept=".pdf" aria-label="Investment statement file" className="sr-only" onChange={handleFileChange} />
            </div>

            {error && (
              <div role="alert" className="bg-slate-50 dark:bg-slate-700/40 border border-slate-200 dark:border-slate-600 rounded-xl px-4 py-3">
                <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-0.5">Upload failed</p>
                <p className="text-xs text-slate-600 dark:text-slate-300">{error}</p>
              </div>
            )}
          </div>
        )}
  </SheetFrame>;
}
