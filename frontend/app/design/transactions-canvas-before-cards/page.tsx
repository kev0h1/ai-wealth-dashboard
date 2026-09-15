import { Suspense } from "react";
import TransactionsCanvasClient from "./TransactionsCanvasClient";
export default function Page() { return <Suspense fallback={null}><TransactionsCanvasClient /></Suspense>; }
