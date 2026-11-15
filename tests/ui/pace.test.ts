import { describe, expect, it } from 'vitest';
import { MAX_FPS, paceFrame } from '../../src/ui/pace';

/** How many frames are drawn in one second of a screen refreshing `hz` times a second. */
function drawnIn(hz: number, jitter = 0): number {
  let last = 0;
  let drawn = 0;
  for (let i = 1; i <= hz; i++) {
    const now = (i * 1000) / hz + (i % 2 === 0 ? jitter : -jitter);
    const kept = paceFrame(now, last);
    if (kept !== null) {
      last = kept;
      drawn += 1;
    }
  }
  return drawn;
}

describe('paceFrame', () => {
  it('draws every frame of a 60 Hz screen, even when the frames wobble', () => {
    expect(drawnIn(60)).toBe(60);
    expect(drawnIn(60, 0.4)).toBe(60);
  });

  it('draws about 60 frames a second on a faster screen', () => {
    for (const hz of [90, 120, 144, 240]) {
      expect(drawnIn(hz)).toBeGreaterThanOrEqual(MAX_FPS - 1);
      expect(drawnIn(hz)).toBeLessThanOrEqual(MAX_FPS);
    }
  });

  it('draws every frame of a screen slower than the cap', () => {
    expect(drawnIn(30)).toBe(30);
  });

  it('skips a frame that comes too soon after the last draw', () => {
    expect(paceFrame(1000 / 144, 0)).toBeNull();
  });

  it('starts again from now after a long gap, so it never draws a burst to catch up', () => {
    expect(paceFrame(5000, 0)).toBe(5000);
  });
});
