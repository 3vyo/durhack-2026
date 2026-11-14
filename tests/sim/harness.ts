// A small simulation used only by the tests in this folder. It runs a whole TrainProgram
// (train agents, local actors and the control centre) on the map from docs/design.md and
// counts collisions, overruns and exits. It is not the demo engine in src/engine/. It
// exists so the three rule folders can be checked against each other before that lands.
//
// Rules it follows, all from docs/design.md and the engine notes on issue #26:
// - One tick is TICK seconds. A message sent on tick t is in the inbox on tick t + 1.
// - Speed changes first, then position. A train with no valid nextTrack is held at the
//   end of its track, and that counts as an overrun if it was still moving.
// - A train is TRAIN_LENGTH long and its position is its front, so its rear can still be
//   on the track it came from.
// - sightAhead is the distance from the front to the rear of the nearest obstacle on the
//   path, where the path follows the nextTrack the train returned on the previous tick.
// - Trains enter at SIGHT_SPEED once the first entryClear() metres of their track are clear.
// - Sim.fromParams builds a run from a parameter file (src/shared/params.ts).

import type { ControlCentre, TrainProgram } from '../../src/engine/ports';
import { applyParams } from '../../src/shared/params';
import type { SimParams } from '../../src/shared/params';
import {
  ACCEL,
  BRAKE,
  MARGIN,
  MAX_SPEED,
  PERMIT_INTERVAL,
  POSITION_INTERVAL,
  SENSOR_RANGE,
  SIGHT_SPEED,
  TICK,
  TRAIN_LENGTH,
} from '../../src/shared/constants';
import {
  EXIT_CLEAR_LENGTH,
  JUNCTION_EXIT_LENGTH,
  JUNCTION_PLATFORM_LENGTH,
  PLATFORM_PAIRS,
  PLATFORMS,
  RANGE,
  TRACK_LENGTH,
  inRange,
  successors,
  xOf,
} from '../../src/shared/map';
import type {
  LocalActor,
  Message,
  Outgoing,
  PlatformId,
  SensorReadings,
  TimetableEntry,
  TrackId,
  TrainAgent,
  TrainId,
  TrainOutput,
  TrainState,
} from '../../src/shared/types';

/**
 * How much of an entry track must be clear before a train enters: far enough that the new
 * train sees nothing ahead of it. 400 m with the design's values.
 */
export function entryClear(): number {
  return SENSOR_RANGE + TRAIN_LENGTH;
}

export interface Switches {
  centre: boolean;
  station: boolean;
  merge: boolean;
  sensors: boolean;
  radioDrop: number; // share of train-to-train messages lost, 0 to 1
}

export const ALL_ON: Switches = { centre: true, station: true, merge: true, sensors: true, radioDrop: 0 };

export interface Press {
  at: number;
  set?: Partial<Switches>;
  breakDown?: TrainId;
}

export interface SimOptions {
  program: TrainProgram;
  timetable: TimetableEntry[];
  seed?: number;
  presses?: Press[];
  start?: Partial<Switches>;
}

interface Segment {
  track: TrackId;
  from: number;
  to: number;
}

interface Running {
  state: TrainState;
  agent: TrainAgent;
  prevTrack: TrackId | null;
  nextTrack: TrackId | null; // what the agent returned on the previous tick
  mode: TrainOutput['mode'];
  inbox: Message[];
}

export interface Incident {
  at: number;
  kind: 'collision' | 'overrun' | 'close-call';
  trains: TrainId[];
  detail: string;
}

/** A seeded random number generator (mulberry32), values in [0, 1). */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Trains alternate between A and B. Each gap is headway to 2 * headway seconds. */
export function makeTimetable(seed: number, trains: number, headway = 45, dwell = 30): TimetableEntry[] {
  const rng = makeRng(seed);
  const out: TimetableEntry[] = [];
  const last: Record<'A' | 'B', TrainId | null> = { A: null, B: null };
  const count: Record<'A' | 'B', number> = { A: 0, B: 0 };
  let at = 0;
  for (let id = 1; id <= trains; id++) {
    const entry = id % 2 === 1 ? 'A' : 'B';
    const platform = PLATFORM_PAIRS[entry][count[entry] % 2] as PlatformId;
    out.push({ id, entry, enterAt: at, platform, leader: last[entry], dwell });
    last[entry] = id;
    count[entry]++;
    at += headway + rng() * headway;
  }
  return out;
}

export class Sim {
  tick = 0;
  switches: Switches;
  readonly exits = new Map<TrainId, number>();
  readonly entered = new Map<TrainId, number>();
  readonly incidents: Incident[] = [];
  readonly trains: Running[] = [];
  maxSpeedSeen = new Map<TrainId, number>();

  private readonly program: TrainProgram;
  private readonly timetable: TimetableEntry[];
  private readonly actors: LocalActor[];
  private readonly centre: ControlCentre | null;
  private readonly rng: () => number;
  private readonly presses: Press[];
  private waiting: TimetableEntry[];
  private actorInbox: Record<'station' | 'merge', Message[]> = { station: [], merge: [] };
  private pendingActor: Record<'station' | 'merge', Message[]> = { station: [], merge: [] };
  private pendingTrain = new Map<TrainId, Message[]>();
  private active = new Set<string>();
  private brokenIds = new Set<TrainId>();
  private heldAtEnd = new Set<TrainId>(); // trains already counted as an overrun where they stand

  constructor(o: SimOptions) {
    this.program = o.program;
    this.timetable = o.timetable;
    this.actors = o.program.makeActors(o.timetable);
    this.centre = o.program.makeCentre(o.timetable);
    this.rng = makeRng(o.seed ?? 1);
    this.presses = [...(o.presses ?? [])].sort((a, b) => a.at - b.at);
    this.waiting = [...o.timetable].sort((a, b) => a.enterAt - b.enterAt);
    this.switches = { ...ALL_ON, ...(o.start ?? {}) };
  }

  /**
   * Build a run from a parameter file. This also makes the file's physics and timer values
   * the ones every rule reads, so call resetParams() afterwards if later code needs the
   * design values back.
   */
  static fromParams(program: TrainProgram, params: SimParams): Sim {
    applyParams(params);
    const { seed, trains, headway, dwell } = params.timetable;
    const presses: Press[] = params.failures.map(({ at, breakDown, ...set }) => ({
      at,
      ...(Object.keys(set).length > 0 ? { set } : {}),
      ...(breakDown === undefined ? {} : { breakDown }),
    }));
    return new Sim({ program, timetable: makeTimetable(seed, trains, headway, dwell), seed, presses, start: params.start });
  }

  get now(): number {
    return this.tick * TICK;
  }

  get collisions(): number {
    return this.incidents.filter((i) => i.kind === 'collision').length;
  }

  get overruns(): number {
    return this.incidents.filter((i) => i.kind === 'overrun').length;
  }

  get closeCalls(): number {
    return this.incidents.filter((i) => i.kind === 'close-call').length;
  }

  get allExited(): boolean {
    return this.exits.size === this.timetable.length;
  }

  /** Run until every train has left or `until` seconds have passed. */
  run(until: number): this {
    while (this.now < until && !this.allExited) this.step();
    return this;
  }

  press(set: Partial<Switches>): void {
    this.switches = { ...this.switches, ...set };
  }

  breakDown(id: TrainId): void {
    this.brokenIds.add(id);
  }

  step(): void {
    const now = this.now;
    while (this.presses.length > 0 && this.presses[0]!.at <= now + TICK / 2) {
      const p = this.presses.shift()!;
      if (p.set) this.press(p.set);
      if (p.breakDown !== undefined) this.breakDown(p.breakDown);
    }
    this.spawn(now);
    this.deliver();

    const sensors = this.readSensors();
    const everySecond = (interval: number) => this.tick % Math.round(interval / TICK) === 0;

    for (const actor of this.actors) {
      const inbox = this.actorInbox[actor.id];
      this.actorInbox[actor.id] = [];
      if (!this.switches[actor.id]) continue;
      for (const out of actor.step(now, inbox, sensors)) this.send(out, { kind: 'actor', id: actor.id });
    }

    if (this.centre && this.switches.centre && everySecond(PERMIT_INTERVAL)) {
      const states = this.trains.map((t) => copy(t.state));
      const alive = { station: this.switches.station, merge: this.switches.merge };
      for (const msg of this.centre.step(now, states, sensors, alive)) {
        this.send({ msg, range: 'long' }, { kind: 'centre' });
      }
    }

    if (this.switches.sensors && everySecond(POSITION_INTERVAL)) {
      for (const platform of PLATFORMS) {
        const msg: Message = { type: 'platformStatus', platform, occupied: sensors.platformOccupied[platform], sentAt: now };
        this.send({ msg, range: 'short' }, { kind: 'sensors' });
      }
    }

    // Every train decides on the same picture of the world, then they all move.
    const decisions = this.trains.map((t) => {
      const inbox = t.inbox;
      t.inbox = [];
      const output = t.agent.decide({ now, self: copy(t.state), inbox, sightAhead: this.sightAhead(t) });
      return { t, output };
    });
    for (const { t, output } of decisions) {
      for (const out of output.outbox) this.send(out, { kind: 'train', id: t.state.id, x: xOf(t.state.pos) });
      t.mode = output.mode;
      this.move(t, output, now);
      t.nextTrack = output.nextTrack;
    }

    this.checkSafety(now);
    for (let i = this.trains.length - 1; i >= 0; i--) {
      const t = this.trains[i]!;
      if (t.state.pos.track === 'EXIT' && t.state.pos.offset >= TRACK_LENGTH.EXIT) {
        this.exits.set(t.state.id, now);
        this.trains.splice(i, 1);
      }
    }
    this.tick++;
  }

  // --- trains ---------------------------------------------------------------------

  private spawn(now: number): void {
    const stillWaiting: TimetableEntry[] = [];
    for (const entry of this.waiting) {
      const due = entry.enterAt <= now + TICK / 2;
      const clear = !this.trains.some((t) => segments(t).some((s) => s.track === entry.entry && s.from < entryClear()));
      // Trains enter in timetable order on each track, so a held train holds the ones behind it.
      const queued = stillWaiting.some((w) => w.entry === entry.entry);
      if (due && clear && !queued) {
        const state: TrainState = { id: entry.id, pos: { track: entry.entry, offset: 0 }, speed: SIGHT_SPEED, brokenDown: false };
        this.trains.push({
          state,
          agent: this.program.agentFactory(entry.id, this.timetable),
          prevTrack: null,
          nextTrack: null,
          mode: 'blind',
          inbox: [],
        });
        this.entered.set(entry.id, now);
      } else {
        stillWaiting.push(entry);
      }
    }
    this.waiting = stillWaiting;
  }

  private move(t: Running, output: TrainOutput, now: number): void {
    const s = t.state;
    if (this.brokenIds.has(s.id)) {
      s.brokenDown = true;
      s.speed = 0;
      return;
    }
    const accel = Math.max(-BRAKE, Math.min(ACCEL, Number.isFinite(output.accel) ? output.accel : -BRAKE));
    s.speed = Math.max(0, Math.min(MAX_SPEED, s.speed + accel * TICK));
    s.pos.offset += s.speed * TICK;
    this.maxSpeedSeen.set(s.id, Math.max(this.maxSpeedSeen.get(s.id) ?? 0, s.speed));
    const length = TRACK_LENGTH[s.pos.track];
    if (s.pos.offset < length || s.pos.track === 'EXIT') {
      this.heldAtEnd.delete(s.id);
      return;
    }
    const next = output.nextTrack;
    if (next !== null && successors(s.pos.track).includes(next)) {
      this.heldAtEnd.delete(s.id);
      t.prevTrack = s.pos.track;
      s.pos = { track: next, offset: s.pos.offset - length };
      return;
    }
    // One overrun per stop: a train that keeps pushing against the end is not counted again.
    if (s.speed > 0.01 && !this.heldAtEnd.has(s.id)) {
      this.heldAtEnd.add(s.id);
      this.incidents.push({ at: now, kind: 'overrun', trains: [s.id], detail: `held at the end of ${s.pos.track} at ${s.speed.toFixed(2)} m/s with nextTrack ${String(next)}` });
    }
    s.pos.offset = length;
    s.speed = 0;
  }

  // --- sensing --------------------------------------------------------------------

  private zoneOccupiedBy(t: Running): boolean {
    return segments(t).some(
      (s) =>
        (s.track === 'EXIT' && s.from < JUNCTION_EXIT_LENGTH) ||
        (s.track !== 'EXIT' && s.track !== 'A' && s.track !== 'B' && s.to >= TRACK_LENGTH[s.track] - JUNCTION_PLATFORM_LENGTH),
    );
  }

  private sightAhead(self: Running): number | null {
    const path: Array<{ track: TrackId; startDistance: number; from: number }> = [];
    const front = self.state.pos;
    path.push({ track: front.track, startDistance: -front.offset, from: front.offset });
    if (self.nextTrack !== null && successors(front.track).includes(self.nextTrack)) {
      path.push({ track: self.nextTrack, startDistance: TRACK_LENGTH[front.track] - front.offset, from: 0 });
    }
    let best: number | null = null;
    const consider = (d: number) => {
      if (d <= SENSOR_RANGE && (best === null || d < best)) best = Math.max(0, d);
    };
    for (const other of this.trains) {
      if (other === self) continue;
      for (const seg of segments(other)) {
        for (const p of path) {
          if (seg.track !== p.track || seg.to <= p.from) continue;
          consider(p.startDistance + Math.max(seg.from, p.from));
        }
      }
    }
    // A train in the junction zone shows up as an obstacle at the edge of the zone.
    if (!this.zoneOccupiedBy(self) && this.trains.some((o) => o !== self && this.zoneOccupiedBy(o))) {
      for (const p of path) {
        if (p.track === 'A' || p.track === 'B') continue;
        const edge = p.track === 'EXIT' ? 0 : TRACK_LENGTH[p.track] - JUNCTION_PLATFORM_LENGTH;
        if (edge >= p.from) consider(p.startDistance + edge);
      }
    }
    return best;
  }

  private readSensors(): SensorReadings {
    const platformOccupied = {} as Record<PlatformId, boolean>;
    for (const p of PLATFORMS) {
      platformOccupied[p] = !this.switches.sensors || this.trains.some((t) => segments(t).some((s) => s.track === p));
    }
    return {
      platformOccupied,
      junctionOccupied: this.trains.some((t) => this.zoneOccupiedBy(t)),
      exitStartClear: !this.trains.some((t) => segments(t).some((s) => s.track === 'EXIT' && s.from < EXIT_CLEAR_LENGTH)),
    };
  }

  // --- radio ----------------------------------------------------------------------

  private send(
    out: Outgoing,
    from: { kind: 'train'; id: TrainId; x: number } | { kind: 'actor'; id: 'station' | 'merge' } | { kind: 'sensors' } | { kind: 'centre' },
  ): void {
    const msg = out.msg;
    const toTrain = (id: TrainId) => {
      const list = this.pendingTrain.get(id) ?? [];
      list.push(msg);
      this.pendingTrain.set(id, list);
    };
    const xOfTrain = (id: TrainId) => {
      const t = this.trains.find((r) => r.state.id === id);
      return t ? xOf(t.state.pos) : null;
    };
    switch (msg.type) {
      case 'position':
        for (const t of this.trains) {
          if (from.kind === 'train' && t.state.id === from.id) continue;
          if (this.rng() >= this.switches.radioDrop) toTrain(t.state.id);
        }
        return;
      case 'lockRequest': {
        if (from.kind !== 'train') return;
        const actor = msg.resource === 'JUNCTION' ? 'merge' : 'station';
        if (this.switches[actor] && inRange(from.x, RANGE[actor])) this.pendingActor[actor].push(msg);
        return;
      }
      case 'lockGrant':
      case 'lockRefuse': {
        if (from.kind !== 'actor') return;
        const x = xOfTrain(msg.to);
        if (x !== null && inRange(x, RANGE[from.id])) toTrain(msg.to);
        return;
      }
      case 'platformStatus':
        for (const t of this.trains) if (inRange(xOf(t.state.pos), RANGE.sensors)) toTrain(t.state.id);
        return;
      case 'permit':
        if (from.kind === 'centre' && xOfTrain(msg.to) !== null) toTrain(msg.to);
        return;
    }
  }

  private deliver(): void {
    for (const t of this.trains) t.inbox = this.pendingTrain.get(t.state.id) ?? [];
    this.pendingTrain = new Map();
    this.actorInbox = this.pendingActor;
    this.pendingActor = { station: [], merge: [] };
  }

  // --- safety ---------------------------------------------------------------------

  private checkSafety(now: number): void {
    const seen = new Set<string>();
    const note = (kind: 'collision' | 'close-call', a: Running, b: Running, detail: string) => {
      const key = `${kind}:${Math.min(a.state.id, b.state.id)}-${Math.max(a.state.id, b.state.id)}`;
      seen.add(key);
      if (this.active.has(key)) return;
      this.incidents.push({ at: now, kind, trains: [a.state.id, b.state.id], detail });
    };
    for (let i = 0; i < this.trains.length; i++) {
      for (let j = i + 1; j < this.trains.length; j++) {
        const a = this.trains[i]!;
        const b = this.trains[j]!;
        let gap = Infinity;
        let overlap = false;
        for (const sa of segments(a)) {
          for (const sb of segments(b)) {
            if (sa.track !== sb.track) continue;
            if (sa.from < sb.to && sb.from < sa.to) overlap = true;
            gap = Math.min(gap, Math.max(sa.from - sb.to, sb.from - sa.to));
          }
        }
        const where = `${describe(a)} and ${describe(b)}`;
        if (overlap) note('collision', a, b, `overlap: ${where}`);
        else if (this.zoneOccupiedBy(a) && this.zoneOccupiedBy(b)) note('collision', a, b, `both in the junction zone: ${where}`);
        else if (gap < MARGIN) note('close-call', a, b, `gap ${gap.toFixed(1)} m: ${where}`);
      }
    }
    this.active = seen;
  }
}

function copy(s: TrainState): TrainState {
  return { ...s, pos: { ...s.pos } };
}

/** The stretches of track a train covers. Its rear can still be on the track it came from. */
function segments(t: Running): Segment[] {
  const { track, offset } = t.state.pos;
  const out: Segment[] = [{ track, from: Math.max(0, offset - TRAIN_LENGTH), to: offset }];
  if (offset < TRAIN_LENGTH && t.prevTrack !== null) {
    const length = TRACK_LENGTH[t.prevTrack];
    out.push({ track: t.prevTrack, from: length - (TRAIN_LENGTH - offset), to: length });
  }
  return out;
}

function describe(t: Running): string {
  const s = t.state;
  return `train ${s.id} on ${s.pos.track} at ${s.pos.offset.toFixed(1)} m, ${s.speed.toFixed(1)} m/s, ${t.mode}`;
}
