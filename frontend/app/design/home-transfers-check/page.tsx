import { Suspense } from "react";
import HomeTransfersPreview from "./HomeTransfersPreview";

export default function Page() {
  return <Suspense fallback={null}><HomeTransfersPreview /></Suspense>;
}
