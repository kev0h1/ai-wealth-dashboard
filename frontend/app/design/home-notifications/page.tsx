import type { Metadata } from "next";
import { Suspense } from "react";
import HomeNotificationsClient from "./HomeNotificationsClient";

export const metadata: Metadata = {
  title: "Home notifications · Sorted design",
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <Suspense fallback={null}>
      <HomeNotificationsClient />
    </Suspense>
  );
}
