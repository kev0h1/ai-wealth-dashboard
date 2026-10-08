"use client";

// Preview-only: the iframe is a static illustration of Finexer's hosted
// consent page. It deliberately has no provider URL, scripts, or live actions.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AGENT_DISCLOSURE } from "@/lib/regulatoryCopy";
import { buildDoc, type IntroMode } from "../finexer-consent-intro/fixtures";

type HostedConsentPreviewProps = {
  mode: IntroMode;
  disclosureAtProvider: boolean;
  bankName: string;
  onContinue: () => void;
  onBack: () => void;
};

const INITIAL_FRAME_HEIGHT = 720;

function withProviderDisclosure(doc: string) {
  // Replace only the contents of the Sorted-controlled header. Everything
  // following its closing tag is Finexer's generated shell and remains intact.
  const headerStart = '<div data-fx="header">';
  const headerEnd = '</div>\n<div class="fx-bar">';
  const intro = `<div data-sorted="provider-intro" style="margin:16px 16px 12px;padding:0 0 12px;border-bottom:1px solid var(--s-border)"><p style="margin:0;font-size:14px;line-height:1.5;color:var(--s-ink)"><strong>Sorted</strong> is asking for read-only access to your accounts.</p><p data-sorted="agency-disclosure" style="margin:12px 0 0;font-size:13px;line-height:1.55;color:var(--s-ink)">${AGENT_DISCLOSURE}</p></div>`;

  const headerStartAt = doc.indexOf(headerStart);
  const headerEndAt = doc.indexOf(headerEnd, headerStartAt);
  if (headerStartAt < 0 || headerEndAt < 0) return doc;

  return `${doc.slice(0, headerStartAt + headerStart.length)}${intro}${doc.slice(headerEndAt)}`;
}

function withPreviewCsp(doc: string) {
  // The static srcdoc needs its inline stylesheet, but nothing else may load.
  return doc.replace(
    "<head>",
    `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'">`,
  );
}

// Exported for the design route's focused tests. The CSP is the intentional
// safety exception to source-byte equality: it prevents the static mock from
// ever loading network resources while allowing its inline stylesheet.
export function buildHostedPreviewDoc(mode: IntroMode, disclosureAtProvider: boolean): string {
  const doc = disclosureAtProvider ? withProviderDisclosure(buildDoc(mode)) : buildDoc(mode);
  return withPreviewCsp(doc);
}

export default function HostedConsentPreview({
  mode,
  disclosureAtProvider,
  bankName,
  onContinue,
  onBack,
}: HostedConsentPreviewProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [frameHeight, setFrameHeight] = useState(INITIAL_FRAME_HEIGHT);
  const srcDoc = useMemo(() => buildHostedPreviewDoc(mode, disclosureAtProvider), [disclosureAtProvider, mode]);

  const resizeFrame = useCallback(() => {
    const document = frameRef.current?.contentDocument;
    if (!document) return;

    const height = Math.max(INITIAL_FRAME_HEIGHT, Math.ceil(document.body.getBoundingClientRect().height));
    setFrameHeight((current) => (current === height ? current : height));
  }, []);

  const observeFrame = useCallback(() => {
    const document = frameRef.current?.contentDocument;
    if (!document) return;

    resizeObserverRef.current?.disconnect();
    resizeFrame();
    const observer = new ResizeObserver(resizeFrame);
    observer.observe(document.body);
    resizeObserverRef.current = observer;
  }, [resizeFrame]);

  useEffect(
    () => () => {
      resizeObserverRef.current?.disconnect();
    },
    [],
  );

  return (
    <section aria-labelledby="hosted-consent-preview-title" className="mx-auto w-full max-w-[430px]">
      <div className="mb-3 px-1">
        <h2 id="hosted-consent-preview-title" className="text-[16px] font-bold text-slate-900 dark:text-slate-100">
          Connect {bankName}
        </h2>
        <p className="mt-1 text-[12px] font-medium text-slate-600 dark:text-slate-300">
          Finexer step illustration
        </p>
        {disclosureAtProvider && (
          <p className="mt-1 text-[13px] text-slate-600 dark:text-slate-300">Proposed intro. Needs Finexer approval.</p>
        )}
      </div>

      <iframe
        ref={frameRef}
        key={`${mode}-${disclosureAtProvider}`}
        title="Illustration of Finexer’s hosted consent step"
        sandbox="allow-same-origin"
        scrolling="no"
        className="block w-full rounded-2xl border border-slate-200 bg-white dark:border-slate-700"
        style={{ height: frameHeight, minHeight: INITIAL_FRAME_HEIGHT }}
        srcDoc={srcDoc}
        onLoad={observeFrame}
      />

      <div className="mt-3 flex gap-2 px-1" role="group" aria-label="Preview journey controls">
        <button
          type="button"
          onClick={onBack}
          className="min-h-[44px] flex-1 rounded-xl border border-slate-300 bg-white px-4 text-[14px] font-semibold text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus-visible:ring-offset-slate-900"
        >
          Back in preview
        </button>
        <button
          type="button"
          onClick={onContinue}
          className="min-h-[44px] flex-1 rounded-xl bg-indigo-600 px-4 text-[14px] font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900"
        >
          Continue preview
        </button>
      </div>
    </section>
  );
}
