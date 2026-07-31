import { Suspense } from "react";
import StoryPlayer from "./StoryPlayer";

export default function Page() {
  return (
    <Suspense>
      <StoryPlayer />
    </Suspense>
  );
}
