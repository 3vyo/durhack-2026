import { describe, expect, it } from 'vitest';
import type { Body } from '../../src/engine/footprint';
import { checkSafety } from '../../src/engine/safety';
import type { TrackId } from '../../src/shared/types';

function body(id: number, track: TrackId, offset: number, prev: TrackId | null = null): Body {
  return { state: { id, pos: { track, offset }, speed: 10, brokenDown: false }, prev };
}

describe('checkSafety collisions', () => {
  it('counts overlapping trains on one track as a collision', () => {
    const active = new Set<string>();
    const r = checkSafety([body(1, 'A', 1000), body(2, 'A', 1050)], active);
    expect(r.collisions).toBe(1);
  });

  it('counts an ongoing overlap once, not every call', () => {
    const active = new Set<string>();
    const trains = [body(1, 'A', 1000), body(2, 'A', 1050)];
    expect(checkSafety(trains, active).collisions).toBe(1);
    expect(checkSafety(trains, active).collisions).toBe(0);
    expect(checkSafety(trains, active).collisions).toBe(0);
  });

  it('counts a new episode after the trains separate and overlap again', () => {
    const active = new Set<string>();
    const overlap = [body(1, 'A', 1000), body(2, 'A', 1050)];
    const apart = [body(1, 'A', 1000), body(2, 'A', 2000)];
    expect(checkSafety(overlap, active).collisions).toBe(1);
    expect(checkSafety(apart, active).collisions).toBe(0);
    expect(checkSafety(overlap, active).collisions).toBe(1);
  });

  it('sees a collision across a track boundary using the rear of the train', () => {
    const spanning = body(1, 'P1', 50, 'A');
    const behind = body(2, 'A', 5980);
    expect(checkSafety([spanning, behind], new Set()).collisions).toBe(1);
  });

  it('counts two trains in the junction zone together, including a rear still on a platform', () => {
    const leaving = body(1, 'EXIT', 50, 'P1');
    const arriving = body(2, 'P2', 350, 'A');
    expect(checkSafety([leaving, arriving], new Set()).collisions).toBe(1);
  });

  it('does not count one train alone in the zone', () => {
    expect(checkSafety([body(1, 'P1', 350, 'A')], new Set()).collisions).toBe(0);
  });

  it('does not count trains on different platforms outside the zone', () => {
    const r = checkSafety([body(1, 'P1', 200, 'A'), body(2, 'P2', 200, 'A')], new Set());
    expect(r.collisions).toBe(0);
  });

  it('does not count trains on different entry tracks', () => {
    expect(checkSafety([body(1, 'A', 1000), body(2, 'B', 1000)], new Set()).collisions).toBe(0);
  });
});

describe('checkSafety close calls', () => {
  it('counts a gap of 40 m as a close call', () => {
    const r = checkSafety([body(1, 'A', 1000), body(2, 'A', 1140)], new Set());
    expect(r.closeCalls).toBe(1);
    expect(r.collisions).toBe(0);
  });

  it('does not count a gap of 60 m', () => {
    const r = checkSafety([body(1, 'A', 1000), body(2, 'A', 1160)], new Set());
    expect(r.closeCalls).toBe(0);
  });

  it('counts an ongoing close call once', () => {
    const active = new Set<string>();
    const trains = [body(1, 'A', 1000), body(2, 'A', 1140)];
    expect(checkSafety(trains, active).closeCalls).toBe(1);
    expect(checkSafety(trains, active).closeCalls).toBe(0);
  });

  it('counts an overlap as a collision and not also as a close call', () => {
    const r = checkSafety([body(1, 'A', 1000), body(2, 'A', 1050)], new Set());
    expect(r).toEqual({ collisions: 1, closeCalls: 0 });
  });
});

describe('checkSafety on the tracks of the bigger layouts', () => {
  it('counts overlapping trains on C, and on D, as a collision', () => {
    expect(checkSafety([body(1, 'C', 1000), body(2, 'C', 1050)], new Set()).collisions).toBe(1);
    expect(checkSafety([body(1, 'D', 1000), body(2, 'D', 1050)], new Set()).collisions).toBe(1);
  });

  it('counts nothing for trains side by side on different entry tracks, whichever two they are', () => {
    const entries = ['A', 'B', 'C', 'D'] as const;
    for (const a of entries) {
      for (const b of entries) {
        if (a === b) continue;
        // 5000 is past offset 300, which is the zone edge on a platform but means nothing here.
        const r = checkSafety([body(1, a, 5000), body(2, b, 5000)], new Set());
        expect(r, `${a} and ${b}`).toEqual({ collisions: 0, closeCalls: 0 });
      }
    }
  });

  it('counts nothing for trains on all four entry tracks at once', () => {
    const trains = [body(1, 'A', 5000), body(2, 'B', 5020), body(3, 'C', 5040), body(4, 'D', 5060)];
    expect(checkSafety(trains, new Set())).toEqual({ collisions: 0, closeCalls: 0 });
  });

  it('counts overlapping trains on P7 as a collision, and a 40 m gap on P5 as a close call', () => {
    expect(checkSafety([body(1, 'P7', 150), body(2, 'P7', 200)], new Set()).collisions).toBe(1);
    const r = checkSafety([body(1, 'P5', 100), body(2, 'P5', 240)], new Set());
    expect(r).toEqual({ collisions: 0, closeCalls: 1 });
  });

  it('counts nothing for trains waiting side by side on different platforms, short of the zone', () => {
    const platforms = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'] as const;
    const trains = platforms.map((p, i) => body(i + 1, p, 299.99));
    expect(checkSafety(trains, new Set())).toEqual({ collisions: 0, closeCalls: 0 });
  });

  it('sees a collision across the end of D using the rear of the train', () => {
    expect(checkSafety([body(1, 'P8', 50, 'D'), body(2, 'D', 5980)], new Set()).collisions).toBe(1);
    expect(checkSafety([body(1, 'P8', 50, 'D'), body(2, 'C', 5980)], new Set()).collisions).toBe(0);
  });

  it('counts a close call on C and not one against a train on D', () => {
    expect(checkSafety([body(1, 'C', 1000), body(2, 'C', 1140)], new Set()).closeCalls).toBe(1);
    expect(checkSafety([body(1, 'C', 1000), body(2, 'D', 1140)], new Set()).closeCalls).toBe(0);
  });

  it('counts two trains in the junction zone together when they came through P5 and P8', () => {
    const leaving = body(1, 'EXIT', 50, 'P5');
    const arriving = body(2, 'P8', 350, 'D');
    expect(checkSafety([leaving, arriving], new Set()).collisions).toBe(1);
    expect(checkSafety([body(1, 'P6', 300, 'C'), body(2, 'P7', 300, 'D')], new Set()).collisions).toBe(1);
  });

  it('does not count a train in the zone from P7 with one waiting in P8', () => {
    const r = checkSafety([body(1, 'P7', 350, 'D'), body(2, 'P8', 299.99, 'D')], new Set());
    expect(r).toEqual({ collisions: 0, closeCalls: 0 });
  });
});
