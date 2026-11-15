import type { Metadata } from "next";
import { Suspense } from "react";
import AccountDetailsClient from "./AccountDetailsClient";

export const metadata: Metadata = { title: "Account details design round | Sorted", robots: { index: false, follow: false } };
export default function Page() { return <Suspense fallback={null}><AccountDetailsClient /></Suspense>; }
