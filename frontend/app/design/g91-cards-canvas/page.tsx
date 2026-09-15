import { Suspense } from "react";
import G91CardsCanvasClient from "./G91CardsCanvasClient";

export default function Page() {
  return <Suspense fallback={null}><G91CardsCanvasClient /></Suspense>;
}
