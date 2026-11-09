import { Suspense } from "react";
import FiledTransfersClient from "./FiledTransfersClient";

export default function Page() {
  return <Suspense fallback={null}><FiledTransfersClient /></Suspense>;
}
