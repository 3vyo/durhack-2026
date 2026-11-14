import { SENSOR_RANGE, MAX_SPEED, TICK, TRAIN_LENGTH } from '../shared/constants';
import type {
  Position,
  TimetableEntry,
  TrackId,
  TrainAgent,
  TrainId,
  TrainOutput,
  TrainState,
} from '../shared/types';
import { xOf } from './map';
import { advanceTrain } from './physics';
import type { TrainProgram } from './ports';
import { ALL_ON, type Press, type Switches } from './switches';

export interface EngineConfig {
  timetable: TimetableEntry[];
  program: TrainProgram;
  seed: number;
  runLength: number;
  /** Scripted switch changes. Live presses are made with Engine.press. */
  presses: Press[];
}

export interface TrainView {
  id: TrainId;
  pos: Position;
  x: number;
  speed: number;
  mode: TrainOutput['mode'];
  reason?: string;
}

export interface Snapshot {
  now: number;
  switches: Switches;
  trains: TrainView[];
}

export interface RunResult {
  runLength: number;
  finished: boolean;
  exits: Map<TrainId, number>;
  collisions: number;
  closeCalls: number;
  overruns: number;
}

/** What the engine remembers about one train between ticks. */
interface Runtime {
  id: TrainId;
  agent: TrainAgent;
  state: TrainState;
  /** The track the train's rear is still on while its front is within TRAIN_LENGTH of a boundary. */
  prev: TrackId | null;
  nextTrack: TrackId | null;
  mode: TrainOutput['mode'];
  reason?: string;
}

/**
 * The optional display-only `reason` on a train's output. It is read as an unknown field so
 * the engine compiles before and after `reason` is added to the shared types (Task 2). The
 * engine never makes a decision from it.
 */
function displayReason(out: TrainOutput): string | undefined {
  const reason = (out as { reason?: unknown }).reason;
  return typeof reason === 'string' ? reason : undefined;
}

/** A new train waits until the first SENSOR_RANGE metres of its entry track are clear. */
const ENTRY_CLEAR = SENSOR_RANGE + TRAIN_LENGTH;

/**
 * The simulation. Deterministic and steppable: it never reads a clock or a random source,
 * so the same config always gives the same run. Time advances by TICK per step().
 */
export class Engine {
  private tick = 0;
  private readonly runTicks: number;
  private readonly pending: TimetableEntry[];
  private active: Runtime[] = [];
  private readonly exits = new Map<TrainId, number>();
  private overruns = 0;
  private readonly switches: Switches = { ...ALL_ON };
  private readonly scriptedPresses: Press[];

  constructor(private readonly cfg: EngineConfig) {
    this.runTicks = Math.ceil(cfg.runLength / TICK - 1e-9);
    this.pending = [...cfg.timetable].sort((a, b) => a.enterAt - b.enterAt || a.id - b.id);
    this.scriptedPresses = [...cfg.presses].sort((a, b) => a.at - b.at);
  }

  /** A live press: the switches change now and show in the next snapshot. */
  press(set: Partial<Switches>): void {
    Object.assign(this.switches, set);
  }

  get now(): number {
    return this.tick * TICK;
  }

  step(): void {
    if (this.tick >= this.runTicks) return;
    this.applyScriptedPresses();
    this.spawnDueTrains();

    // Every agent decides from the state at the start of the tick, then all move together,
    // so the result does not depend on the order trains are listed in.
    const outputs = this.active.map((rt) =>
      rt.agent.decide({ now: this.now, self: rt.state, inbox: [], sightAhead: null }),
    );

    const exitTime = (this.tick + 1) * TICK;
    const stillActive: Runtime[] = [];
    this.active.forEach((rt, i) => {
      const out = outputs[i];
      const moved = advanceTrain(rt.state, out.accel, out.nextTrack);
      if (moved.state.pos.track !== rt.state.pos.track) rt.prev = rt.state.pos.track;
      if (moved.overrun) this.overruns += 1;
      rt.state = moved.state;
      rt.nextTrack = out.nextTrack;
      rt.mode = out.mode;
      rt.reason = displayReason(out);
      if (moved.exited) this.exits.set(rt.id, exitTime);
      else stillActive.push(rt);
    });
    this.active = stillActive;
    this.tick += 1;
  }

  snapshot(): Snapshot {
    return {
      now: this.now,
      switches: { ...this.switches },
      trains: this.active.map((rt) => ({
        id: rt.id,
        pos: { ...rt.state.pos },
        x: xOf(rt.state.pos),
        speed: rt.state.speed,
        mode: rt.mode,
        ...(rt.reason !== undefined ? { reason: rt.reason } : {}),
      })),
    };
  }

  result(): RunResult {
    return {
      runLength: this.cfg.runLength,
      finished: this.exits.size === this.cfg.timetable.length,
      exits: new Map(this.exits),
      collisions: 0,
      closeCalls: 0,
      overruns: this.overruns,
    };
  }

  /** Applies scripted presses whose time has come, in time order. */
  private applyScriptedPresses(): void {
    while (this.scriptedPresses.length > 0 && this.scriptedPresses[0].at <= this.now + 1e-9) {
      Object.assign(this.switches, this.scriptedPresses.shift()!.set);
    }
  }

  /** Spawns due trains in timetable order, keeping each entry track first in, first out. */
  private spawnDueTrains(): void {
    const blocked = new Set<TrackId>();
    const stillPending: TimetableEntry[] = [];
    for (const entry of this.pending) {
      const due = entry.enterAt <= this.now + 1e-9;
      if (!due || blocked.has(entry.entry) || !this.entryClear(entry.entry)) {
        if (due) blocked.add(entry.entry);
        stillPending.push(entry);
        continue;
      }
      this.active.push({
        id: entry.id,
        agent: this.cfg.program.agentFactory(entry.id, this.cfg.timetable),
        state: { id: entry.id, pos: { track: entry.entry, offset: 0 }, speed: MAX_SPEED, brokenDown: false },
        prev: null,
        nextTrack: null,
        mode: 'blind',
      });
    }
    this.pending.length = 0;
    this.pending.push(...stillPending);
  }

  private entryClear(track: TrackId): boolean {
    return !this.active.some((rt) => rt.state.pos.track === track && rt.state.pos.offset < ENTRY_CLEAR);
  }
}
