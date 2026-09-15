import { Suspense } from "react";
import G96ReceiptsCanvasClient from "./G96ReceiptsCanvasClient";
export default function Page() { return <Suspense fallback={null}><G96ReceiptsCanvasClient /></Suspense>; }
