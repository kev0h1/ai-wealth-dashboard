import { Suspense } from "react";
import PhoneGallery from "./PhoneGallery";

export default function Page() {
  return <Suspense fallback={<p className="p-6">Loading phone artwork…</p>}><PhoneGallery /></Suspense>;
}
