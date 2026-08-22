"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { NOTIFICATION_TAP_EVENT, consumePendingNotificationPaths } from "@/lib/capacitorPush";

// Receives the "user tapped a delivered push notification" handoff from
// lib/capacitorPush.ts and turns it into a soft Next.js route change via
// `router.push()`, instead of the hard `location.href` reload that used to
// fire directly from that non-component module. See
// `deliverNotificationPath`'s comment in lib/capacitorPush.ts for the full
// reasoning: a hard reload mid-hydration (cold start), or a hard reload
// behind BiometricLock (warm start), is what left buttons unresponsive
// after a tap on iOS. Renders nothing. Mounted once, in layout.tsx, next to
// NativePushResync.
export default function NotificationNavigator() {
  const router = useRouter();

  useEffect(() => {
    // Catches any taps already queued before this component mounted (a
    // slow cold start can outrun mount), so they're delayed, never dropped.
    // Navigated oldest first, so if more than one arrived before mount, the
    // most recently tapped path is the last one applied and wins, matching
    // what would happen if each had been handled live in arrival order.
    for (const queued of consumePendingNotificationPaths()) {
      router.push(queued);
    }

    const onTap = (e: Event) => {
      const path = (e as CustomEvent<{ path: string }>).detail?.path;
      if (path) router.push(path);
    };
    window.addEventListener(NOTIFICATION_TAP_EVENT, onTap);
    return () => window.removeEventListener(NOTIFICATION_TAP_EVENT, onTap);
  }, [router]);

  return null;
}
