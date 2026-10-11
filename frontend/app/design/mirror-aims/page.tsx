import { Suspense } from "react";
import MirrorAimsClient from "./MirrorAimsClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <MirrorAimsClient />
    </Suspense>
  );
}
