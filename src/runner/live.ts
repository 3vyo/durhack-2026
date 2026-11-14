import { Engine } from '../engine/engine';
import type { TrainProgram } from '../engine/ports';
import type { Switches } from '../engine/switches';
import { generateTimetable, runLengthFor, type TimetableOptions } from '../engine/timetable';
import type { Scenario } from '../scenarios/scenarios';
import { TICK } from '../shared/constants';
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
}

/**
 * The live demo's driver. Two engines, the baseline and ours, run the same timetable on one
 * clock and are always stepped together, so the two scenes can never drift apart. A press
 * goes to both engines at the same simulated time.
 */
export class LiveSession {
  /** Simulated seconds per real second. */
  speed = 1;
  paused = false;

  private baselineEngine!: Engine;
  private oursEngine!: Engine;
  private carry = 0;

  constructor(private readonly options: LiveOptions) {
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

  /** Back to time 0 with the same seed. Live presses are forgotten. Speed and pause are kept. */
  restart(): void {
    this.carry = 0;
    this.build();
  }

  private build(): void {
    const { seed, scenario, programs, timetable: tt, scripted } = this.options;
    const timetable = generateTimetable(seed, tt);
    const presses = scripted ? pressesFor(scenario, timetable, seed) : [];
    const make = (program: TrainProgram): Engine =>
      new Engine({ timetable, program, seed, runLength: runLengthFor(timetable), presses });
    this.baselineEngine = make(programs.baseline);
    this.oursEngine = make(programs.ours);
  }
}
