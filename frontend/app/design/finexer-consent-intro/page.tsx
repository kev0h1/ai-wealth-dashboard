import type { Metadata } from "next";
import { Suspense } from "react";
import FinexerConsentIntroClient from "./FinexerConsentIntroClient";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <FinexerConsentIntroClient />
    </Suspense>
  );
}
