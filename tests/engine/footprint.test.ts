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

describe('footprint and touchesZone on the tracks of the bigger layouts', () => {
  it('puts the rear on C or D just after a train moves onto its platform', () => {
    expect(footprint(body('P5', 50, 'C'))).toEqual([
      { track: 'P5', from: 0, to: 50 },
      { track: 'C', from: 5950, to: 6000 },
    ]);
    expect(footprint(body('P8', 50, 'D'))).toEqual([
      { track: 'P8', from: 0, to: 50 },
      { track: 'D', from: 5950, to: 6000 },
    ]);
    expect(footprint(body('EXIT', 30, 'P7'))).toEqual([
      { track: 'EXIT', from: 0, to: 30 },
      { track: 'P7', from: 330, to: 400 },
    ]);
  });

  it('puts the same edge of the zone at offset 300 on P5 to P8', () => {
    for (const p of ['P5', 'P6', 'P7', 'P8'] as const) {
      expect(touchesZone(footprint(body(p, 300))), p).toBe(true);
      expect(touchesZone(footprint(body(p, 299.99))), p).toBe(false);
    }
  });

  it('is false anywhere on C and D, as on A and B', () => {
    for (const entry of ['A', 'B', 'C', 'D'] as const) {
      expect(touchesZone(footprint(body(entry, 300))), entry).toBe(false);
      expect(touchesZone(footprint(body(entry, 5000))), entry).toBe(false);
      expect(touchesZone(footprint(body(entry, 6000))), entry).toBe(false);
    }
  });

  it('is true for a train leaving P7 until its rear is out of the first 200 m of EXIT', () => {
    expect(touchesZone(footprint(body('EXIT', 50, 'P7')))).toBe(true);
    expect(touchesZone(footprint(body('EXIT', 250, 'P7')))).toBe(true);
    expect(touchesZone(footprint(body('EXIT', 350, 'P7')))).toBe(false);
  });
});
