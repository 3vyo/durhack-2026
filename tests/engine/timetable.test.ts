import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_TIMETABLE,
  entersBefore,
  generateTimetable,
  makeRng,
  RUN_LENGTH,
  spawnEntry,
} from '../../src/engine/timetable';
import { ENTRIES, LAYOUT_IDS, LAYOUTS, PLATFORMS, applyLayout, pairOf, resetLayout } from '../../src/shared/map';
import type { EntryId, TimetableEntry, TrainId } from '../../src/shared/types';

afterEach(() => resetLayout());

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

describe('generateTimetable on the default layout', () => {
  // [id, entry, enterAt, platform, leader] for every train, as the generator gave them before
  // layouts existed. The default layout must keep giving exactly these.
  type Row = [TrainId, EntryId, number, string, TrainId | null];
  const before: Record<number, Row[]> = {
    1: [
      [1, 'B', 0, 'P3', null],
      [2, 'B', 45.1231074531097, 'P4', 1],
      [3, 'B', 134.27040098933503, 'P3', 2],
      [4, 'B', 191.92005862249061, 'P4', 3],
      [5, 'A', 269.3534999736585, 'P1', null],
      [6, 'A', 359.12053252919577, 'P2', 5],
      [7, 'A', 426.1160068132449, 'P1', 6],
      [8, 'A', 489.28452124237083, 'P2', 7],
      [9, 'A', 541.2367123144213, 'P1', 8],
      [10, 'A', 589.2683570680674, 'P2', 9],
      [11, 'A', 668.7882182362955, 'P1', 10],
      [12, 'A', 722.377529265359, 'P2', 11],
      [13, 'B', 786.6097172757145, 'P3', 4],
      [14, 'A', 867.5505069794599, 'P1', 12],
      [15, 'B', 921.796647378942, 'P4', 13],
      [16, 'B', 991.3703536510002, 'P3', 15],
    ],
    7: [
      [1, 'A', 0, 'P1', null],
      [2, 'B', 47.78812159085646, 'P3', null],
      [3, 'B', 124.24441334791481, 'P4', 2],
      [4, 'A', 187.4928893102333, 'P2', 1],
      [5, 'B', 243.28952267649584, 'P3', 3],
      [6, 'A', 321.1315167217981, 'P1', 4],
      [7, 'B', 373.14919309923425, 'P4', 5],
      [8, 'A', 441.4773076563142, 'P2', 6],
      [9, 'A', 503.03544435999356, 'P1', 8],
      [10, 'A', 572.0987230085302, 'P2', 9],
      [11, 'A', 661.106297710212, 'P1', 10],
      [12, 'A', 745.6063795101363, 'P2', 11],
      [13, 'A', 797.0709618832916, 'P1', 12],
      [14, 'B', 855.1637664728332, 'P3', 7],
      [15, 'A', 934.448082750896, 'P2', 13],
      [16, 'B', 1020.5304146104027, 'P4', 14],
    ],
    42: [
      [1, 'B', 0, 'P3', null],
      [2, 'B', 65.17307515488937, 'P4', 1],
      [3, 'A', 140.311107019661, 'P1', null],
      [4, 'A', 209.00777141796425, 'P2', 3],
      [5, 'B', 282.12128084502183, 'P3', 2],
      [6, 'A', 348.3755483245477, 'P1', 4],
      [7, 'B', 433.0681958317291, 'P4', 5],
      [8, 'A', 491.8832639360335, 'P2', 6],
      [9, 'B', 559.4160908844788, 'P3', 7],
      [10, 'A', 631.8940313137136, 'P1', 8],
      [11, 'B', 698.0792178818956, 'P4', 9],
      [12, 'B', 745.383634865284, 'P3', 11],
      [13, 'A', 791.802842868492, 'P2', 10],
      [14, 'A', 839.5830055279657, 'P1', 13],
      [15, 'B', 919.8426337202545, 'P4', 12],
      [16, 'A', 966.0631961398758, 'P2', 14],
    ],
  };

  for (const seed of [1, 7, 42]) {
    it(`gives the same timetable as before layouts existed, for seed ${seed}`, () => {
      const rows = generateTimetable(seed, DEFAULT_TIMETABLE).map((e) => [e.id, e.entry, e.enterAt, e.platform, e.leader]);
      expect(rows).toEqual(before[seed]);
    });
  }

  it('gives the same timetable after another layout was used and reset', () => {
    applyLayout('hub');
    generateTimetable(1, DEFAULT_TIMETABLE);
    resetLayout();
    const rows = generateTimetable(1, DEFAULT_TIMETABLE).map((e) => [e.id, e.entry, e.enterAt, e.platform, e.leader]);
    expect(rows).toEqual(before[1]);
  });
});

describe('generateTimetable on every layout', () => {
  const opts = { ...DEFAULT_TIMETABLE, trains: 80 };

  for (const layout of LAYOUT_IDS) {
    describe(layout, () => {
      it('uses every entry track of the layout and no other', () => {
        applyLayout(layout);
        for (let seed = 1; seed <= 5; seed++) {
          const used = new Set(generateTimetable(seed, opts).map((e) => e.entry));
          expect([...used].sort()).toEqual([...LAYOUTS[layout].entries]);
        }
      });

      it("keeps each default platform inside its entry track's own pair, and inside the layout", () => {
        applyLayout(layout);
        for (const e of generateTimetable(3, opts)) {
          expect(pairOf(e.entry)).toContain(e.platform);
          expect(PLATFORMS).toContain(e.platform);
          expect(ENTRIES).toContain(e.entry);
        }
      });

      it('alternates the default platform within each entry track, first platform first', () => {
        applyLayout(layout);
        const countOn = new Map<EntryId, number>();
        for (const e of generateTimetable(4, opts)) {
          const count = countOn.get(e.entry) ?? 0;
          expect(e.platform).toBe(pairOf(e.entry)[count % 2]);
          countOn.set(e.entry, count + 1);
        }
      });

      it('names the previous train on the same entry track as leader, or null for the first', () => {
        applyLayout(layout);
        const lastOn = new Map<EntryId, TrainId>();
        for (const e of generateTimetable(5, opts)) {
          expect(e.leader).toBe(lastOn.get(e.entry) ?? null);
          lastOn.set(e.entry, e.id);
        }
      });

      it('enters trains at the same times as the default layout, because each train still takes one draw', () => {
        resetLayout();
        const times = generateTimetable(6, opts).map((e) => e.enterAt);
        applyLayout(layout);
        expect(generateTimetable(6, opts).map((e) => e.enterAt)).toEqual(times);
      });
    });
  }

  it('puts every train on A in the branch layout, alternating P1 and P2 and following the train before', () => {
    applyLayout('branch');
    const tt = generateTimetable(2, DEFAULT_TIMETABLE);
    expect(tt.map((e) => e.entry)).toEqual(tt.map(() => 'A'));
    expect(tt.map((e) => e.platform)).toEqual(tt.map((_, i) => (i % 2 === 0 ? 'P1' : 'P2')));
    expect(tt.map((e) => e.leader)).toEqual(tt.map((_, i) => (i === 0 ? null : i)));
  });

  it('spreads trains over all four entry tracks in the hub layout', () => {
    applyLayout('hub');
    const tt = generateTimetable(1, { ...DEFAULT_TIMETABLE, trains: 400 });
    for (const entry of ['A', 'B', 'C', 'D'] as const) {
      const share = tt.filter((e) => e.entry === entry).length / tt.length;
      expect(share).toBeGreaterThan(0.15);
      expect(share).toBeLessThan(0.35);
    }
    for (const e of tt.filter((x) => x.entry === 'C')) expect(['P5', 'P6']).toContain(e.platform);
    for (const e of tt.filter((x) => x.entry === 'D')) expect(['P7', 'P8']).toContain(e.platform);
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

describe('spawnEntry on other layouts', () => {
  const timetable: TimetableEntry[] = [
    { id: 1, entry: 'A', enterAt: 0, platform: 'P1', leader: null, dwell: 30 },
    { id: 2, entry: 'C', enterAt: 50, platform: 'P5', leader: null, dwell: 30 },
    { id: 3, entry: 'D', enterAt: 60, platform: 'P7', leader: null, dwell: 30 },
    { id: 4, entry: 'D', enterAt: 100, platform: 'P8', leader: 3, dwell: 30 },
  ];

  it('gives a train on C or D a platform from its own pair, alternating from its leader', () => {
    applyLayout('hub');
    const onC = spawnEntry(timetable, 'C', 120, 30);
    expect(onC).toMatchObject({ id: 5, entry: 'C', leader: 2, platform: 'P6' });
    const onD = spawnEntry(timetable, 'D', 120, 30);
    expect(onD).toMatchObject({ id: 5, entry: 'D', leader: 4, platform: 'P7' });
  });

  it('gives the first train on a track no leader and the first platform of its pair', () => {
    applyLayout('hub');
    expect(spawnEntry(timetable, 'B', 120, 30)).toMatchObject({ leader: null, platform: 'P3' });
    expect(spawnEntry(timetable, 'C', 10, 30)).toMatchObject({ leader: null, platform: 'P5' });
    expect(spawnEntry(timetable, 'D', 10, 30)).toMatchObject({ leader: null, platform: 'P7' });
  });

  it('never follows a train on another entry track', () => {
    applyLayout('hub');
    expect(spawnEntry(timetable, 'C', 55, 30).leader).toBe(2);
    expect(spawnEntry(timetable, 'D', 55, 30).leader).toBeNull();
  });

  it('refuses an entry track that is not in the layout in use', () => {
    expect(() => spawnEntry([], 'C', 0, 30)).toThrow(/not in this layout/);
    expect(() => spawnEntry([], 'D', 0, 30)).toThrow(/not in this layout/);
    applyLayout('branch');
    expect(() => spawnEntry([], 'B', 0, 30)).toThrow(/not in this layout/);
    expect(spawnEntry([], 'A', 0, 30).platform).toBe('P1');
    applyLayout('busy');
    expect(spawnEntry([], 'C', 0, 30).platform).toBe('P5');
    expect(() => spawnEntry([], 'D', 0, 30)).toThrow(/not in this layout/);
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
