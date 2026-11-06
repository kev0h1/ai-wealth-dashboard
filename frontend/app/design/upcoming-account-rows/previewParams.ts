import { EXAMPLE_STATES, type ExampleState } from "./fixtures";

export type PreviewParams = { variant: "a" | "b" | "current"; mode: "light" | "dark"; state: ExampleState; hidden: boolean };
export function parsePreviewParams(raw: Record<string, string | string[] | undefined>): PreviewParams {
  const first = (key: string) => Array.isArray(raw[key]) ? raw[key][0] : raw[key];
  const state = first("state");
  return {
    variant: first("variant") === "b" ? "b" : first("variant") === "current" ? "current" : "a",
    mode: first("mode") === "dark" ? "dark" : "light",
    state: EXAMPLE_STATES.some(item => item.value === state) ? state as ExampleState : "moves",
    hidden: first("hidden") === "1",
  };
}
export function previewHref(params: PreviewParams) {
  return `/design/upcoming-account-rows?${new URLSearchParams({ variant: params.variant, mode: params.mode, state: params.state, hidden: params.hidden ? "1" : "0" })}`;
}
