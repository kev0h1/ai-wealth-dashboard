"use client";

import { useRef, useState } from "react";
import { Upload, X, CheckCircle, Eye, EyeOff } from "lucide-react";
import { api } from "@/lib/api";

interface MpesaUploadProps {
  onSuccess: () => void;
  onClose: () => void;
}

export default function MpesaUpload({ onSuccess, onClose }: MpesaUploadProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ inserted: number; account_id: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const res = await api.uploadMpesa(file, password || undefined);
      setResult(res);
      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      // Reset input so same file can be retried with a different password
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white dark:bg-slate-800 rounded-t-3xl px-5 pb-10 pt-5 shadow-xl">
        {/* Handle */}
        <div className="mx-auto w-10 h-1 bg-slate-200 dark:bg-slate-600 rounded-full mb-5" />

        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Upload M-Pesa Statement</h2>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
              Download your Safaricom PDF statement and upload it here
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700">
            <X size={16} className="text-slate-500" />
          </button>
        </div>

        {result ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <CheckCircle size={40} className="text-emerald-500" />
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              {result.inserted} transactions imported
            </p>
            <button
              onClick={onClose}
              className="mt-2 px-6 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold active:scale-95 transition-transform"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            {/* Password field */}
            <div className="mb-4">
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">
                PDF Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Usually your phone number or ID number"
                  className="w-full text-sm bg-slate-50 dark:bg-slate-700 dark:text-slate-100 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 pr-10 outline-none focus:ring-2 focus:ring-green-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                Safaricom statements are password-protected. Leave blank if not applicable.
              </p>
            </div>

            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="w-full border-2 border-dashed border-slate-200 dark:border-slate-600 rounded-2xl p-8 flex flex-col items-center gap-3 active:bg-slate-50 dark:active:bg-slate-700/50 transition-colors disabled:opacity-50"
            >
              <div className="w-12 h-12 rounded-2xl bg-green-50 dark:bg-green-900/20 flex items-center justify-center">
                <Upload size={22} className="text-green-600" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {uploading ? "Uploading & extracting…" : "Tap to select statement"}
                </p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                  Safaricom M-Pesa statement (.pdf or .csv)
                </p>
              </div>
            </button>
            <input ref={fileRef} type="file" accept=".pdf,.csv" className="sr-only" onChange={handleFile} />

            {error && (
              <p className="mt-3 text-xs text-red-500 text-center">{error}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
