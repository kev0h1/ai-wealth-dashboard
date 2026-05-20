import { Suspense } from "react";
import SettingsPage from "./SettingsPage";

export default function Settings() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-[#f0f2f7]" />}>
      <SettingsPage />
    </Suspense>
  );
}
