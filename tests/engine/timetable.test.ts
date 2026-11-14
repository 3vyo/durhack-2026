import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIMETABLE,
  generateTimetable,
  makeRng,
  RUN_LENGTH,
} from '../../src/engine/timetable';

describe('makeRng', () => {
  it('gives the same sequence for the same seed', () => {
    const a = makeRng(42);
    const b = makeRng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('stays in [0, 1)', () => {
    const r = makeRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('generateTimetable', () => {
  const opts = DEFAULT_TIMETABLE;

  it('gives deep-equal output for the same seed', () => {
    expect(generateTimetable(1, opts)).toEqual(generateTimetable(1, opts));
  });

  it('differs between seeds', () => {
    expect(generateTimetable(1, opts)).not.toEqual(generateTimetable(2, opts));
  });

  it('numbers trains 1 to trains', () => {
    const tt = generateTimetable(3, opts);
    expect(tt.map((e) => e.id)).toEqual(Array.from({ length: opts.trains }, (_, i) => i + 1));
  });

  it('keeps each default platform inside its entry track pair', () => {
    for (const e of generateTimetable(4, opts)) {
      const pair = e.entry === 'A' ? ['P1', 'P2'] : ['P3', 'P4'];
      expect(pair).toContain(e.platform);
    }
  });

  it('names the previous train on the same entry track as leader, or null', () => {
    const tt = generateTimetable(5, opts);
    const lastOn: Record<string, number | null> = { A: null, B: null };
    for (const e of tt) {
      expect(e.leader).toBe(lastOn[e.entry]);
      lastOn[e.entry] = e.id;
    }
  });

  it('spaces entries at least minHeadway apart', () => {
    const tt = generateTimetable(6, opts);
    for (let i = 1; i < tt.length; i++) {
      expect(tt[i].enterAt - tt[i - 1].enterAt).toBeGreaterThanOrEqual(opts.minHeadway);
    }
  });

  it('gives every train the configured dwell', () => {
    for (const e of generateTimetable(8, opts)) expect(e.dwell).toBe(opts.dwell);
  });

  it('throws for zero trains', () => {
    expect(() => generateTimetable(1, { ...opts, trains: 0 })).toThrow('at least one train');
  });
});

describe('RUN_LENGTH', () => {
  it('is 2 hours, the one run length for the demo, the batch and the example files', () => {
    expect(RUN_LENGTH).toBe(7200);
  });

  it('leaves plenty of time after the last train enters, for every seed tried', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const tt = generateTimetable(seed, DEFAULT_TIMETABLE);
      expect(tt[tt.length - 1].enterAt).toBeLessThan(RUN_LENGTH / 4);
    }
  });
});

