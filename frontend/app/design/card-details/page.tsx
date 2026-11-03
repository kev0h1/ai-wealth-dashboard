import { Suspense } from "react";
import Preview from "./Preview";

export default function CardDetailsPage() {
  return <Suspense fallback={null}><Preview /></Suspense>;
}
