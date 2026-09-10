import { Suspense } from "react";
import G29ReconnectRowsClient from "./G29ReconnectRowsClient";

export default function Page() {
  return (
    <Suspense>
      <G29ReconnectRowsClient />
    </Suspense>
  );
}
