import type { Metadata } from "next";
import { Suspense } from "react";
import SigninHandoffClient from "./SigninHandoffClient";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SigninHandoffClient />
    </Suspense>
  );
}
