"use client";

import { useEffect } from "react";
import { useAuth } from "@/components/AuthProvider";
import { resyncCapacitorPush } from "@/lib/capacitorPush";

// Self-heals native push registration drift on app launch: an FCM/APNs
// token that rotated silently, or a token whose registration POST failed
// the first time. No-op on web and no-op unless OS permission is already
// granted and a session exists (see resyncCapacitorPush in lib/capacitorPush.ts
// for the full guard chain). Renders nothing.
export default function NativePushResync() {
  // A120: keyed on the signed-in user so a device that logs out and back in
  // (no app relaunch) registers for push again.
  const { user } = useAuth();
  const email = user?.email ?? null;
  useEffect(() => {
    resyncCapacitorPush().catch(() => {});
  }, [email]);
  return null;
}
