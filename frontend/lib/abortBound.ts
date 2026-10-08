// G202: an AbortSignal that fires after `ms`, or sooner when `outer` aborts.
// Used to bound AuthProvider's session check so "signing in" cannot outlive
// its copy. No imports, runs under node in scripts/mobile-login-loop.test.mjs.
export function boundedSignal(ms: number, outer?: AbortSignal): { signal: AbortSignal; dispose: () => void } {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  const onOuter = () => ctrl.abort();
  if (outer) {
    if (outer.aborted) ctrl.abort();
    else outer.addEventListener("abort", onOuter, { once: true });
  }
  return {
    signal: ctrl.signal,
    dispose: () => {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onOuter);
    },
  };
}
