import { Engine } from '../engine/engine';
import type { TrainProgram } from '../engine/ports';
import type { Switches } from '../engine/switches';
import { RUN_LENGTH, generateTimetable, spawnEntry, type TimetableOptions } from '../engine/timetable';
import type { Scenario } from '../scenarios/scenarios';
import { TICK } from '../shared/constants';
import { CROSS_LINES, ENTRIES, LAYOUT, applyCrossLines } from '../shared/map';
import type { LayoutId } from '../shared/map';
import type { EntryId, TimetableEntry, TrainId } from '../shared/types';
import { pressesFor } from './failure';

export interface LiveOptions {
  seed: number;
  scenario: Scenario;
  programs: { baseline: TrainProgram; ours: TrainProgram };
  timetable: TimetableOptions;
  /**
   * If true, the scenario's own presses fire at their times, as in a batch run. If false (the
   * default), they are ignored and only live presses count, so the presenter is in charge.
   */
  scripted?: boolean;
  /**
   * True switches the cross links on for this session ("Cross links" in docs/design.md).
   * Left out, they are off.
   */
  crossLines?: boolean;
}

/**
 * The live demo's driver. Two engines, the baseline and ours, run the same timetable on one
 * clock and are always stepped together, so the two scenes can never drift apart. A press
 * goes to both engines at the same simulated time.
 *
 * A session runs on the layout that is in use when it is built (src/shared/map.ts). Pick the
 * layout first, and build a new session to change it. Its engines, agents and keepers all read
 * the layout in use, so a session refuses to step, spawn or restart on any other layout.
 *
 * The cross links switch is fixed for a session in the same way, but the session takes it
 * from its options, not from the switch in use. Building a session sets the switch to what
 * its options say, off if they do not say. After that the session refuses to step, spawn or
 * restart while the switch in use is anything else. Build a new session to change it.
 */
export class LiveSession {
  /** Simulated seconds per real second. */
  speed = 1;
  paused = false;

  private baselineEngine!: Engine;
  private oursEngine!: Engine;
  /** The one timetable both engines run. Spawned trains are added to it. */
  private timetable: TimetableEntry[] = [];
  private carry = 0;
  /** The layout in use when this session was built. */
  private readonly layout: LayoutId = LAYOUT.id;
  /** Whether this session runs with the cross links on. */
  private readonly crossLines: boolean;

  constructor(private readonly options: LiveOptions) {
    this.crossLines = options.crossLines ?? false;
    applyCrossLines(this.crossLines);
    this.build();
  }

  get baseline(): Engine {
    return this.baselineEngine;
  }

  get ours(): Engine {
    return this.oursEngine;
  }

  /**
   * Advances both engines for `realSeconds` of real time. Only whole steps are taken, and the
   * remainder carries to the next call, so two short calls add up to the same as one long one.
   */
  tick(realSeconds: number): void {
    if (this.paused) return;
    this.checkLayout('step');
    this.carry += realSeconds * this.speed;
    const steps = Math.floor(this.carry / TICK + 1e-9);
    this.carry -= steps * TICK;
    for (let i = 0; i < steps; i++) {
      this.baselineEngine.step();
      this.oursEngine.step();
    }
  }

  /** A live press, applied to both engines at the same simulated time, paused or not. */
  press(set: Partial<Switches>): void {
    this.baselineEngine.press(set);
    this.oursEngine.press(set);
  }

  /**
   * Adds a train at the start of `track` in both engines at the same simulated time, due now,
   * with the timetable's dwell. It enters once the start of the track is clear, behind any
   * train already waiting there. Returns its ID. A restart forgets it, like a live press.
   * Throws if the layout in use has no such entry track, before either engine is touched.
   */
  spawn(track: EntryId): TrainId {
    this.checkLayout('spawn a train');
    if (!ENTRIES.includes(track)) {
      throw new Error(
        `cannot spawn a train on ${track}: the ${LAYOUT.id} layout only has entry track${ENTRIES.length === 1 ? '' : 's'} ${ENTRIES.join(', ')}`,
      );
    }
    const entry = spawnEntry(this.timetable, track, this.oursEngine.now, this.options.timetable.dwell);
    this.baselineEngine.addTrain(entry);
    this.oursEngine.addTrain(entry);
    return entry.id;
  }

  /** Back to time 0 with the same seed. Live presses and spawned trains are forgotten. Speed and pause are kept. */
  restart(): void {
    this.checkLayout('restart');
    this.carry = 0;
    this.build();
  }

  /**
   * Throws if the layout in use is no longer the one this session was built on, or if the
   * cross links switch is no longer as this session set it.
   */
  private checkLayout(doing: string): void {
    if (LAYOUT.id !== this.layout) {
      throw new Error(
        `cannot ${doing}: this session was built on the ${this.layout} layout and the layout in use is now ${LAYOUT.id}. Build a new session`,
      );
    }
    if (CROSS_LINES !== this.crossLines) {
      const onOff = (on: boolean) => (on ? 'on' : 'off');
      throw new Error(
        `cannot ${doing}: this session was built with the cross links ${onOff(this.crossLines)} and they are now ${onOff(CROSS_LINES)}. Build a new session`,
      );
    }
  }

  private build(): void {
    const { seed, scenario, programs, timetable: tt, scripted } = this.options;
    const timetable = generateTimetable(seed, tt);
    this.timetable = timetable;
    const presses = scripted ? pressesFor(scenario, timetable, seed) : [];
    const make = (program: TrainProgram): Engine =>
      new Engine({ timetable, program, seed, runLength: RUN_LENGTH, presses });
    this.baselineEngine = make(programs.baseline);
    this.oursEngine = make(programs.ours);
  }
}
