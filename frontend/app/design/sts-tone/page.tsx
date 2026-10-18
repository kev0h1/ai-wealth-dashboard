import { Suspense } from "react";
import StsToneClient from "./StsToneClient";

export default function Page() {
  return <Suspense fallback={null}><StsToneClient /></Suspense>;
}
