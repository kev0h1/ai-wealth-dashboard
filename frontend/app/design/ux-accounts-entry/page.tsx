import { Suspense } from "react";
import AccountsEntryPreview from "./AccountsEntryPreview";

export default function AccountsEntryPreviewPage() {
  return <Suspense fallback={null}><AccountsEntryPreview /></Suspense>;
}
