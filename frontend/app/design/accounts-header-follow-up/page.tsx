import { Suspense } from "react";
import AccountsHeaderFollowUpClient from "./AccountsHeaderFollowUpClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <AccountsHeaderFollowUpClient />
    </Suspense>
  );
}
