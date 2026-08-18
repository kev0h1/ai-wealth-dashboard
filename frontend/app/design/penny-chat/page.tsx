// TEMPORARY PREVIEW — delete after design review.
import { Suspense } from "react";
import PennyChatClient from "./PennyChatClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <PennyChatClient />
    </Suspense>
  );
}
