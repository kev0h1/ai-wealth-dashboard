// Props-capturing stand-in for components/MonthClosedCard.tsx, substituted
// in place of the real component ONLY inside
// scripts/month-closed-dismiss.test.mjs, via the specifier redirect in
// scripts/g168-stub-loader.mjs.
//
// Why this exists: this repo's test harness has no jsdom/click-simulation
// (see scripts/spend-from-render.test.mjs's own "ceiling on this technique"
// comment — renderToStaticMarkup cannot fire a DOM click). The property
// this stub exists to prove is not visual, it's behavioural: which
// function does HomeBrief.tsx's BriefBody construct and hand to
// MonthClosedCard as `onDismiss` for the needle item? Capturing the real
// props BriefBody passes and then calling `onDismiss()` directly (a plain
// JS function call — exactly what a real click ultimately does once React
// dispatches the event) is the only way to exercise that closure without a
// DOM.
export const capturedProps = [];

export default function MonthClosedCardStub(props) {
  capturedProps.push(props);
  return null;
}
