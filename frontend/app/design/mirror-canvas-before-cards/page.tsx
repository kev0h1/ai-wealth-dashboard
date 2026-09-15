import { Suspense } from "react"; import MirrorCanvasClient from "./MirrorCanvasClient";
export default function Page(){return <Suspense fallback={null}><MirrorCanvasClient/></Suspense>}
