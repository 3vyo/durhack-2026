import { describe, expect, it } from 'vitest';
import { footprint, touchesZone, type Body } from '../../src/engine/footprint';
import type { TrackId } from '../../src/shared/types';

function body(track: TrackId, offset: number, prev: TrackId | null = null, id = 1): Body {
  return { state: { id, pos: { track, offset }, speed: 10, brokenDown: false }, prev };
}

describe('footprint', () => {
  it('covers the length of the train behind its front on one track', () => {
    expect(footprint(body('A', 5000))).toEqual([{ track: 'A', from: 4900, to: 5000 }]);
  });

  it('puts the rear on the previous track just after a boundary', () => {
    expect(footprint(body('P1', 50, 'A'))).toEqual([
      { track: 'P1', from: 0, to: 50 },
      { track: 'A', from: 5950, to: 6000 },
    ]);
    expect(footprint(body('EXIT', 30, 'P2'))).toEqual([
      { track: 'EXIT', from: 0, to: 30 },
      { track: 'P2', from: 330, to: 400 },
    ]);
  });

  it('stays on one track once the whole train is past the boundary', () => {
    expect(footprint(body('P1', 150, 'A'))).toEqual([{ track: 'P1', from: 50, to: 150 }]);
  });

  it('does not invent a previous track it has not seen', () => {
    expect(footprint(body('EXIT', 30, null))).toEqual([{ track: 'EXIT', from: 0, to: 30 }]);
  });
});

describe('touchesZone', () => {
  it('is true once any part of a train is past offset 300 on a platform', () => {
    expect(touchesZone(footprint(body('P1', 301)))).toBe(true);
  });

  it('is true for a train whose front is exactly at offset 300, as the shared map says', () => {
    expect(touchesZone(footprint(body('P1', 300)))).toBe(true);
  });

  it('is false for a train a centimetre short of the edge', () => {
    expect(touchesZone(footprint(body('P1', 299.99)))).toBe(false);
  });

  it('is true for a train on the first 200 m of EXIT', () => {
    expect(touchesZone(footprint(body('EXIT', 150, 'P1')))).toBe(true);
  });

  it('is true for a train whose front has left the zone but whose rear is still in it', () => {
    expect(touchesZone(footprint(body('EXIT', 250, 'P1')))).toBe(true);
    expect(touchesZone(footprint(body('EXIT', 350, 'P1')))).toBe(false);
  });

  it('is false on an entry track', () => {
    expect(touchesZone(footprint(body('A', 5000)))).toBe(false);
  });
});
