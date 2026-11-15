import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_TIMETABLE, RUN_LENGTH } from '../../src/engine/timetable';
import { LiveSession } from '../../src/runner/live';
import { baselineProgram, ourProgram } from '../../src/runner/programs';
import { stubBaseline, stubOurs } from '../../src/runner/stubs';
import { SCENARIOS } from '../../src/scenarios/scenarios';
import { LAYOUT_IDS, LAYOUTS, applyLayout, isEntryTrack, pairOf, resetLayout } from '../../src/shared/map';
import type { EntryId } from '../../src/shared/types';

// Some tests below pick another layout. Every test starts again from the default one.
afterEach(() => resetLayout());

function session(scripted = false, scenario = SCENARIOS['centre-outage']): LiveSession {
  return new LiveSession({
    seed: 3,
    scenario,
    programs: { baseline: stubBaseline, ours: stubOurs },
    timetable: DEFAULT_TIMETABLE,
    scripted,
  });
}

describe('LiveSession time', () => {
  it('advances both engines by 10 steps for one real second at speed 1', () => {
    const s = session();
    s.tick(1);
    expect(s.baseline.now).toBeCloseTo(1, 9);
    expect(s.ours.now).toBeCloseTo(1, 9);
  });

  it('advances 4 simulated seconds per real second at speed 4', () => {
    const s = session();
    s.speed = 4;
    s.tick(1);
    expect(s.baseline.now).toBeCloseTo(4, 9);
    expect(s.ours.now).toBeCloseTo(4, 9);
  });

  it('carries a remainder smaller than one step', () => {
    const s = session();
    s.tick(0.05);
    expect(s.baseline.now).toBe(0);
    s.tick(0.05);
    expect(s.baseline.now).toBeCloseTo(0.1, 9);
  });

  it('does not advance while paused', () => {
    const s = session();
    s.paused = true;
    s.tick(5);
    expect(s.baseline.now).toBe(0);
    expect(s.ours.now).toBe(0);
  });

  it('keeps both engines on the same simulated time', () => {
    const s = session();
    s.speed = 3;
    for (let i = 0; i < 20; i++) s.tick(0.37);
    expect(s.baseline.now).toBe(s.ours.now);
  });
});

describe('LiveSession presses', () => {
  it('applies a press to both engines at the same simulated time while paused', () => {
    const s = session();
    s.tick(2);
    s.paused = true;
    s.press({ centre: false });
    expect(s.baseline.snapshot().switches.centre).toBe(false);
    expect(s.ours.snapshot().switches.centre).toBe(false);
    expect(s.baseline.now).toBe(s.ours.now);
  });

  it('applies a press made just after a speed change to both engines at the same time', () => {
    const s = session();
    s.tick(1);
    s.speed = 5;
    s.tick(0.5);
    s.press({ radioDrop: 1 });
    expect(s.baseline.snapshot().switches.radioDrop).toBe(1);
    expect(s.ours.snapshot().switches.radioDrop).toBe(1);
    expect(s.baseline.now).toBe(s.ours.now);
    expect(s.baseline.now).toBeCloseTo(3.5, 9);
  });

  it('lets later steps run with the press in force in both engines', () => {
    const s = session();
    s.press({ centre: false });
    s.tick(10);
    expect(s.baseline.snapshot().switches.centre).toBe(false);
    expect(s.ours.snapshot().switches.centre).toBe(false);
  });
});

describe('LiveSession restart', () => {
  it('returns both engines to time 0 and forgets live presses', () => {
    const s = session();
    s.press({ centre: false });
    s.tick(30);
    s.restart();
    expect(s.baseline.now).toBe(0);
    expect(s.ours.now).toBe(0);
    expect(s.baseline.snapshot().switches.centre).toBe(true);
  });

  it('gives the same snapshots as a fresh session for the same seed', () => {
    const s = session();
    s.tick(60);
    s.restart();
    s.tick(20);
    const fresh = session();
    fresh.tick(20);
    expect(JSON.stringify(s.ours.snapshot())).toBe(JSON.stringify(fresh.ours.snapshot()));
    expect(JSON.stringify(s.baseline.snapshot())).toBe(JSON.stringify(fresh.baseline.snapshot()));
  });
});

describe('LiveSession scripted presses', () => {
  it('ignores the scenario presses by default, so only live presses count', () => {
    const s = session(false);
    s.tick(1500);
    expect(s.baseline.snapshot().switches.centre).toBe(true);
  });

  it('fires the scenario presses when scripted', () => {
    const s = session(true);
    let cut = false;
    for (let i = 0; i < 1500 && !cut; i++) {
      s.tick(1);
      cut = !s.baseline.snapshot().switches.centre;
    }
    expect(cut).toBe(true);
    expect(s.ours.snapshot().switches.centre).toBe(false);
  });
});

describe('LiveSession spawn', () => {
  it('adds the same train to both engines at the same simulated time', () => {
    const s = session();
    s.tick(30); // long enough for the first train to clear the start of its line
    const id = s.spawn('B');
    expect(id).toBe(DEFAULT_TIMETABLE.trains + 1);
    s.tick(0.1);
    expect(s.baseline.snapshot().trains.map((t) => t.id)).toContain(id);
    expect(s.ours.snapshot().trains.map((t) => t.id)).toContain(id);
  });

  it('gives each spawned train its own ID', () => {
    const s = session();
    const n = DEFAULT_TIMETABLE.trains;
    expect([s.spawn('A'), s.spawn('A'), s.spawn('B')]).toEqual([n + 1, n + 2, n + 3]);
  });

  it('forgets spawned trains on restart', () => {
    const s = session();
    const id = s.spawn('A');
    s.tick(1);
    s.restart();
    s.tick(1);
    expect(s.ours.snapshot().trains.map((t) => t.id)).not.toContain(id);
    expect(s.spawn('A')).toBe(id);
  });

  // The real programs with extra trains, including trains added while the control centre
  // is off, so our trains add them to the platform keeper's queue on their own rules.
  it.each([1, 2, 3])('runs spawned trains through both real programs with no collision, seed %i', (seed) => {
    const s = new LiveSession({
      seed,
      scenario: SCENARIOS['centre-outage'],
      programs: { baseline: baselineProgram, ours: ourProgram },
      timetable: DEFAULT_TIMETABLE,
    });
    const plan: Array<{ at: number; act: () => void }> = [
      { at: 60, act: () => s.spawn('A') },
      { at: 60, act: () => s.spawn('B') },
      { at: 240, act: () => s.press({ centre: false }) },
      { at: 300, act: () => s.spawn('A') },
      { at: 330, act: () => s.spawn('B') },
      { at: 360, act: () => s.press({ centre: true }) },
      { at: 500, act: () => s.spawn('A') },
    ];
    for (const step of plan) {
      s.tick(step.at - s.ours.now);
      step.act();
    }
    s.speed = 1000;
    while (!(s.ours.finished && s.baseline.finished) && s.ours.now < RUN_LENGTH) s.tick(1);
    for (const engine of [s.baseline, s.ours]) {
      const r = engine.result();
      expect(r.collisions).toBe(0);
      expect(r.overruns).toBe(0);
      expect(r.exits.size).toBe(DEFAULT_TIMETABLE.trains + 5);
    }
  });
});

// A session runs on the layout in use when it is built: 'branch' has entry track A only,
// 'junction' A and B, 'busy' A to C and 'hub' A to D. Design: "Layouts".
describe('LiveSession on the four layouts', () => {
  /** Every entry track a train has been seen on, in either engine, over the first `seconds`. */
  function entryTracksSeen(s: LiveSession, seconds: number): EntryId[] {
    const seen = new Set<EntryId>();
    for (let t = 0; t < seconds; t += 5) {
      s.tick(5);
      for (const engine of [s.baseline, s.ours]) {
        for (const train of engine.snapshot().trains) if (isEntryTrack(train.pos.track)) seen.add(train.pos.track);
      }
    }
    return [...seen].sort();
  }

  it.each(LAYOUT_IDS)('runs its timetable on every entry track of the %s layout and on no other', (layout) => {
    applyLayout(layout);
    expect(entryTracksSeen(session(), 1200)).toEqual([...LAYOUTS[layout].entries]);
  });

  it('spawns a train on D on the hub layout, in both engines, bound for one of D\'s own platforms', () => {
    applyLayout('hub');
    const s = session();
    s.tick(30);
    const id = s.spawn('D');
    expect(id).toBe(DEFAULT_TIMETABLE.trains + 1);
    s.tick(0.1);
    for (const engine of [s.baseline, s.ours]) {
      const train = engine.snapshot().trains.find((t) => t.id === id);
      expect(train?.pos.track).toBe('D');
    }
    // The stub train drives on to the platform its timetable entry names, so it must be on
    // P7 or P8 once it has left D.
    const platforms = new Set<string>();
    for (let t = 0; t < 400; t += 1) {
      s.tick(1);
      const track = s.ours.snapshot().trains.find((x) => x.id === id)?.pos.track;
      if (track !== undefined && track !== 'D' && track !== 'EXIT') platforms.add(track);
    }
    expect(platforms.size).toBe(1);
    expect(pairOf('D')).toContain([...platforms][0]);
  });

  it('spawns on every entry track of the busy layout, each train with its own ID', () => {
    applyLayout('busy');
    const s = session();
    const n = DEFAULT_TIMETABLE.trains;
    expect([s.spawn('A'), s.spawn('B'), s.spawn('C')]).toEqual([n + 1, n + 2, n + 3]);
  });

  it('refuses to spawn on C on the junction layout, and adds no train', () => {
    const s = session();
    expect(() => s.spawn('C')).toThrow('cannot spawn a train on C: the junction layout only has entry tracks A, B');
    expect(() => s.spawn('D')).toThrow(/cannot spawn a train on D/);
    // The refused trains took no ID, so the next spawned train is still the first extra one.
    expect(s.spawn('A')).toBe(DEFAULT_TIMETABLE.trains + 1);
  });

  it('refuses to spawn on B on the branch layout', () => {
    applyLayout('branch');
    const s = session();
    expect(() => s.spawn('B')).toThrow('cannot spawn a train on B: the branch layout only has entry track A');
    expect(s.spawn('A')).toBe(DEFAULT_TIMETABLE.trains + 1);
  });

  it('refuses to spawn on D on the busy layout', () => {
    applyLayout('busy');
    expect(() => session().spawn('D')).toThrow(/cannot spawn a train on D: the busy layout/);
  });

  it('restarts on the same layout with the same trains', () => {
    applyLayout('hub');
    const s = session();
    s.tick(200);
    s.restart();
    s.tick(100);
    const fresh = session();
    fresh.tick(100);
    expect(JSON.stringify(s.ours.snapshot())).toBe(JSON.stringify(fresh.ours.snapshot()));
    expect(JSON.stringify(s.baseline.snapshot())).toBe(JSON.stringify(fresh.baseline.snapshot()));
  });

  // The engines, agents and keepers of a session all read the layout in use. If it changed under
  // a running session, restart would build a timetable for another layout and the keepers would
  // disagree with the trains about which platforms exist.
  it('refuses to step, spawn or restart once the layout in use is not the one it was built on', () => {
    applyLayout('hub');
    const s = session();
    s.tick(10);
    applyLayout('branch');
    const message = 'this session was built on the hub layout and the layout in use is now branch';
    expect(() => s.tick(1)).toThrow(message);
    expect(() => s.spawn('A')).toThrow(message);
    expect(() => s.restart()).toThrow(message);
    expect(s.ours.now).toBeCloseTo(10, 9);
    // Back on its own layout it carries on, and the refused calls changed nothing.
    applyLayout('hub');
    s.tick(1);
    expect(s.ours.now).toBeCloseTo(11, 9);
    expect(s.spawn('D')).toBe(DEFAULT_TIMETABLE.trains + 1);
  });

  it('still does nothing while paused, whatever the layout in use', () => {
    const s = session();
    s.paused = true;
    applyLayout('hub');
    expect(() => s.tick(1)).not.toThrow();
    expect(s.ours.now).toBe(0);
  });
});
