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
