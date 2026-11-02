import { Suspense } from "react";
import AccountsRefreshPreview from "./AccountsRefreshPreview";

export default function AccountsRefreshPage() {
  return <Suspense fallback={null}><AccountsRefreshPreview /></Suspense>;
}
