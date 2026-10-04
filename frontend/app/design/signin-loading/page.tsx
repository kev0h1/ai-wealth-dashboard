import type { Metadata } from "next";
import { Suspense } from "react";
import SigninLoadingClient from "./SigninLoadingClient";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SigninLoadingClient />
    </Suspense>
  );
}
