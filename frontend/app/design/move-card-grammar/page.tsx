import { Suspense } from "react";
import MoveCardGrammarClient from "./MoveCardGrammarClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <MoveCardGrammarClient />
    </Suspense>
  );
}

