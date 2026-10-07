// G223 reel constants. Frames are absolute at 30fps, 450 frames = 15s.

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;
export const DURATION = 450;

// TikTok and Reels UI sits over these margins of the 1080x1920 frame. All
// text lives inside SAFE (same numbers as the G222 static story).
export const SAFE = { top: 160, bottom: 420, right: 140, left: 72 };
export const SAFE_BOX = {
  left: SAFE.left,
  top: SAFE.top,
  width: WIDTH - SAFE.left - SAFE.right, // 868
  height: HEIGHT - SAFE.top - SAFE.bottom, // 1340
};

// Beats (absolute frames).
export const BEAT = {
  hook: { from: 0, to: 66 },
  mess: { from: 60, to: 156 },
  answer: { from: 150, to: 306 },
  proof: { from: 300, to: 378 },
  end: { from: 372, to: 450 },
};

export const COPY = {
  hook1: "It’s the 20th.",
  hook2: "What can you actually spend?",
  messTitle: "The late-month maths",
  messCaption: "Bills, plans, a buffer. Then the maths.",
  answerCaption: "One number, worked out from your bank.",
  proofCaption: "Estimated, after bills, plans and your £100 buffer.",
  tagline: "Know what you can spend before payday.",
  cta: "Get Sorted",
};
