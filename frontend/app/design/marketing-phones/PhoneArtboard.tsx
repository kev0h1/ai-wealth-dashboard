import PhoneFrame from "./PhoneFrame";
import ProductScreen from "./ProductScreen";
import { FORMATS, STORIES, type PhoneFormat, type PhoneTheme, type PhoneVariant, type StoryId } from "./catalog";
import styles from "./phones.module.css";

type Props = { format: PhoneFormat; story: StoryId; theme: PhoneTheme; variant: PhoneVariant };

export default function PhoneArtboard({ format, story, theme, variant }: Props) {
  const spec = FORMATS[format];
  const item = STORIES[story];
  return <article
    className={`${styles.artboard} ${styles[`artboard${variant.toUpperCase()}`]} ${styles[theme]} ${theme === "dark" ? "dark" : ""} ${styles[format]}`}
    data-c22-artboard
    data-c22-format={format}
    data-c22-variant={variant}
    data-c22-theme={theme}
    role="img"
    aria-label={`${item.title}, ${spec.modelLabel} illustrative phone artwork`}
    style={{ width: spec.cssWidth, height: spec.cssHeight }}
  >
    <div className={styles.artCopy} data-c22-copy>
      <h1>{item.headline}</h1>
    </div>
    <div className={styles.phoneStage}>
      <PhoneFrame model={spec.model}><ProductScreen story={story} theme={theme} /></PhoneFrame>
    </div>
    <p className={styles.frameNote}>Fictional example · 17 November 2026</p>
  </article>;
}
