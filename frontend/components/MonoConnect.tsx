"use client";

import { useEffect, useCallback, useState } from "react";
import { api } from "@/lib/api";

interface MonoConnectProps {
  onSuccess: () => void;
  children: (open: () => void, loading: boolean) => React.ReactNode;
}

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Connect: any;
  }
}

const MONO_SCRIPT_URL = "https://connect.mono.co/v2/connect.js";

function waitForSDK(timeout = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window.Connect !== "undefined") { resolve(); return; }
    const deadline = Date.now() + timeout;
    const poll = setInterval(() => {
      if (typeof window.Connect !== "undefined") { clearInterval(poll); resolve(); }
      else if (Date.now() > deadline) { clearInterval(poll); reject(new Error("Mono SDK did not load")); }
    }, 100);
  });
}

function injectMonoScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.getElementById("mono-sdk")) { waitForSDK().then(resolve, reject); return; }
    const s = document.createElement("script");
    s.id = "mono-sdk";
    s.src = MONO_SCRIPT_URL;
    s.async = true;
    s.onload = () => waitForSDK().then(resolve, reject);
    s.onerror = () => reject(new Error("Failed to load Mono script"));
    document.head.appendChild(s);
  });
}

export default function MonoConnect({ onSuccess, children }: MonoConnectProps) {
  const [loading, setLoading] = useState(false);

  useEffect(() => { injectMonoScript().catch(() => {}); }, []);

  const open = useCallback(async () => {
    setLoading(true);
    try {
      await injectMonoScript();
      const { public_key } = await api.monoPublicKey();

      const instance = new window.Connect({
        key: public_key,
        onSuccess: async ({ code }: { code: string }) => {
          setLoading(true);
          try {
            await api.monoExchange(code);
            onSuccess();
          } catch (e) {
            console.error("Mono exchange error:", e);
          } finally {
            setLoading(false);
          }
        },
        onClose: () => setLoading(false),
      });

      instance.setup({});
      instance.open();
    } catch (e) {
      console.error("MonoConnect open error:", e);
      setLoading(false);
    }
  }, [onSuccess]);

  return <>{children(open, loading)}</>;
}
