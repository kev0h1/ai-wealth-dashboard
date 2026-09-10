import { Suspense } from "react";
import McpActivityPage from "./McpActivityPage";

export default function McpActivity() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a]" />}>
      <McpActivityPage />
    </Suspense>
  );
}
