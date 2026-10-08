import { Suspense } from "react";
import SettingsOverhaulClient from "./SettingsOverhaulClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SettingsOverhaulClient />
    </Suspense>
  );
}
