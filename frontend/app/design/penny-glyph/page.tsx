import { Suspense } from "react";
import PennyGlyphClient from "./PennyGlyphClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <PennyGlyphClient />
    </Suspense>
  );
}
