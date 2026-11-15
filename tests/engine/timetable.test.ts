import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIMETABLE,
  entersBefore,
  generateTimetable,
  makeRng,
  RUN_LENGTH,
  spawnEntry,
} from '../../src/engine/timetable';
import type { TimetableEntry } from '../../src/shared/types';

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


describe('spawnEntry', () => {
  const timetable: TimetableEntry[] = [
    { id: 1, entry: 'A', enterAt: 0, platform: 'P1', leader: null, dwell: 30 },
    { id: 2, entry: 'B', enterAt: 50, platform: 'P3', leader: null, dwell: 30 },
    { id: 3, entry: 'A', enterAt: 100, platform: 'P2', leader: 1, dwell: 30 },
    { id: 4, entry: 'A', enterAt: 300, platform: 'P1', leader: 3, dwell: 30 },
  ];

  it('takes the next free ID, is due now and uses the dwell given', () => {
    const entry = spawnEntry(timetable, 'B', 120, 45);
    expect(entry.id).toBe(5);
    expect(entry.enterAt).toBe(120);
    expect(entry.dwell).toBe(45);
    expect(entry.entry).toBe('B');
  });

  it('follows the last train on its track that comes before it, not a later one', () => {
    // Train 4 is not due until 300, so the new train goes in front of it, behind train 3.
    expect(spawnEntry(timetable, 'A', 120, 30).leader).toBe(3);
  });

  it('follows a train that is due but still waiting to enter', () => {
    // Train 3 was due at 100 and may still be outside the map at 100; it enters first.
    expect(spawnEntry(timetable, 'A', 100, 30).leader).toBe(3);
  });

  it('alternates the default platform from its leader, within its own pair', () => {
    expect(spawnEntry(timetable, 'A', 120, 30).platform).toBe('P1'); // leader 3 has P2
    expect(spawnEntry(timetable, 'B', 120, 30).platform).toBe('P4'); // leader 2 has P3
  });

  it('has no leader and the first platform of its pair when its track has no train before it', () => {
    const entry = spawnEntry(timetable, 'B', 10, 30);
    expect(entry.leader).toBeNull();
    expect(entry.platform).toBe('P3');
  });

  it('does not change the timetable', () => {
    const before = JSON.stringify(timetable);
    spawnEntry(timetable, 'A', 120, 30);
    expect(JSON.stringify(timetable)).toBe(before);
  });
});

describe('entersBefore', () => {
  const at = (id: number, enterAt: number): TimetableEntry => ({ id, entry: 'A', enterAt, platform: 'P1', leader: null, dwell: 30 });

  it('puts the earlier enterAt first, and the lower ID on a tie', () => {
    expect(entersBefore(at(5, 10), at(2, 20))).toBe(true);
    expect(entersBefore(at(2, 20), at(5, 10))).toBe(false);
    expect(entersBefore(at(2, 10), at(5, 10))).toBe(true);
    expect(entersBefore(at(5, 10), at(5, 10))).toBe(false);
  });
});
