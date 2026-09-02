import { Suspense } from "react";
import AccountPickerClient from "./AccountPickerClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <AccountPickerClient />
    </Suspense>
  );
}
