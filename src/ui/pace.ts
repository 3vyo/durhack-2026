// How often the page draws. Pure, so the tests never need a browser.

/** The most frames the page draws each second. A 120 or 144 Hz screen would otherwise draw twice as many. */
export const MAX_FPS = 60;

/**
 * Decides whether to draw on this animation frame. `now` and `lastDraw` are in milliseconds.
 * Returns null to skip the frame, or the time to keep as the last draw.
 *
 * The time kept is one frame's length after the last draw, never later than now, so the draws
 * keep to a 60-a-second beat. A 144 Hz screen then draws close to 60 frames a second, not every
 * third frame, which would be 48. A frame that arrives up to 1 ms early still counts, so a
 * 60 Hz screen, whose frames wobble a little, never skips one.
 */
export function paceFrame(now: number, lastDraw: number, maxFps = MAX_FPS): number | null {
  const interval = 1000 / maxFps;
  const elapsed = now - lastDraw;
  if (elapsed < interval - 1) return null;
  // After a long gap, such as a tab in the background, start the beat again from now.
  if (elapsed >= interval * 2) return now;
  return Math.min(now, lastDraw + interval);
}
