import type { ControlCentre } from '../../src/engine/ports';
import {
  ACCEL,
  BRAKE,
  MAX_SPEED,
  PERMIT_INTERVAL,
  SENSOR_RANGE,
  SIGHT_SPEED,
  TICK,
  TRAIN_LENGTH,
} from '../../src/shared/constants';
import {
  EXIT_CLEAR_LENGTH,
  JUNCTION_END_X,
  JUNCTION_START_X,
  PLATFORMS,
  TRACK_LENGTH,
  TRACK_START,
  entryOf,
  xOf,
} from '../../src/shared/map';
import type {
  Message,
  PlatformId,
  SensorReadings,
  TimetableEntry,
  TrackId,
  TrainAgent,
  TrainAgentFactory,
  TrainId,
  TrainState,
} from '../../src/shared/types';

// A tiny engine for the scenario tests. It follows the physics the real engine uses:
// accel clamped to [-BRAKE, ACCEL], speed clamped to [0, MAX_SPEED], then the train moves.
// The centre is stepped once a second while it is on, and a permit sent on tick t is in
// the train's inbox on tick t + 1. It imports nothing from src/engine/ but the port type.

/** The first this-many metres of an entry track must be clear before a train enters. */
const ENTRY_CLEAR = 400;

interface SimTrain {
  state: TrainState;
  agent: TrainAgent;
  entry: 'A' | 'B';
  platform: PlatformId | null;
  nextTrack: TrackId | null;
  inbox: Message[];
  /** The untilX of the newest permit delivered to this train, or null. */
  untilX: number | null;
}

export interface SimOptions {
  /** Says whether the centre is switched on at a time. Defaults to always on. */
  centreOn?: (now: number) => boolean;
  /** Says whether the platform sensors work at a time. A dead sensor reads occupied. */
  sensorsOn?: (now: number) => boolean;
  alive?: (now: number) => { station: boolean; merge: boolean };
}

export interface Sim {
  now: number;
  trains: SimTrain[];
  /** IDs of the trains that have left the right-hand end of EXIT, in order. */
  left: TrainId[];
  overruns: number;
  /** Ticks on which two trains overlapped on one track. Must stay 0. */
  overlaps: number;
  /** Ticks on which two trains were in the junction zone. Must stay 0. */
  junctionClashes: number;
  /** Ticks on which a train's front was past the untilX of its newest permit. Must stay 0. */
  pastPermit: number;
  /** Every permit the centre sent, newest last. */
  permits: Extract<Message, { type: 'permit' }>[];
  tick(): void;
  runUntil(time: number): void;
  train(id: TrainId): TrainState | undefined;
  breakDown(id: TrainId): void;
}

function rearX(state: TrainState): number {
  return xOf(state.pos) - TRAIN_LENGTH;
}

function isPlatform(track: TrackId): track is PlatformId {
  return (PLATFORMS as readonly TrackId[]).includes(track);
}

/** The tracks a train's body is on. */
function tracksUnder(train: SimTrain): TrackId[] {
  const { track } = train.state.pos;
  if (rearX(train.state) >= TRACK_START[track]) return [track];
  if (isPlatform(track)) return [track, entryOf(track)];
  return train.platform ? [track, train.platform] : [track];
}

/** The tracks ahead of a train, following the nextTrack it returned on the previous tick. */
function pathOf(train: SimTrain): TrackId[] {
  const { track } = train.state.pos;
  const path: TrackId[] = [track];
  if (train.nextTrack) path.push(train.nextTrack);
  return path;
}

function inZone(state: TrainState): boolean {
  return xOf(state.pos) >= JUNCTION_START_X && rearX(state) < JUNCTION_END_X;
}

export function makeSim(
  timetable: TimetableEntry[],
  centre: ControlCentre,
  factory: TrainAgentFactory,
  options: SimOptions = {},
): Sim {
  const waiting = [...timetable].sort((a, b) => a.enterAt - b.enterAt);
  let tickCount = 0;
  let pending: Message[] = [];

  function sensors(): SensorReadings {
    const dead = options.sensorsOn ? !options.sensorsOn(sim.now) : false;
    const on = (track: TrackId) => sim.trains.some((t) => tracksUnder(t).includes(track));
    const platformOccupied = { P1: dead || on('P1'), P2: dead || on('P2'), P3: dead || on('P3'), P4: dead || on('P4') };
    const exitClearEnd = TRACK_START.EXIT + EXIT_CLEAR_LENGTH;
    const exitStartClear = !sim.trains.some(
      (t) => xOf(t.state.pos) >= TRACK_START.EXIT && rearX(t.state) < exitClearEnd,
    );
    return { platformOccupied, junctionOccupied: sim.trains.some((t) => inZone(t.state)), exitStartClear };
  }

  function sightAhead(train: SimTrain): number | null {
    const x = xOf(train.state.pos);
    const path = pathOf(train);
    let nearest: number | null = null;
    const see = (distance: number) => {
      if (distance <= SENSOR_RANGE && (nearest === null || distance < nearest)) nearest = distance;
    };
    for (const other of sim.trains) {
      if (other === train || xOf(other.state.pos) <= x) continue;
      if (tracksUnder(other).some((track) => path.includes(track))) see(rearX(other.state) - x);
      const zoneOnPath = isPlatform(train.state.pos.track) || path.some(isPlatform);
      if (inZone(other.state) && zoneOnPath && x < JUNCTION_START_X) see(JUNCTION_START_X - x);
    }
    return nearest;
  }

  function enterTrains(): void {
    while (waiting.length > 0 && waiting[0].enterAt <= sim.now + TICK / 2) {
      const entry = waiting[0];
      const blocked = sim.trains.some(
        (t) => tracksUnder(t).includes(entry.entry) && rearX(t.state) < ENTRY_CLEAR,
      );
      if (blocked) return;
      waiting.shift();
      sim.trains.push({
        state: { id: entry.id, pos: { track: entry.entry, offset: 0 }, speed: SIGHT_SPEED, brokenDown: false },
        agent: factory(entry.id, timetable),
        entry: entry.entry,
        platform: null,
        nextTrack: null,
        inbox: [],
        untilX: null,
      });
    }
  }

  function move(train: SimTrain, accel: number): void {
    const state = train.state;
    const clamped = Math.max(-BRAKE, Math.min(ACCEL, accel));
    state.speed = state.brokenDown ? 0 : Math.max(0, Math.min(MAX_SPEED, state.speed + clamped * TICK));
    let offset = state.pos.offset + state.speed * TICK;
    let track = state.pos.track;
    const length = TRACK_LENGTH[track];
    if (offset >= length && track !== 'EXIT') {
      if (train.nextTrack) {
        offset -= length;
        track = train.nextTrack;
        if (isPlatform(track)) train.platform = track;
      } else {
        offset = length;
        state.speed = 0;
        sim.overruns += 1;
      }
    }
    state.pos = { track, offset };
  }

  function check(): void {
    const zone = sim.trains.filter((t) => inZone(t.state)).length;
    if (zone > 1) sim.junctionClashes += 1;
    for (const t of sim.trains) {
      if (t.untilX !== null && !t.state.brokenDown && xOf(t.state.pos) > t.untilX) sim.pastPermit += 1;
    }
    for (const a of sim.trains) {
      for (const b of sim.trains) {
        if (a.state.id >= b.state.id) continue;
        const shared = tracksUnder(a).some((track) => tracksUnder(b).includes(track));
        const apart = rearX(a.state) >= xOf(b.state.pos) || rearX(b.state) >= xOf(a.state.pos);
        if (shared && !apart) sim.overlaps += 1;
      }
    }
  }

  const sim: Sim = {
    now: 0,
    trains: [],
    left: [],
    overruns: 0,
    overlaps: 0,
    junctionClashes: 0,
    pastPermit: 0,
    permits: [],
    tick() {
      enterTrains();
      for (const train of sim.trains) {
        train.inbox = pending.filter((msg) => msg.type === 'permit' && msg.to === train.state.id);
        for (const msg of train.inbox) if (msg.type === 'permit') train.untilX = msg.untilX;
      }
      pending = [];
      const sights = sim.trains.map(sightAhead);
      sim.trains.forEach((train, i) => {
        const out = train.agent.decide({
          now: sim.now,
          self: { ...train.state, pos: { ...train.state.pos } },
          inbox: train.inbox,
          sightAhead: sights[i],
        });
        train.nextTrack = out.nextTrack;
        move(train, out.accel);
      });
      const gone = sim.trains.filter((t) => t.state.pos.track === 'EXIT' && t.state.pos.offset >= TRACK_LENGTH.EXIT);
      sim.left.push(...gone.map((t) => t.state.id));
      sim.trains = sim.trains.filter((t) => !gone.includes(t));
      check();
      const centreOn = options.centreOn ? options.centreOn(sim.now) : true;
      if (centreOn && tickCount % Math.round(PERMIT_INTERVAL / TICK) === 0) {
        const alive = options.alive ? options.alive(sim.now) : { station: true, merge: true };
        const states = sim.trains.map((t) => ({ ...t.state, pos: { ...t.state.pos } }));
        pending = centre.step(sim.now, states, sensors(), alive);
        for (const msg of pending) if (msg.type === 'permit') sim.permits.push(msg);
      }
      tickCount += 1;
      sim.now += TICK;
    },
    runUntil(time) {
      while (sim.now < time - TICK / 2) sim.tick();
    },
    train(id) {
      return sim.trains.find((t) => t.state.id === id)?.state;
    },
    breakDown(id) {
      const state = sim.train(id);
      if (state) {
        state.brokenDown = true;
        state.speed = 0;
      }
    },
  };
  return sim;
}
