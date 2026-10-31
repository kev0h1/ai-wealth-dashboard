import { Suspense } from "react";
import Preview from "./Preview";

export default function AccountAvailabilityShortfallPage() {
  return <Suspense fallback={null}><Preview /></Suspense>;
}
