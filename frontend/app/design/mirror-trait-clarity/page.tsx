import { Suspense } from "react";
import MirrorTraitClarityClient from "./MirrorTraitClarityClient";

export default function MirrorTraitClarityPage() {
  return <Suspense fallback={null}><MirrorTraitClarityClient /></Suspense>;
}
