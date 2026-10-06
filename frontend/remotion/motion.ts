// Motion helpers. Everything is frame-driven (spring / interpolate) so a
// render is deterministic; no CSS transitions or animations anywhere.
import { Easing, interpolate, spring } from "remotion";
import { FPS } from "./constants";

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** 0 to 1 spring starting at `from`. */
export function pop(frame: number, from: number, config: { damping?: number; stiffness?: number; mass?: number } = {}) {
  return spring({ frame: frame - from, fps: FPS, config: { damping: 18, stiffness: 160, mass: 0.7, ...config } });
}

/** Calm, no-overshoot settle (UI feel). */
export function settle(frame: number, from: number) {
  return spring({ frame: frame - from, fps: FPS, config: { damping: 26, stiffness: 120, mass: 0.9 } });
}

/** Linear window to eased 0..1 (ease-out cubic). */
export function ease(frame: number, a: number, b: number) {
  return interpolate(frame, [a, b], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
}

/** Ease-in-out 0..1 (for sweeps and camera moves). */
export function easeIO(frame: number, a: number, b: number) {
  return interpolate(frame, [a, b], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
}
