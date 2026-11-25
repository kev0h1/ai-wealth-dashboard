"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { PhoneModel } from "./catalog";
import styles from "./phones.module.css";

type Props = {
  model: PhoneModel;
  viewportWidth: number;
  children: ReactNode;
};

/** An illustrative hardware surround. It contains live product UI, never a captured screenshot. */
export default function PhoneFrame({ model, viewportWidth, children }: Props) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState({ width: viewportWidth, height: viewportWidth * 2 });
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const element = contentRef.current;
    if (!element) return;
    const measure = () => {
      const width = element.clientWidth;
      const padding = getComputedStyle(element);
      const height = element.clientHeight - parseFloat(padding.paddingTop) - parseFloat(padding.paddingBottom);
      if (width <= 0 || height <= 0) return;
      setAvailable({ width, height });
      setReady(true);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);
  // The product is always laid out at the format's real logical width, then
  // reduced with one scale factor to fit the illustrative display. In
  // particular, a narrow Android chassis must not make the app a 320px UI.
  const scale = available.width / viewportWidth;
  const viewportHeight = available.height / scale;
  return <div className={`${styles.phone} ${styles[model]}`} data-c22-phone data-c22-model={model}>
    <span className={styles.sideButton} aria-hidden="true" />
    <span className={styles.sideButtonLower} aria-hidden="true" />
    <div className={styles.phoneScreen} data-c22-screen>
      <span className={styles.camera} aria-hidden="true" />
      <div className={styles.statusBar} aria-hidden="true"><span>09:41</span><span className={styles.statusMarks}><i /><b /><em /></span></div>
      <div className={styles.screenContent} ref={contentRef}>
        <div className={styles.productViewport} data-c22-product-viewport data-c22-viewport-ready={ready ? "true" : "false"} aria-hidden="true" inert style={{ width: viewportWidth, height: viewportHeight, transform: `scale(${scale})` }}>{children}</div>
      </div>
      <span className={styles.homeGesture} aria-hidden="true" />
    </div>
  </div>;
}
