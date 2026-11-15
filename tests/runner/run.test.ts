import { afterEach, describe, expect, it } from 'vitest';
import type { TrainProgram } from '../../src/engine/ports';
import { DEFAULT_TIMETABLE } from '../../src/engine/timetable';
import {
  hasCollisions,
  healthyReference,
  onLayout,
  runBatch,
  runBatchRequest,
  runScenario,
  statsFor,
  type BatchRequest,
  type ScenarioSummary,
  type Stats,
} from '../../src/runner/run';
import type { RunResult } from '../../src/engine/engine';
import { stubBaseline, stubOurs } from '../../src/runner/stubs';
import { SCENARIOS } from '../../src/scenarios/scenarios';
import { ACCEL, BRAKE } from '../../src/shared/constants';
import { ENTRIES, LAYOUT, LAYOUT_IDS, LAYOUTS, PLATFORMS, applyLayout, entryOf, resetLayout, type LayoutId } from '../../src/shared/map';
import type { EntryId, PlatformId, TimetableEntry } from '../../src/shared/types';

// Some tests below pick another layout. Every test starts again from the default one.
afterEach(() => resetLayout());

const programs = { baseline: stubBaseline, ours: stubOurs };
const seeds = [1, 2, 3];

describe('runScenario', () => {
  it('gives the same exits for the same options', () => {
    const o = {
      seed: 4,
      scenario: SCENARIOS['centre-outage'],
      program: stubBaseline,
      timetable: DEFAULT_TIMETABLE,
    };
    const a = runScenario(o);
    const b = runScenario(o);
    expect([...a.exits]).toEqual([...b.exits]);
    expect(a.finished).toBe(true);
  });
});

// Each batch test runs several full simulations, so give them room when the machine is busy.
describe('runBatch', { timeout: 30_000 }, () => {
  it('scores the baseline against its own healthy run as zero delay', () => {
    const s = runBatch(SCENARIOS.healthy, seeds, programs, DEFAULT_TIMETABLE);
    expect(s.baseline.meanDelay).toBe(0);
    expect(s.baseline.meanTimeToNormal).toBe(0);
    expect(s.seeds).toBe(3);
    expect(s.scenario).toBe('healthy');
  });

  it('shows the baseline losing time in a centre outage while the stub fallback does not', () => {
    const s = runBatch(SCENARIOS['centre-outage'], seeds, programs, DEFAULT_TIMETABLE);
    expect(s.baseline.meanDelay).toBeGreaterThan(0);
    expect(s.ours.meanDelay).toBe(0);
    expect(s.ours.meanTimeToNormal).toBe(0);
    expect(s.baseline.meanTimeToNormal).not.toBeNull();
    expect(s.baseline.meanTimeToNormal as number).toBeGreaterThan(0);
  });

  it('is the same on a second run', () => {
    const a = runBatch(SCENARIOS['centre-outage'], seeds, programs, DEFAULT_TIMETABLE);
    const b = runBatch(SCENARIOS['centre-outage'], seeds, programs, DEFAULT_TIMETABLE);
    expect(a).toEqual(b);
  });

  it('throws for no seeds', () => {
    expect(() => runBatch(SCENARIOS.healthy, [], programs, DEFAULT_TIMETABLE)).toThrow('at least one seed');
  });

  it('throws for a duplicate seed', () => {
    expect(() => runBatch(SCENARIOS.healthy, [1, 2, 1], programs, DEFAULT_TIMETABLE)).toThrow('duplicate seed');
  });

  it('throws a clear message when the healthy reference cannot finish', () => {
    expect(() => runBatch(SCENARIOS.healthy, [1], programs, DEFAULT_TIMETABLE, 1)).toThrow(
      /reference did not finish/,
    );
  });

  it('reports collisions from a program that drives trains into each other', () => {
    // Every train drives for 20 s and then brakes hard, so consecutive trains on one entry
    // track end up stopped on top of each other. Trains enter at SIGHT_SPEED, so a train that
    // braked from the start would stop inside 245 m and the next one could never enter.
    const stopper: TrainProgram = {
      ...stubOurs,
      agentFactory: () => {
        let enteredAt: number | null = null;
        return {
          decide: ({ now }) => {
            enteredAt ??= now;
            return { accel: now - enteredAt < 20 ? ACCEL : -BRAKE, nextTrack: 'P1', outbox: [], mode: 'blind' };
          },
        };
      },
    };
    const s = runBatch(SCENARIOS.healthy, [1, 2], { baseline: stubBaseline, ours: stopper }, DEFAULT_TIMETABLE);
    expect(s.ours.collisions).toBeGreaterThan(0);
    expect(hasCollisions([s])).toBe(true);
  });

  it('gives both programs the identical timetable', () => {
    const seen: string[] = [];
    const recording = (base: TrainProgram): TrainProgram => ({
      ...base,
      agentFactory: (id, timetable) => {
        if (id === 1) seen.push(JSON.stringify(timetable));
        return base.agentFactory(id, timetable);
      },
    });
    runBatch(
      SCENARIOS['centre-outage'],
      [7],
      { baseline: recording(stubBaseline), ours: recording(stubOurs) },
      DEFAULT_TIMETABLE,
    );
    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(new Set(seen).size).toBe(1);
  });
});

describe('stub baseline', () => {
  const tt = [{ id: 1, entry: 'A' as const, enterAt: 0, platform: 'P1' as const, leader: null, dwell: 30 }];
  const state = { id: 1, pos: { track: 'A' as const, offset: 1000 }, speed: 45, brokenDown: false };
  const permit = [{ type: 'permit' as const, to: 1, untilX: 12400, nextTrack: null, sentAt: 0 }];

  it('keeps accelerating while it holds a permit and sees nothing ahead', () => {
    const agent = stubBaseline.agentFactory(1, tt);
    const out = agent.decide({ now: 0, self: state, inbox: permit, sightAhead: null });
    expect(out.accel).toBeGreaterThan(0);
    expect(out.mode).toBe('central');
  });

  it('brakes for a train it can see when it is going too fast to stop short of it', () => {
    const agent = stubBaseline.agentFactory(1, tt);
    const out = agent.decide({ now: 0, self: state, inbox: permit, sightAhead: 100 });
    expect(out.accel).toBeLessThan(0);
  });

  it('brakes to a stop once its permit is older than FRESH seconds', () => {
    const agent = stubBaseline.agentFactory(1, tt);
    agent.decide({ now: 0, self: state, inbox: permit, sightAhead: null });
    const out = agent.decide({ now: 6, self: state, inbox: [], sightAhead: null });
    expect(out.accel).toBeLessThan(0);
    expect(out.mode).toBe('blind');
  });
});

describe('hasCollisions', () => {
  const clean: Stats = {
    meanDelay: 0,
    spreadDelay: 0,
    meanTimeToNormal: 0,
    neverRecovered: 0,
    collisions: 0,
    closeCalls: 0,
    overruns: 0,
  };
  const summary = (baseline: Stats, ours: Stats): ScenarioSummary => ({
    scenario: 'healthy',
    seeds: 1,
    baseline,
    ours,
  });

  it('is false when nothing collided', () => {
    expect(hasCollisions([summary(clean, clean)])).toBe(false);
  });

  it('is true for a collision in ours', () => {
    expect(hasCollisions([summary(clean, { ...clean, collisions: 1 })])).toBe(true);
  });

  it('is true for a collision in the baseline, which is a bug in the rig', () => {
    expect(hasCollisions([summary({ ...clean, collisions: 1 }, clean)])).toBe(true);
  });
});

describe('healthyReference', () => {
  it('is the finished healthy run of the baseline for a seed', () => {
    const r = healthyReference(3, stubBaseline, DEFAULT_TIMETABLE);
    expect(r.finished).toBe(true);
    expect(r.collisions).toBe(0);
  });

  it('throws a clear message when the run is too short to finish', () => {
    expect(() => healthyReference(3, stubBaseline, DEFAULT_TIMETABLE, 1)).toThrow(
      /reference did not finish for seed 3/,
    );
  });
});

describe('statsFor', () => {
  const run = (): RunResult => ({
    runLength: 1000,
    finished: true,
    exits: new Map(),
    collisions: 0,
    closeCalls: 0,
    overruns: 0,
  });

  it('counts a seed that never recovered at the run length instead of hiding every other seed', () => {
    const s = statsFor([run(), run(), run()], [0, 0, 0], [60, null, 120], [300, 400, 500]);
    expect(s.neverRecovered).toBe(1);
    expect(s.meanTimeToNormal).toBeCloseTo((60 + 400 + 120) / 3, 9);
  });

  it('reports no stuck seeds when every seed recovered', () => {
    const s = statsFor([run(), run()], [0, 0], [30, 90], [300, 400]);
    expect(s.neverRecovered).toBe(0);
    expect(s.meanTimeToNormal).toBe(60);
  });
});

// The layouts: 'branch' has entry track A, 'junction' A and B, 'busy' A to C and 'hub' A to D,
// each with its own two platforms. Design: "Layouts". These use the stub programs, so they
// check the runner and not the real train rules. The stubs have no locks, so they can collide
// at the junction on any layout, and nothing here counts collisions.

/** A copy of a program that notes every timetable its agents are built from, and the layout in use then. */
function recording(base: TrainProgram, seen: Array<{ layout: LayoutId; timetable: TimetableEntry[] }>): TrainProgram {
  return {
    ...base,
    agentFactory: (id, timetable) => {
      if (id === 1) seen.push({ layout: LAYOUT.id, timetable });
      return base.agentFactory(id, timetable);
    },
  };
}

const entriesOf = (timetable: TimetableEntry[]): EntryId[] => [...new Set(timetable.map((e) => e.entry))].sort();
const platformsOf = (timetable: TimetableEntry[]): PlatformId[] => [...new Set(timetable.map((e) => e.platform))].sort();

describe('onLayout', () => {
  it('puts the layout in use for the work and the earlier one back afterwards', () => {
    const inside = onLayout('hub', () => ({ id: LAYOUT.id, entries: [...ENTRIES], platforms: PLATFORMS.length }));
    expect(inside).toEqual({ id: 'hub', entries: ['A', 'B', 'C', 'D'], platforms: 8 });
    expect(LAYOUT.id).toBe('junction');
    expect(PLATFORMS.length).toBe(4);
  });

  it('puts back the layout that was in use, which need not be the default', () => {
    applyLayout('busy');
    expect(onLayout('branch', () => LAYOUT.id)).toBe('branch');
    expect(LAYOUT.id).toBe('busy');
  });

  it('puts the layout back when the work throws', () => {
    expect(() =>
      onLayout('hub', () => {
        throw new Error('the run failed');
      }),
    ).toThrow('the run failed');
    expect(LAYOUT.id).toBe('junction');
  });
});

describe('runScenario on the four layouts', () => {
  it.each(LAYOUT_IDS)('gets every stub train through the %s layout from its own entry tracks and platforms', (layout) => {
    applyLayout(layout);
    const seen: Array<{ layout: LayoutId; timetable: TimetableEntry[] }> = [];
    const r = runScenario({
      seed: 2,
      scenario: SCENARIOS['centre-outage'],
      program: recording(stubBaseline, seen),
      timetable: DEFAULT_TIMETABLE,
    });
    expect(r.finished).toBe(true);
    expect(r.exits.size).toBe(DEFAULT_TIMETABLE.trains);
    const { timetable } = seen[0]!;
    // 16 trains are enough for seed 2 to use every entry track and every platform of each layout.
    expect(entriesOf(timetable)).toEqual([...LAYOUTS[layout].entries]);
    expect(platformsOf(timetable)).toEqual([...PLATFORMS]);
    for (const e of timetable) expect(entryOf(e.platform)).toBe(e.entry);
  });

  it('gives the default layout the timetable it always gave', () => {
    const seen: Array<{ layout: LayoutId; timetable: TimetableEntry[] }> = [];
    runScenario({ seed: 1, scenario: SCENARIOS.healthy, program: recording(stubBaseline, seen), timetable: DEFAULT_TIMETABLE });
    // Seed 1 on A and B, as it was before layouts existed.
    expect(seen[0]!.timetable.map((e) => e.entry).join('')).toBe('BBBBAAAAAAAABABB');
    expect(seen[0]!.timetable.slice(0, 6).map((e) => e.platform)).toEqual(['P3', 'P4', 'P3', 'P4', 'P1', 'P2']);
  });
});

describe('runBatch on a layout that is not the default', { timeout: 30_000 }, () => {
  it.each(['branch', 'busy', 'hub'] as const)('scores the healthy %s layout as zero delay for the baseline', (layout) => {
    const s = onLayout(layout, () => runBatch(SCENARIOS.healthy, [1, 2], programs, DEFAULT_TIMETABLE));
    expect(s.baseline.meanDelay).toBe(0);
    expect(s.baseline.meanTimeToNormal).toBe(0);
    expect(s.seeds).toBe(2);
  });

  it('summarises a centre outage on the hub layout, with every run on all four entry tracks', () => {
    const seen: Array<{ layout: LayoutId; timetable: TimetableEntry[] }> = [];
    const s = onLayout('hub', () =>
      runBatch(
        SCENARIOS['centre-outage'],
        seeds,
        { baseline: recording(stubBaseline, seen), ours: recording(stubOurs, seen) },
        DEFAULT_TIMETABLE,
      ),
    );
    expect(s.scenario).toBe('centre-outage');
    expect(s.seeds).toBe(3);
    expect(s.baseline.meanDelay).toBeGreaterThan(0);
    expect(s.ours.meanDelay).toBe(0);
    // Three runs for each seed: the healthy reference, the baseline and ours.
    expect(seen.length).toBe(9);
    for (const run of seen) {
      expect(run.layout).toBe('hub');
      expect(entriesOf(run.timetable)).toEqual(['A', 'B', 'C', 'D']);
    }
    expect(LAYOUT.id).toBe('junction');
  });

  it('gives a different summary on the hub layout than on the default, from the same seeds', () => {
    const junction = runBatch(SCENARIOS['centre-outage'], seeds, programs, DEFAULT_TIMETABLE);
    const hub = onLayout('hub', () => runBatch(SCENARIOS['centre-outage'], seeds, programs, DEFAULT_TIMETABLE));
    expect(hub).not.toEqual(junction);
    // And the default layout is untouched by the hub batch in between.
    expect(runBatch(SCENARIOS['centre-outage'], seeds, programs, DEFAULT_TIMETABLE)).toEqual(junction);
  });
});

// What the batch worker does with the page's message.
describe('runBatchRequest', { timeout: 30_000 }, () => {
  const run = (request: BatchRequest, seen: Array<{ layout: LayoutId; timetable: TimetableEntry[] }> = []) =>
    runBatchRequest(request, [1, 2], { baseline: recording(stubBaseline, seen), ours: recording(stubOurs, seen) }, DEFAULT_TIMETABLE);

  it('runs the scenario on the layout the page asked for and leaves the layout as it was', () => {
    const seen: Array<{ layout: LayoutId; timetable: TimetableEntry[] }> = [];
    const s = run({ scenario: 'centre-outage', layout: 'busy' }, seen);
    expect(s.scenario).toBe('centre-outage');
    expect(s.seeds).toBe(2);
    expect(seen.length).toBe(6);
    for (const r of seen) {
      expect(r.layout).toBe('busy');
      expect(entriesOf(r.timetable)).toEqual(['A', 'B', 'C']);
    }
    expect(LAYOUT.id).toBe('junction');
  });

  it('gives the same summary as a batch run directly on that layout', () => {
    const direct = onLayout('hub', () => runBatch(SCENARIOS['centre-outage'], [1, 2], programs, DEFAULT_TIMETABLE));
    expect(run({ scenario: 'centre-outage', layout: 'hub' })).toEqual(direct);
  });

  it('uses the default layout when the message names none, whatever layout is in use', () => {
    applyLayout('hub');
    const seen: Array<{ layout: LayoutId; timetable: TimetableEntry[] }> = [];
    run({ scenario: 'healthy' }, seen);
    for (const r of seen) {
      expect(r.layout).toBe('junction');
      expect(entriesOf(r.timetable)).toEqual(['A', 'B']);
    }
    expect(LAYOUT.id).toBe('hub');
  });

  it('throws for a layout or a scenario that does not exist', () => {
    expect(() => run({ scenario: 'healthy', layout: 'station' as LayoutId })).toThrow(/unknown layout "station"/);
    expect(() => run({ scenario: 'no-such' as BatchRequest['scenario'] })).toThrow(/unknown scenario "no-such"/);
    expect(LAYOUT.id).toBe('junction');
  });
});

describe('the stub programs on entry tracks C and D', () => {
  const tt: TimetableEntry[] = [
    { id: 1, entry: 'C', enterAt: 0, platform: 'P6', leader: null, dwell: 30 },
    { id: 2, entry: 'D', enterAt: 0, platform: 'P7', leader: null, dwell: 30 },
  ];
  const input = (id: number, track: TimetableEntry['entry'] | PlatformId | 'EXIT') => ({
    now: 0,
    self: { id, pos: { track, offset: 100 }, speed: 20, brokenDown: false },
    inbox: [],
    sightAhead: null,
  });

  it.each([
    ['ours', stubOurs],
    ['baseline', stubBaseline],
  ] as const)('the stub %s heads for its own platform from C and from D, then for EXIT', (_name, program) => {
    const onC = program.agentFactory(1, tt);
    const onD = program.agentFactory(2, tt);
    expect(onC.decide(input(1, 'C')).nextTrack).toBe('P6');
    expect(onD.decide(input(2, 'D')).nextTrack).toBe('P7');
    expect(onC.decide(input(1, 'P6')).nextTrack).toBe('EXIT');
    expect(onD.decide(input(2, 'P7')).nextTrack).toBe('EXIT');
    expect(onD.decide(input(2, 'EXIT')).nextTrack).toBeNull();
  });
});
