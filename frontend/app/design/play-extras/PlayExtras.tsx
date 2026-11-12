"use client";
/* eslint-disable @next/next/no-img-element -- Review gallery displays exact export artwork. */
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import MoneyText from "@/components/MoneyText";
import { MEDIA_ROOT, PROMOTIONS, SHOTS, SPEC_CHECKED } from "./catalog";
import FilmFrame from "./FilmFrame";
import PromotionalCanvas, { PROMOTION_IDS, type PromotionId } from "./PromotionalCanvas";
import styles from "./play-extras.module.css";

export default function PlayExtras() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const theme = params.get("mode") === "dark" || (!params.has("mode") && params.get("state") === "dark") ? "dark" : "light";
  const art = params.get("art");
  const shot = params.get("shot");
  const safe = params.get("safe") === "1";
  const [videoError, setVideoError] = useState(false);
  if (params.get("copy") === "1") return <pre data-export-copy>{JSON.stringify({ shots: SHOTS, promotions: PROMOTIONS, checked: SPEC_CHECKED })}</pre>;
  if (art && PROMOTION_IDS.includes(art as PromotionId)) {
    const item = PROMOTIONS[art as PromotionId];
    if (params.get("export") === "1") return <PromotionalCanvas id={art as PromotionId} theme={theme} safeArea={safe} />;
    return <main className={`${styles.gallery} ${styles[theme]}`}>
      <div className={styles.links}><Link href={`${pathname}?mode=${theme}#promotion-title`}>Back to the extras</Link><a href={`${MEDIA_ROOT}/${art}-${theme}.png`} download>Download exact-size PNG</a></div>
      <header className={styles.header}><div><h1>{item.name}</h1><p><MoneyText text={safe ? "The guide marks the crop-safe area: 10% at the sides, 15% at the top and 20% at the bottom. It is excluded from the download." : item.context} unmasked /></p></div></header>
      <figure className={styles.imageReview}><img src={`${MEDIA_ROOT}/${art}-${theme}.png`} width={1920} height={1080} alt={item.alt} />{safe && <div className={styles.cropGuide} aria-hidden="true" />}</figure>
      <p>{item.condition}</p>
    </main>;
  }
  if (shot !== null && /^\d$/.test(shot) && Number(shot) < SHOTS.length) return <FilmFrame shot={Number(shot)} theme={theme} />;

  function setTheme(value: "light" | "dark") {
    const query = new URLSearchParams(params.toString());
    query.set("mode", value);
    router.replace(`${pathname}?${query}`, { scroll: false });
    setVideoError(false);
  }

  return <main className={`${styles.gallery} ${styles[theme]}`}>
    <a className={styles.skip} href="#promo-video">Skip to the promo video</a>
    <nav className={styles.links} aria-label="Design review"><Link href="/design">All previews</Link><Link href="/design/marketing-kit">C22 marketing kit</Link></nav>
    <header className={styles.header}>
      <div><h1>Google Play extras</h1><p>A 30-second product film and three promotional image templates, in the approved C22 style. Fictional examples throughout.</p></div>
      <fieldset className={styles.themes}><legend>Artwork theme</legend>{(["light", "dark"] as const).map(value => <button key={value} type="button" aria-pressed={theme === value} onClick={() => setTheme(value)}>{value === "light" ? "Light" : "Dark"}</button>)}</fieldset>
    </header>

    <section id="promo-video" aria-labelledby="video-title" className={styles.section}>
      <div className={styles.sectionHeading}><h2 id="video-title">The promo video</h2><span>1920 × 1080 · 30 seconds · Original C22 sound</span></div>
      <video key={theme} className={styles.video} controls playsInline preload="metadata" poster={`${MEDIA_ROOT}/promo-${theme}-poster.png`} aria-label={`Sorted Google Play promo video, ${theme} theme`} onError={() => setVideoError(true)}>
        <source src={`${MEDIA_ROOT}/promo-${theme}.mp4`} type="video/mp4" />
        <track kind="captions" src={`${MEDIA_ROOT}/promo.en-GB.vtt`} srcLang="en-GB" label="English" default />
        Your browser cannot play this film. Use the MP4 download or read the transcript below.
      </video>
      {videoError && <p role="status">The film could not load. Download the MP4 or read the transcript below.</p>}
      <div className={styles.links}><a href={`${MEDIA_ROOT}/promo-${theme}.mp4`} download>Download {theme} MP4</a><a href={`${MEDIA_ROOT}/promo.en-GB.vtt`} download>Download English captions</a><a href={`${MEDIA_ROOT}/sorted-play-${theme}.zip`} download>Download the {theme} pack</a></div>
      <p className={styles.note}>A landscape edit of the C22 spending, Penny and cover stories. Every shot shows the product. The existing C22 feature graphic and store screenshots remain the companion assets.</p>
      <details className={styles.details}><summary>Read the film transcript</summary><ol className={styles.transcript}>{SHOTS.map((item, index) => <li key={item.proof}><strong>{SHOTS.slice(0, index).reduce((sum, entry) => sum + entry.seconds, 0)}s</strong><p><MoneyText text={item.caption} unmasked /></p></li>)}</ol><p>Original instrumental sound only. There is no spoken narration.</p></details>
    </section>

    <section aria-labelledby="promotion-title" className={styles.section}>
      <div className={styles.sectionHeading}><h2 id="promotion-title">Promotional content images</h2><span>1920 × 1080 · RGB PNG · Launch plus two examples</span></div>
      <p className={styles.note}>Google keeps the headline and description outside this artwork. These text-free excerpts use the real product chart renderer. They are templates for a confirmed in-app launch or major update.</p>
      <div className={styles.promotionGrid}>{PROMOTION_IDS.map(id => {
        const item = PROMOTIONS[id];
        return <article key={id} className={styles.promotion}>
          <a className={styles.imageLink} href={`${pathname}?art=${id}&mode=${theme}`} aria-label={`Open exact-size ${item.name.toLowerCase()}, ${theme}`}><img src={`${MEDIA_ROOT}/${id}-${theme}.png`} width={1920} height={1080} alt={item.alt} loading="lazy" /></a>
          <h3>{item.name}</h3><p><MoneyText text={item.context} unmasked /></p>
          <div className={styles.links}><a href={`${MEDIA_ROOT}/${id}-${theme}.png`} download>Download PNG</a><a href={`${pathname}?art=${id}&mode=${theme}&safe=1`}>View crop-safe area</a></div>
          <details className={styles.details}><summary>Play copy and event conditions</summary><dl><dt>Tagline · {item.tagline.length} characters</dt><dd>{item.tagline}</dd><dt>Description</dt><dd>{item.description}</dd><dt>When to use it</dt><dd>{item.condition}</dd></dl></details>
        </article>;
      })}</div>
    </section>

    <section aria-labelledby="handoff-title" className={styles.section}>
      <h2 id="handoff-title">Ready for Kevin’s review</h2>
      <p>After approval, Kevin can upload the selected film to the Sorted YouTube channel as public or unlisted, with embedding enabled, no age restriction and no advertising or monetisation claims. Paste that video’s URL into the Play preview-video field.</p>
      <p>Promotional content is available to eligible apps. Choose a genuine launch or major update, confirm its in-app destination and dates, and check Play Console’s crop preview before submission. These examples do not announce a live event or a discount.</p>
      <p>Open banking is provided by Finexer Ltd, with AURIQ LTD as its agent.</p>
      <div className={styles.links}><a href={`${MEDIA_ROOT}/manifest.json`} download>Asset manifest</a><a href={`${MEDIA_ROOT}/play-copy.json`} download>Play copy and hand-off notes</a><a href="https://support.google.com/googleplay/android-developer/answer/9866151?hl=en">Google preview-video rules</a><a href="https://support.google.com/googleplay/android-developer/answer/12929944?hl=en">Google promotional-content rules</a></div>
      <p className={styles.note}>Official specifications checked {SPEC_CHECKED}. Creative review only. No assets have been uploaded or published.</p>
    </section>
  </main>;
}
