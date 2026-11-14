// A tiny copy of the engine's physics, so a test can step one agent through many ticks
// without importing the engine. It follows the engine's rules: accel is clamped to
// [-BRAKE, ACCEL], speed += accel * TICK clamped to [0, MAX_SPEED], then
// offset += speed * TICK. At the end of a track the train moves onto nextTrack. With
// nextTrack null it is held at the end and an overrun is counted.

import { ACCEL, BRAKE, MAX_SPEED, SENSOR_RANGE, TICK } from '../../src/shared/constants';
import { TRACK_LENGTH, xOf } from '../../src/shared/map';
import type {
  Message,
  Outgoing,
  Position,
  TimetableEntry,
  TrainAgent,
  TrainOutput,
  TrainState,
} from '../../src/shared/types';

export interface Run {
  agent: TrainAgent;
  state: TrainState;
  now: number;
  overruns: number;
  topSpeed: number; // the highest speed seen so far
  sent: Outgoing[]; // every message the train has sent
  out: TrainOutput | null; // the last output
}

export const timetable: TimetableEntry[] = [
  { id: 1, entry: 'A', enterAt: 0, platform: 'P1', leader: null, dwell: 30 },
  { id: 2, entry: 'A', enterAt: 60, platform: 'P2', leader: 1, dwell: 30 },
  { id: 3, entry: 'B', enterAt: 0, platform: 'P3', leader: null, dwell: 30 },
  { id: 4, entry: 'B', enterAt: 60, platform: 'P4', leader: 3, dwell: 30 },
];

export function startRun(agent: TrainAgent, id: number, pos: Position, speed: number, now = 0): Run {
  const state: TrainState = { id, pos: { ...pos }, speed, brokenDown: false };
  return { agent, state, now, overruns: 0, topSpeed: speed, sent: [], out: null };
}

/** One tick: decide, then move. Returns the agent's output. */
export function tick(run: Run, inbox: Message[] = [], sightAhead: number | null = null): TrainOutput {
  const self: TrainState = { ...run.state, pos: { ...run.state.pos } };
  const out = run.agent.decide({ now: run.now, self, inbox, sightAhead });
  const accel = Math.min(ACCEL, Math.max(-BRAKE, out.accel));
  const s = run.state;
  s.speed = Math.min(MAX_SPEED, Math.max(0, s.speed + accel * TICK));
  s.pos.offset += s.speed * TICK;
  const length = TRACK_LENGTH[s.pos.track];
  if (s.pos.offset >= length && s.pos.track !== 'EXIT') {
    if (out.nextTrack) {
      s.pos = { track: out.nextTrack, offset: s.pos.offset - length };
    } else {
      s.pos.offset = length;
      run.overruns += 1;
    }
  }
  run.topSpeed = Math.max(run.topSpeed, s.speed);
  run.sent.push(...out.outbox);
  run.out = out;
  run.now += TICK;
  return out;
}

/** Steps `count` ticks with an empty inbox and nothing in sight. */
export function ticks(run: Run, count: number): void {
  for (let i = 0; i < count; i++) tick(run);
}

/** What sightAhead reads for an obstacle whose rear is at rearX, from the train's front. */
export function sightTo(run: Run, rearX: number): number | null {
  const d = rearX - xOf(run.state.pos);
  return d >= 0 && d <= SENSOR_RANGE ? d : null;
}

/** The lock requests the train has sent, as resource names. */
export function requests(run: Run): string[] {
  return run.sent.flatMap((o) => (o.msg.type === 'lockRequest' ? [o.msg.resource] : []));
}
