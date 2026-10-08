import { Composition } from "remotion";
import { MarketingFilm, type MarketingFilmProps } from "./MarketingFilm";
import { filmDefinitions, type MarketingFilmId } from "./constants";

const ids = Object.keys(filmDefinitions) as MarketingFilmId[];

export const MarketingKitRoot = () => (
  <>
    {ids.flatMap((film) => (["light", "dark"] as const).map((theme) => {
      const definition = filmDefinitions[film];
      const composition = {
        durationInFrames: definition.durationInFrames,
        fps: definition.fps,
        width: definition.width,
        height: definition.height,
      };
      const defaultProps: MarketingFilmProps = { film, theme };
      return <Composition key={`${film}-${theme}`} id={`Marketing-${film}-${theme}`} component={MarketingFilm} {...composition} defaultProps={defaultProps} />;
    }))}
  </>
);
