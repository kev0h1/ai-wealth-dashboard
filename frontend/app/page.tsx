import { Suspense } from "react";
import HomePage from "./components/HomePage";

export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-[#f0f2f7]" />}>
      <HomePage />
    </Suspense>
  );
}
