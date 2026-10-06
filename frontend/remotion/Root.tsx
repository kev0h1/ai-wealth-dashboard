import { Composition, staticFile } from "remotion";
import "./style.css";
import { SortedReel, type SortedReelProps } from "./SortedReel";
import { DURATION, FPS, HEIGHT, WIDTH } from "./constants";

const defaultProps: SortedReelProps = { iconSrc: staticFile("icons/icon-192.png") };

export const RemotionRoot = () => (
  <Composition
    id="SortedReel"
    component={SortedReel}
    durationInFrames={DURATION}
    fps={FPS}
    width={WIDTH}
    height={HEIGHT}
    defaultProps={defaultProps}
  />
);
