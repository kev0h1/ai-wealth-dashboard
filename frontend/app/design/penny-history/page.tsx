import { Suspense } from "react";
import PennyHistoryClient from "./PennyHistoryClient";

export default function PennyHistoryPage() {
  return <Suspense fallback={null}><PennyHistoryClient /></Suspense>;
}
