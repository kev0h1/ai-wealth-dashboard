import { Suspense } from "react";
import { Viewport } from "next";
import SettingsPage from "./SettingsPage";

export const viewport: Viewport = { themeColor: "#4f46e5" };

export default function Settings() {
  return (
    <Suspense fallback={<div className="min-h-dvh" style={{ background: "linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%)" }} />}>
      <SettingsPage />
    </Suspense>
  );
}
