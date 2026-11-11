import { Suspense } from "react";
import NotificationsPreview from "./NotificationsPreview";

export default function Page() {
  return <Suspense fallback={null}><NotificationsPreview /></Suspense>;
}
