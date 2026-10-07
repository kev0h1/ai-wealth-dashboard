import { Suspense } from "react";
import PennyKeyboardClient from "./PennyKeyboardClient";

export default function PennyKeyboardPage() {
  return <Suspense fallback={null}><PennyKeyboardClient /></Suspense>;
}
