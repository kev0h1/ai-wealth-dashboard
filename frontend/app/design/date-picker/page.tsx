import type { Metadata } from "next";
import { Suspense } from "react";
import DatePickerClient from "./DatePickerClient";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <Suspense>
      <DatePickerClient />
    </Suspense>
  );
}
