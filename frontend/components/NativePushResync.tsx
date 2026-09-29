"use client";

import { useEffect } from "react";
import { useAuth } from "@/components/AuthProvider";
import { api } from "@/lib/api";
import { resyncCapacitorPush } from "@/lib/capacitorPush";

// Self-heals native push registration drift on app launch: an FCM/APNs
// token that rotated silently, or a token whose registration POST failed
// the first time. No-op on web and no-op unless OS permission is already
// granted and a session exists (see resyncCapacitorPush in lib/capacitorPush.ts
// for the full guard chain). Renders nothing.
// A120: /auth/logout deletes the server-side web-push row but the browser's
// own PushSubscription survives, so Settings still reads "on". Re-POST the
// existing subscription on sign-in (never prompts, never subscribes anew) so
// a web user who logs out and back in keeps getting pushes.
async function resyncWebPush(): Promise<void> {
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
  if (Notification.permission !== "granted") return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) await api.subscribePush(sub.toJSON());
}

export default function NativePushResync() {
  // A120: keyed on the signed-in user so a device that logs out and back in
  // (no app relaunch) registers for push again.
  const { user } = useAuth();
  const email = user?.email ?? null;
  useEffect(() => {
    resyncCapacitorPush().catch(() => {});
    if (email) resyncWebPush().catch(() => {});
  }, [email]);
  return null;
}
