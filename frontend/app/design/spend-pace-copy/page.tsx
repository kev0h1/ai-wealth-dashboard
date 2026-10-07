import { Suspense } from "react";
import SpendPaceCopyClient from "./SpendPaceCopyClient";

export default function Page() {
  return <Suspense fallback={null}><SpendPaceCopyClient /></Suspense>;
}
