import { Suspense } from "react";
import G93PennyCanvasClient from "./G93PennyCanvasClient";
export default function Page() { return <Suspense fallback={null}><G93PennyCanvasClient /></Suspense>; }
