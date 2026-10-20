import { Suspense } from "react";
import SettingsFollowupsClient from "./SettingsFollowupsClient";

export default function Page() {
  return <Suspense fallback={null}><SettingsFollowupsClient /></Suspense>;
}
