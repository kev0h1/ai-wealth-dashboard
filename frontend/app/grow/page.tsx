"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Grow folded into Planning (2026-09-04). Kept as a client redirect
// because the Capacitor static export cannot use next.config redirects().
export default function GrowPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/planning");
  }, [router]);
  return <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a]" />;
}
