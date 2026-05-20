"use client";

import { useState } from "react";
import { Plus, Loader2 } from "lucide-react";
import { api } from "@/lib/api";

export default function ConnectBankButton() {
  const [loading, setLoading] = useState(false);

  const handleConnect = async () => {
    setLoading(true);
    try {
      const { auth_url } = await api.connectLink();
      window.location.href = auth_url;
    } catch (e) {
      alert("Failed to get bank connection URL. Is the backend running?");
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleConnect}
      disabled={loading}
      className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-lg transition-colors"
    >
      {loading ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : (
        <Plus className="w-3.5 h-3.5" />
      )}
      Connect Bank
    </button>
  );
}
