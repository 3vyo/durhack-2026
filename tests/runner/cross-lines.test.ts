import { afterEach, describe, expect, it } from 'vitest';
import { BATCH_USAGE, parseBatchArgs } from '../../src/runner/batch-args';
import { LiveSession } from '../../src/runner/live';
import { describeCrossLines, formatSummaries } from '../../src/runner/report';
import { onCrossLines, onLayout, runBatchRequest, runScenario, type ScenarioSummary, type Stats } from '../../src/runner/run';
import { stubBaseline, stubOurs } from '../../src/runner/stubs';
import { SCENARIOS } from '../../src/scenarios/scenarios';
import { CROSS_LINES, LAYOUT, applyCrossLines, applyLayout, resetLayout } from '../../src/shared/map';
import { SHORT_TIMETABLE, newWatch, seedWithLineA, watched } from './cross-probe';

// How the cross links switch travels through the runner. Design: "Cross links". A run says
// on or off, the switch is set before the run and put back after it, and a run that does not
// say runs with the switch off, as every run did before the switch existed. The stub programs
// are used throughout, so these check the runner and not the real train rules. The control
// centre decides who crosses, and that is tested with the centre.

// Some tests below switch the cross links on or pick another layout. Every test starts again
// from the default layout with the switch off.
afterEach(() => resetLayout());

const SEED = seedWithLineA();
const RUN_LENGTH = 900;

describe('onCrossLines', () => {
  it('switches the cross links on for the work and off again after it', () => {
    expect(onCrossLines(true, () => CROSS_LINES)).toBe(true);
    expect(CROSS_LINES).toBe(false);
  });

  it('puts the switch back on if it was on before', () => {
    applyCrossLines(true);
    expect(onCrossLines(false, () => CROSS_LINES)).toBe(false);
    expect(CROSS_LINES).toBe(true);
  });

  it('puts the switch back when the work throws', () => {
    expect(() =>
      onCrossLines(true, () => {
        throw new Error('stop');
      }),
    ).toThrow('stop');
    expect(CROSS_LINES).toBe(false);
  });

  it('leaves the layout alone, and onLayout leaves the switch alone', () => {
    applyLayout('busy');
    onCrossLines(true, () => expect(LAYOUT.id).toBe('busy'));
    expect(LAYOUT.id).toBe('busy');
    applyCrossLines(true);
    onLayout('hub', () => expect(CROSS_LINES).toBe(true));
    expect(CROSS_LINES).toBe(true);
  });
});

describe('runScenario and the cross links', () => {
  const options = { seed: SEED, scenario: SCENARIOS.healthy, timetable: SHORT_TIMETABLE, runLength: RUN_LENGTH };

  it('runs with the switch on when asked, as far as the engine, and switches it off after', () => {
    const watch = newWatch();
    const result = runScenario({ ...options, program: watched(stubOurs, watch, true), crossLines: true });
    expect([...watch.switches]).toEqual([true]);
    expect([...watch.links]).toEqual(['P3']);
    // The engine let line A trains onto P3, so it saw the switch on as well.
    expect(watch.crossed.size).toBeGreaterThan(0);
    expect(result.exits.size).toBe(SHORT_TIMETABLE.trains);
    expect(CROSS_LINES).toBe(false);
  });

  it('runs with the switch off when asked, and puts it back on after', () => {
    applyCrossLines(true);
    const watch = newWatch();
    runScenario({ ...options, program: watched(stubOurs, watch, true), crossLines: false });
    expect([...watch.switches]).toEqual([false]);
    expect([...watch.links]).toEqual(['']);
    // The engine stopped the line A trains at the end of A: nothing leads from A to P3.
    expect(watch.crossed.size).toBe(0);
    expect(CROSS_LINES).toBe(true);
  });

  it('uses the switch as it stands when the run does not say, which is off', () => {
    const watch = newWatch();
    runScenario({ ...options, program: watched(stubOurs, watch, true) });
    expect([...watch.switches]).toEqual([false]);
    expect(watch.crossed.size).toBe(0);
    expect(CROSS_LINES).toBe(false);
  });

  it('uses the switch as it stands when the run does not say, like the layout', () => {
    const watch = newWatch();
    onCrossLines(true, () => runScenario({ ...options, program: watched(stubOurs, watch, true) }));
    expect([...watch.switches]).toEqual([true]);
    expect(watch.crossed.size).toBeGreaterThan(0);
  });

  it('gives the same run with the switch left out as with it off', () => {
    const plain = { ...options, program: stubBaseline, scenario: SCENARIOS['centre-outage'] };
    const before = runScenario(plain);
    const off = runScenario({ ...plain, crossLines: false });
    expect([...off.exits]).toEqual([...before.exits]);
    expect(off).toEqual(before);
  });
});

// What the batch worker does with the page's message, `{ scenario, layout, crossLines }`.
describe('runBatchRequest and the cross links', { timeout: 30_000 }, () => {
  const run = (request: Parameters<typeof runBatchRequest>[0], watch = newWatch()) =>
    runBatchRequest(request, [SEED], { baseline: watched(stubBaseline, watch), ours: watched(stubOurs, watch) }, SHORT_TIMETABLE);

  it('runs every run of the batch with the switch on when the page asks, and switches it off after', () => {
    const watch = newWatch();
    const summary = run({ scenario: 'centre-outage', layout: 'junction', crossLines: true }, watch);
    expect(summary.scenario).toBe('centre-outage');
    // The healthy reference, the baseline and ours.
    expect(watch.builds).toEqual([true, true, true]);
    expect([...watch.switches]).toEqual([true]);
    expect([...watch.links]).toEqual(['P3']);
    expect(CROSS_LINES).toBe(false);
  });

  it('runs with the switch off when the message does not say', () => {
    const watch = newWatch();
    run({ scenario: 'centre-outage', layout: 'junction' }, watch);
    expect(watch.builds).toEqual([false, false, false]);
    expect([...watch.switches]).toEqual([false]);
    expect([...watch.links]).toEqual(['']);
  });

  it('runs with the switch off when the message does not say, even if it is on here, and leaves it on', () => {
    applyCrossLines(true);
    const watch = newWatch();
    run({ scenario: 'healthy' }, watch);
    expect([...watch.switches]).toEqual([false]);
    expect(CROSS_LINES).toBe(true);
  });

  it('gives the same summary with the switch left out as with it off', () => {
    expect(run({ scenario: 'centre-outage', crossLines: false })).toEqual(run({ scenario: 'centre-outage' }));
  });

  it('takes the layout and the switch together', () => {
    const busy = newWatch();
    run({ scenario: 'healthy', layout: 'busy', crossLines: true }, busy);
    expect([...busy.links]).toEqual(['P3']);
    // The branch layout has one line, so the switch is on and there is nowhere to cross to.
    const branch = newWatch();
    run({ scenario: 'healthy', layout: 'branch', crossLines: true }, branch);
    expect([...branch.switches]).toEqual([true]);
    expect([...branch.links]).toEqual(['']);
    expect(LAYOUT.id).toBe('junction');
    expect(CROSS_LINES).toBe(false);
  });

  it('throws for a crossLines that is not true or false, and runs nothing', () => {
    const watch = newWatch();
    const request = { scenario: 'healthy', crossLines: 'yes' } as unknown as Parameters<typeof runBatchRequest>[0];
    expect(() => run(request, watch)).toThrow('crossLines must be true or false, but is "yes"');
    expect(watch.builds).toEqual([]);
    expect(CROSS_LINES).toBe(false);
  });
});

describe('LiveSession and the cross links', () => {
  function session(crossLines?: boolean, watch = newWatch()): LiveSession {
    return new LiveSession({
      seed: SEED,
      scenario: SCENARIOS['centre-outage'],
      programs: { baseline: watched(stubBaseline, watch, true), ours: watched(stubOurs, watch, true) },
      timetable: SHORT_TIMETABLE,
      ...(crossLines === undefined ? {} : { crossLines }),
    });
  }

  it('runs both engines with the switch on when its options say so', () => {
    const watch = newWatch();
    const s = session(true, watch);
    expect(CROSS_LINES).toBe(true);
    s.speed = 100;
    for (let i = 0; i < 6; i++) s.tick(1);
    expect(watch.builds).toEqual([true, true]);
    expect([...watch.switches]).toEqual([true]);
    expect(watch.crossed.size).toBeGreaterThan(0);
    for (const engine of [s.baseline, s.ours]) {
      expect(engine.snapshot().trains.some((t) => t.pos.track === 'A' && t.pos.offset === 6000)).toBe(false);
    }
  });

  it('runs with the switch off when its options do not say', () => {
    const watch = newWatch();
    const s = session(undefined, watch);
    expect(CROSS_LINES).toBe(false);
    s.speed = 100;
    for (let i = 0; i < 6; i++) s.tick(1);
    expect(watch.builds).toEqual([false, false]);
    expect([...watch.switches]).toEqual([false]);
    expect(watch.crossed.size).toBe(0);
  });

  it('switches the cross links off when it is built without them, even if they were on', () => {
    applyCrossLines(true);
    session();
    expect(CROSS_LINES).toBe(false);
    applyCrossLines(true);
    session(false);
    expect(CROSS_LINES).toBe(false);
  });

  it('restarts with the same switch', () => {
    const watch = newWatch();
    const s = session(true, watch);
    s.tick(20);
    s.restart();
    s.tick(20);
    expect(watch.builds).toEqual([true, true, true, true]);
    expect([...watch.switches]).toEqual([true]);
    expect(CROSS_LINES).toBe(true);
  });

  // The engines and agents of a session all read the switch in use. If it changed under a
  // running session, the centre and the trains would stop agreeing about where A leads.
  it('refuses to step, spawn or restart once the switch is not as the session set it', () => {
    const s = session(true);
    s.tick(10);
    applyCrossLines(false);
    const message = 'this session was built with the cross links on and they are now off. Build a new session';
    expect(() => s.tick(1)).toThrow(message);
    expect(() => s.spawn('A')).toThrow(message);
    expect(() => s.restart()).toThrow(message);
    expect(s.ours.now).toBeCloseTo(10, 9);
    // With the switch back as it was the session carries on, and the refused calls changed nothing.
    applyCrossLines(true);
    s.tick(1);
    expect(s.ours.now).toBeCloseTo(11, 9);
    expect(s.spawn('A')).toBe(SHORT_TIMETABLE.trains + 1);
  });

  it('refuses the other way round too: built with them off, and now they are on', () => {
    const s = session();
    s.tick(1);
    applyCrossLines(true);
    expect(() => s.tick(1)).toThrow('this session was built with the cross links off and they are now on');
  });

  it('still does nothing while paused, whatever the switch', () => {
    const s = session();
    s.paused = true;
    applyCrossLines(true);
    expect(() => s.tick(1)).not.toThrow();
    expect(s.ours.now).toBe(0);
  });
});

describe('the batch command and the cross links', () => {
  const upTo = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

  it('switches them on for --cross', () => {
    expect(parseBatchArgs(['--cross'])).toEqual({ seeds: upTo(50), layouts: ['junction'], crossLines: true });
  });

  it('takes --cross with the seed count and the layout, in any order', () => {
    const want = { seeds: [1, 2, 3], layouts: ['hub'], crossLines: true };
    expect(parseBatchArgs(['3', '--layout=hub', '--cross'])).toEqual(want);
    expect(parseBatchArgs(['--cross', '--layout=hub', '3'])).toEqual(want);
    expect(parseBatchArgs(['--layout=all', '--cross']).layouts).toEqual(['branch', 'junction', 'busy', 'hub']);
  });

  it('leaves them off without --cross', () => {
    expect(parseBatchArgs([]).crossLines ?? false).toBe(false);
    expect(parseBatchArgs(['10', '--layout=busy']).crossLines ?? false).toBe(false);
    expect('crossLines' in parseBatchArgs([])).toBe(false);
  });

  it('throws for a flag that only looks like it', () => {
    expect(() => parseBatchArgs(['--cross=1'])).toThrow('cannot read the argument "--cross=1"');
    expect(() => parseBatchArgs(['--crossLines'])).toThrow(/cannot read the argument/);
    expect(() => parseBatchArgs(['cross'])).toThrow(/cannot read the argument "cross"/);
  });

  it('names the flag in the usage text', () => {
    expect(BATCH_USAGE).toContain('[--cross]');
  });
});

describe('the cross links in a printed report', () => {
  const stats: Stats = {
    meanDelay: 0,
    spreadDelay: 0,
    meanTimeToNormal: 0,
    neverRecovered: 0,
    collisions: 0,
    closeCalls: 0,
    overruns: 0,
  };
  const summary: ScenarioSummary = { scenario: 'healthy', seeds: 2, baseline: stats, ours: stats };

  it('names every link of a layout: each line to the first platform of the next line down', () => {
    expect(describeCrossLines('junction')).toBe('cross links on: A also leads to P3');
    expect(describeCrossLines('busy')).toBe('cross links on: A also leads to P3, B to P5');
    expect(describeCrossLines('hub')).toBe('cross links on: A also leads to P3, B to P5, C to P7');
  });

  it('says a layout with one line has nowhere to cross to', () => {
    expect(describeCrossLines('branch')).toBe('cross links on: this layout has no line to cross to');
  });

  it('describes the layout it is given, whatever layout and switch are in use', () => {
    applyLayout('branch');
    expect(describeCrossLines('hub')).toBe('cross links on: A also leads to P3, B to P5, C to P7');
    expect(CROSS_LINES).toBe(false);
  });

  it('says so on the line after the layout when the batch ran with them on', () => {
    const lines = formatSummaries([summary], 1, 'busy', true).split('\n');
    expect(lines[0]).toBe('layout busy: 3 entry lines, 6 platforms');
    expect(lines[1]).toBe('cross links on: A also leads to P3, B to P5');
    expect(lines[2]).toBe('healthy (2 seeds)');
    expect(formatSummaries([summary], 1, undefined, true).split('\n')[0]).toBe('cross links on');
  });

  it('prints what it printed before when they are off', () => {
    expect(formatSummaries([summary], 1, 'busy', false)).toBe(formatSummaries([summary], 1, 'busy'));
    expect(formatSummaries([summary], 1, 'busy')).not.toContain('cross');
    expect(formatSummaries([summary], 1)).not.toContain('cross');
  });
});
