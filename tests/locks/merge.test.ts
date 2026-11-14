import { describe, expect, it } from 'vitest';
import {
  MERGE_SILENCE,
  canGrantJunction,
  canReleaseJunction,
  createMergeActor,
  dropSilentRequests,
  followFor,
  grantedBeforeResume,
  initialMergeMemory,
  nextForJunction,
  observeJunction,
  observeZone,
  queuedToAnswer,
  recordJunctionRequests,
  resumeMerge,
  stepMerge,
  type JunctionHolder,
  type JunctionRequest,
  type MergeMemory,
} from '../../src/locks/merge';
import { MERGE_TIMEOUT, REQUEST_REPEAT, RESUME_SETTLE, TICK } from '../../src/shared/constants';
import type { LocalActor, Message, Outgoing, SensorReadings, TrainId } from '../../src/shared/types';

const clear: SensorReadings = {
  platformOccupied: { P1: false, P2: false, P3: false, P4: false },
  junctionOccupied: false,
  exitStartClear: true,
};
/** A train is in the junction zone. Its front may be on EXIT, so the start of EXIT is not clear. */
const inZone: SensorReadings = { ...clear, junctionOccupied: true, exitStartClear: false };
/** A train has left the zone but is still in the first 300 m of EXIT. */
const justPast: SensorReadings = { ...clear, junctionOccupied: false, exitStartClear: false };

const ask = (from: TrainId): Message => ({ type: 'lockRequest', from, resource: 'JUNCTION' });

const grant = (to: TrainId, follow: TrainId | null): Outgoing => ({
  msg: { type: 'lockGrant', to, resource: 'JUNCTION', follow },
  range: 'short',
});

const refuse = (to: TrainId): Outgoing => ({
  msg: { type: 'lockRefuse', to, resource: 'JUNCTION', alternative: null },
  range: 'short',
});

const queue: JunctionRequest[] = [
  { train: 3, firstHeardAt: 5, lastHeardAt: 9 },
  { train: 1, firstHeardAt: 7, lastHeardAt: 9 },
];

const holder: JunctionHolder = { train: 3, follow: null, grantedAt: 10, seenEnter: true };
const waiting: JunctionHolder = { ...holder, seenEnter: false };

const release = {
  resumedAt: null,
  zoneOccupiedSinceResume: false,
  settle: RESUME_SETTLE,
  unused: MERGE_TIMEOUT,
};

/**
 * Steps an actor tick by tick. Time is built by adding TICK, as the engine builds it.
 * `off` moves time on without stepping, as when the actor is switched off.
 */
function drive(actor: LocalActor) {
  let now = 0;
  return {
    get now() {
      return now;
    },
    step(inbox: Message[] = [], readings: SensorReadings = clear): Outgoing[] {
      const out = actor.step(now, inbox, readings);
      now += TICK;
      return out;
    },
    /** Steps with an empty inbox for this many seconds. Returns everything sent. */
    idle(seconds: number, readings: SensorReadings = clear): Outgoing[] {
      const out: Outgoing[] = [];
      for (let i = 0; i < Math.round(seconds / TICK); i++) out.push(...this.step([], readings));
      return out;
    },
    /** Steps for this many seconds while these trains ask every REQUEST_REPEAT. */
    repeat(seconds: number, trains: TrainId[], readings: SensorReadings = clear): Outgoing[] {
      const out: Outgoing[] = [];
      const every = Math.round(REQUEST_REPEAT / TICK);
      for (let i = 0; i < Math.round(seconds / TICK); i++) {
        out.push(...this.step(i % every === 0 ? trains.map(ask) : [], readings));
      }
      return out;
    },
    /** A granted train runs through: it is in the zone, then just past it. */
    passThrough(): void {
      this.idle(8, inZone);
      this.idle(4, justPast);
    },
    off(seconds: number): void {
      for (let i = 0; i < Math.round(seconds / TICK); i++) now += TICK;
    },
  };
}

const newMerge = () => drive(createMergeActor());

/** Runs stepMerge over a list of ticks, starting from time 0 with a fresh memory. */
function run(steps: Array<{ inbox?: Message[]; sensors?: SensorReadings }>, from = initialMergeMemory()) {
  let memory = from;
  let now = memory.lastStepAt === null ? 0 : memory.lastStepAt + TICK;
  const sent: Outgoing[][] = [];
  for (const s of steps) {
    const result = stepMerge(memory, now, s.inbox ?? [], s.sensors ?? clear);
    memory = result.memory;
    sent.push(result.out);
    now += TICK;
  }
  return { memory, sent };
}

describe('merge frame', () => {
  it('has id merge', () => {
    expect(createMergeActor().id).toBe('merge');
  });

  it('starts with no holder, an empty queue, nobody let into EXIT and no resume', () => {
    expect(initialMergeMemory()).toEqual({
      holder: null,
      queue: [],
      lastIntoExit: null,
      leaderUnknown: false,
      lastStepAt: null,
      resumedAt: null,
      zoneOccupiedSinceResume: false,
    });
  });

  it('drops a silent request before the settle window ends, and not before a late repeat', () => {
    expect(MERGE_SILENCE).toBeLessThan(RESUME_SETTLE);
    expect(MERGE_SILENCE).toBeGreaterThan(REQUEST_REPEAT + TICK);
  });
});

describe('Leaving the station: the queue', () => {
  it('adds a train to the queue the first time it hears a JUNCTION lockRequest from it', () => {
    expect(recordJunctionRequests([], [ask(2)], 10)).toEqual([
      { train: 2, firstHeardAt: 10, lastHeardAt: 10 },
    ]);
  });

  it('keeps the first-heard time when the same train repeats its request', () => {
    const after = recordJunctionRequests(queue, [ask(3)], 12);
    expect(after.find((r) => r.train === 3)?.firstHeardAt).toBe(5);
  });

  it('updates lastHeardAt when the same train repeats its request', () => {
    const after = recordJunctionRequests(queue, [ask(3)], 12);
    expect(after.find((r) => r.train === 3)?.lastHeardAt).toBe(12);
    expect(after.find((r) => r.train === 1)?.lastHeardAt).toBe(9);
  });

  it('never lists the same train twice', () => {
    const after = recordJunctionRequests(queue, [ask(3), ask(2), ask(2), ask(3)], 12);
    expect(after.map((r) => r.train)).toEqual([3, 1, 2]);
  });

  it('ignores lockRequests for platforms, which are for the station actor', () => {
    const inbox: Message[] = [{ type: 'lockRequest', from: 2, resource: 'P1' }];
    expect(recordJunctionRequests(queue, inbox, 12)).toEqual(queue);
    expect(newMerge().step(inbox)).toEqual([]);
  });

  it('removes a train from the queue when it is granted', () => {
    const { memory } = run([{ inbox: [ask(1), ask(2)] }]);
    expect(memory.holder?.train).toBe(1);
    expect(memory.queue.map((r) => r.train)).toEqual([2]);
  });

  it('does not put the holder back in the queue when it repeats its request', () => {
    const { memory } = run([{ inbox: [ask(1)] }, { inbox: [ask(1)] }]);
    expect(memory.holder?.train).toBe(1);
    expect(memory.queue).toEqual([]);
  });

  it('ignores a late JUNCTION request from a train it already let into EXIT', () => {
    // Train 1 is granted, runs through the zone and is gone. A late request from it is
    // refused and does not join the queue, so it is never granted a second time.
    const { memory, sent } = run([
      { inbox: [ask(1)] },
      { sensors: inZone },
      { sensors: justPast },
      { inbox: [ask(1)] },
      {},
    ]);
    expect(memory.lastIntoExit).toBe(1);
    expect(memory.queue).toEqual([]);
    expect(memory.holder).toBeNull();
    expect(sent[3]).toEqual([refuse(1)]);
    expect(sent[4]).toEqual([]);
  });

  it('drops a request whose train has not been heard for longer than silence, for example one that left by clock slot', () => {
    expect(dropSilentRequests(queue, 9 + MERGE_SILENCE + TICK, MERGE_SILENCE)).toEqual([]);
    const mixed = [queue[0], { ...queue[1], lastHeardAt: 12 }];
    expect(dropSilentRequests(mixed, 9 + MERGE_SILENCE + TICK, MERGE_SILENCE)).toEqual([mixed[1]]);
  });

  it('keeps a request whose train was heard within silence', () => {
    expect(dropSilentRequests(queue, 9 + REQUEST_REPEAT, MERGE_SILENCE)).toEqual(queue);
    expect(dropSilentRequests(queue, 9 + MERGE_SILENCE, MERGE_SILENCE)).toEqual(queue);
  });

  it('never grants a train that stopped asking while it waited', () => {
    const merge = newMerge();
    merge.step([ask(1), ask(2)]);
    // Train 2 stops asking. Train 1 runs through, which takes longer than MERGE_SILENCE.
    merge.passThrough();
    expect(merge.idle(30)).toEqual([]);
  });
});

describe('Leaving the station: who is next', () => {
  it('picks the request heard first', () => {
    expect(nextForJunction(queue)).toBe(3);
    expect(nextForJunction([...queue].reverse())).toBe(3);
  });

  it('picks the lowest ID when two requests were first heard on the same tick', () => {
    const tied: JunctionRequest[] = [
      { train: 4, firstHeardAt: 5, lastHeardAt: 9 },
      { train: 2, firstHeardAt: 5, lastHeardAt: 5 },
      { train: 3, firstHeardAt: 5, lastHeardAt: 9 },
    ];
    expect(nextForJunction(tied)).toBe(2);
  });

  it('picks nobody from an empty queue', () => {
    expect(nextForJunction([])).toBeNull();
  });
});

describe('Leaving the station: granting', () => {
  it('grants when nobody holds the lock, junctionOccupied is false and exitStartClear is true', () => {
    expect(canGrantJunction(null, clear, false)).toBe(true);
  });

  it('grants one train at a time', () => {
    const out = newMerge().step([ask(1), ask(2), ask(3)]);
    expect(out.filter((o) => o.msg.type === 'lockGrant')).toEqual([grant(1, null)]);
  });

  it('does not grant while another train holds the lock', () => {
    expect(canGrantJunction(waiting, clear, false)).toBe(false);
    expect(canGrantJunction(holder, clear, false)).toBe(false);
  });

  it('does not grant while junctionOccupied is true', () => {
    expect(canGrantJunction(null, { ...clear, junctionOccupied: true }, false)).toBe(false);
    expect(newMerge().step([ask(1)], inZone)).toEqual([refuse(1)]);
  });

  it('does not grant while exitStartClear is false, even when the junction zone is empty', () => {
    expect(canGrantJunction(null, justPast, false)).toBe(false);
    expect(newMerge().step([ask(1)], justPast)).toEqual([refuse(1)]);
  });

  it('sends lockGrant to the train with resource JUNCTION over short range', () => {
    expect(newMerge().step([ask(4)])).toEqual([
      { msg: { type: 'lockGrant', to: 4, resource: 'JUNCTION', follow: null }, range: 'short' },
    ]);
  });

  it('names the last train it let into EXIT in follow', () => {
    expect(followFor({ ...initialMergeMemory(), lastIntoExit: 4 }, 2)).toBe(4);
    const merge = newMerge();
    merge.step([ask(1)]);
    merge.passThrough();
    expect(merge.step([ask(2)])).toEqual([grant(2, 1)]);
  });

  it('names follow null for the first train it lets into EXIT', () => {
    expect(followFor(initialMergeMemory(), 2)).toBeNull();
    expect(newMerge().step([ask(2)])).toEqual([grant(2, null)]);
  });

  // Reworded. The frame said "sets lastIntoExit to the train it just granted". The actor
  // now waits until the holder is seen in the zone, so a train that is granted and never
  // leaves its platform is not named as the next train's leader.
  it('sets lastIntoExit to the holder once the holder is seen in the zone', () => {
    const granted = run([{ inbox: [ask(1)] }]);
    expect(granted.memory.lastIntoExit).toBeNull();
    const entered = run([{ sensors: inZone }], granted.memory);
    expect(entered.memory.lastIntoExit).toBe(1);
    expect(entered.memory.leaderUnknown).toBe(false);
  });

  // Reworded. The frame said "sets lastIntoExit to null whenever junctionOccupied is true
  // and nobody holds the lock". Null in `follow` now means no train has entered EXIT, so
  // the actor marks the leader unknown and the next grant names the train's own ID.
  it('marks the leader unknown whenever junctionOccupied is true and nobody holds the lock', () => {
    const memory = observeZone({ ...initialMergeMemory(), lastIntoExit: 4 }, inZone);
    expect(memory.leaderUnknown).toBe(true);
    expect(followFor(memory, 2)).toBe(2);
    // An empty zone changes nothing.
    expect(observeZone({ ...initialMergeMemory(), lastIntoExit: 4 }, clear).leaderUnknown).toBe(false);
  });

  it("names the granted train's own ID in follow after a train it did not grant has been in the zone", () => {
    const merge = newMerge();
    merge.step([ask(1)]);
    merge.passThrough();
    // A train that fell back to clock slots runs through with no lock.
    merge.passThrough();
    expect(merge.step([ask(2)])).toEqual([grant(2, 2)]);
    merge.passThrough();
    expect(merge.step([ask(3)])).toEqual([grant(3, 2)]);
  });

  it('answers a repeat request from the holder with the same grant and the same follow', () => {
    const merge = newMerge();
    merge.step([ask(1)]);
    merge.passThrough();
    expect(merge.step([ask(2)])).toEqual([grant(2, 1)]);
    expect(merge.step([ask(2)])).toEqual([grant(2, 1)]);
    // Still the same grant once train 2 itself is in the zone.
    expect(merge.step([ask(2)], inZone)).toEqual([grant(2, 1)]);
  });

  it('grants on the tick the conditions hold, so the train hears it on the next tick', () => {
    const merge = newMerge();
    expect(merge.step([ask(1)], justPast)).toEqual([refuse(1)]);
    expect(merge.step([], justPast)).toEqual([]);
    // No request on this tick. The start of EXIT clears, and the grant goes out at once.
    expect(merge.step([], clear)).toEqual([grant(1, null)]);
  });
});

describe('Leaving the station: releasing', () => {
  it('records the holder entering once junctionOccupied turns true after the grant', () => {
    expect(observeJunction(waiting, clear).seenEnter).toBe(false);
    expect(observeJunction(waiting, inZone).seenEnter).toBe(true);
    // Once seen, it stays seen after the zone is empty again.
    expect(observeJunction(holder, clear).seenEnter).toBe(true);
  });

  it('releases the lock when the junction zone is empty again after the holder entered', () => {
    expect(canReleaseJunction({ ...release, now: 11, holder, sensors: inZone })).toBe(false);
    expect(canReleaseJunction({ ...release, now: 12, holder, sensors: justPast })).toBe(true);
  });

  it('does not release the lock before the holder has entered the zone', () => {
    const now = waiting.grantedAt + 1;
    expect(canReleaseJunction({ ...release, now, holder: waiting, sensors: clear })).toBe(false);
  });

  // Reworded. The frame said "keeps the lock if the holder never enters, for example
  // after it breaks down in the platform". The team decided an unused grant is released
  // after MERGE_TIMEOUT, so a broken-down train does not block the junction for good.
  it('releases an unused grant once the zone has not become occupied within MERGE_TIMEOUT of the grant, for example after the holder breaks down in the platform', () => {
    const at = (now: number) => canReleaseJunction({ ...release, now, holder: waiting, sensors: clear });
    expect(at(waiting.grantedAt + MERGE_TIMEOUT - TICK)).toBe(false);
    expect(at(waiting.grantedAt + MERGE_TIMEOUT)).toBe(false);
    expect(at(waiting.grantedAt + MERGE_TIMEOUT + TICK)).toBe(true);
  });

  it('does not name a train whose grant went unused as the next leader', () => {
    const merge = newMerge();
    merge.step([ask(1)]);
    merge.passThrough();
    // Train 2 is granted and breaks down in its platform. Train 3 waits behind it.
    expect(merge.step([ask(2)])).toEqual([grant(2, 1)]);
    const out = merge.repeat(MERGE_TIMEOUT + 2 * REQUEST_REPEAT, [3]);
    // Train 3 follows train 1, the last train that did enter EXIT.
    const grants = out.filter((o) => o.msg.type === 'lockGrant');
    expect(grants.length).toBeGreaterThan(0);
    for (const g of grants) expect(g).toEqual(grant(3, 1));
  });

  it('counts the unused time from the last time it sent the holder its grant', () => {
    let { memory } = run([{ inbox: [ask(1)] }]);
    const later = MERGE_TIMEOUT - TICK;
    memory = stepMerge({ ...memory, lastStepAt: later - TICK }, later, [ask(1)], clear).memory;
    expect(memory.holder?.grantedAt).toBe(later);
    // The first grant is now over MERGE_TIMEOUT old, and the lock is still held.
    memory = stepMerge(memory, later + 3 * TICK, [], clear).memory;
    expect(memory.holder?.train).toBe(1);
  });

  it('grants the next train once the lock is released and the conditions hold again', () => {
    const merge = newMerge();
    expect(merge.step([ask(1), ask(2)])).toEqual([grant(1, null), refuse(2)]);
    merge.idle(8, inZone);
    // The zone is empty, so the lock is released. The start of EXIT is not clear yet.
    expect(merge.idle(4, justPast)).toEqual([]);
    merge.step([ask(2)], justPast);
    expect(merge.step([], clear)).toEqual([grant(2, 1)]);
  });
});

describe('Merge switched off: refusing queued trains (rule from the review on #31)', () => {
  it('sends lockRefuse for JUNCTION with alternative null, over short range, to each train whose request it hears and does not grant on that tick', () => {
    const out = newMerge().step([ask(3), ask(1), ask(2)]);
    expect(out).toEqual([
      { msg: { type: 'lockGrant', to: 1, resource: 'JUNCTION', follow: null }, range: 'short' },
      { msg: { type: 'lockRefuse', to: 3, resource: 'JUNCTION', alternative: null }, range: 'short' },
      { msg: { type: 'lockRefuse', to: 2, resource: 'JUNCTION', alternative: null }, range: 'short' },
    ]);
  });

  it('answers each request on the tick it hears it, not on every tick', () => {
    const merge = newMerge();
    merge.step([ask(1)]);
    expect(merge.step([ask(2)])).toEqual([refuse(2)]);
    expect(merge.step([])).toEqual([]);
    expect(merge.step([])).toEqual([]);
    expect(merge.step([ask(2)])).toEqual([refuse(2)]);
  });

  it('does not refuse the train it grants on that tick, or the holder repeating its request', () => {
    const memory: MergeMemory = { ...initialMergeMemory(), holder: waiting };
    expect(queuedToAnswer(memory, [ask(3), ask(1)], false)).toEqual([1]);
    const merge = newMerge();
    expect(merge.step([ask(1), ask(2)])).toEqual([grant(1, null), refuse(2)]);
    expect(merge.step([ask(1), ask(2)])).toEqual([grant(1, null), refuse(2)]);
  });

  it('never lets a train that fell back to clock slots and a granted train into the junction zone together', () => {
    // A train falls back to clock slots only after MERGE_TIMEOUT without a reply. Four
    // trains ask every REQUEST_REPEAT while they leave one at a time. Each waiting train
    // hears a reply to every request, so none of them ever goes MERGE_TIMEOUT unanswered.
    const merge = newMerge();
    const waitingTrains = new Set<TrainId>([1, 2, 3, 4]);
    const lastReply = new Map<TrainId, number>([...waitingTrains].map((t) => [t, 0]));
    const every = Math.round(REQUEST_REPEAT / TICK);
    let inZoneFor = 0;
    let pastFor = 0;
    for (let i = 0; waitingTrains.size > 0; i++) {
      expect(i).toBeLessThan(5000);
      const readings = inZoneFor > 0 ? inZone : pastFor > 0 ? justPast : clear;
      const now = merge.now;
      const out = merge.step(i % every === 0 ? [...waitingTrains].map(ask) : [], readings);
      if (inZoneFor > 0) inZoneFor--;
      else if (pastFor > 0) pastFor--;
      for (const o of out) {
        if (o.msg.type !== 'lockGrant' && o.msg.type !== 'lockRefuse') continue;
        lastReply.set(o.msg.to, now);
        if (o.msg.type === 'lockGrant') {
          // A grant goes out only while the zone is empty.
          expect(readings).toBe(clear);
          waitingTrains.delete(o.msg.to);
          inZoneFor = 80;
          pastFor = 40;
        }
      }
      for (const train of waitingTrains) {
        expect(now - (lastReply.get(train) ?? 0)).toBeLessThan(MERGE_TIMEOUT);
      }
    }
  });
});

describe('Messages (The radio)', () => {
  it('ignores every message that is not a lockRequest', () => {
    const inbox: Message[] = [
      { type: 'position', from: 1, pos: { track: 'P1', offset: 300 }, speed: 0, sentAt: 0 },
      { type: 'lockGrant', to: 1, resource: 'JUNCTION', follow: null },
      { type: 'lockRefuse', to: 1, resource: 'JUNCTION', alternative: null },
      { type: 'platformStatus', platform: 'P1', occupied: true, sentAt: 0 },
      { type: 'permit', to: 1, untilX: 6300, nextTrack: 'EXIT', sentAt: 0 },
    ];
    const { memory, sent } = run([{ inbox }]);
    expect(sent[0]).toEqual([]);
    expect(memory.queue).toEqual([]);
    expect(memory.holder).toBeNull();
  });

  it('sends nothing on a tick when it hears no request and grants nobody', () => {
    const merge = newMerge();
    expect(merge.idle(5)).toEqual([]);
    merge.step([ask(1), ask(2)]);
    expect(merge.idle(1)).toEqual([]);
    expect(merge.idle(1, inZone)).toEqual([]);
  });
});

describe('Switched back on (rule from the review on #31)', () => {
  const resumedAt = 50;
  const windowOver = resumedAt + RESUME_SETTLE;
  const before: MergeMemory = {
    holder: waiting,
    queue,
    lastIntoExit: 2,
    leaderUnknown: false,
    lastStepAt: 10,
    resumedAt: null,
    zoneOccupiedSinceResume: true,
  };
  const afterGap = { ...release, resumedAt, holder: waiting, sensors: clear };

  it('keeps its memory across being switched off and on', () => {
    const merge = newMerge();
    merge.step([ask(1), ask(2)]);
    merge.idle(1, inZone);
    merge.off(1);
    // Train 2 kept its place in the queue ahead of train 3, which asks only now.
    merge.repeat(RESUME_SETTLE, [3, 2]);
    expect(merge.step([ask(3), ask(2)])).toEqual([grant(2, 2), refuse(3)]);
  });

  it('sets lastStepAt to now on every step', () => {
    let memory = initialMergeMemory();
    for (const now of [0, TICK, 2 * TICK, 40]) {
      memory = stepMerge(memory, now, [], clear).memory;
      expect(memory.lastStepAt).toBe(now);
    }
  });

  it('sets resumedAt to now and zoneOccupiedSinceResume to false when wasSwitchedOff says it was off', () => {
    const resumed = resumeMerge(before, resumedAt);
    expect(resumed.resumedAt).toBe(resumedAt);
    expect(resumed.zoneOccupiedSinceResume).toBe(false);
    const stepped = stepMerge(before, resumedAt, [], clear).memory;
    expect(stepped.resumedAt).toBe(resumedAt);
    expect(stepMerge(stepped, resumedAt + TICK, [], clear).memory.resumedAt).toBe(resumedAt);
  });

  it('counts its first step as coming back on when the run is already past time 0', () => {
    const { memory, out } = stepMerge(initialMergeMemory(), 30, [ask(1)], clear);
    expect(memory.resumedAt).toBe(30);
    expect(memory.leaderUnknown).toBe(true);
    expect(out).toEqual([refuse(1)]);
  });

  it('does not count a first step at time 0 as coming back on', () => {
    expect(stepMerge(initialMergeMemory(), 0, [], clear).memory.resumedAt).toBeNull();
  });

  // Reworded. The frame said "sets lastIntoExit to null when it comes back, so no grant
  // names a stale follow". It still does. It also marks the leader unknown, because null
  // in `follow` now means no train has entered EXIT.
  it('sets lastIntoExit to null and marks the leader unknown when it comes back, so no grant names a stale follow', () => {
    const resumed = resumeMerge(before, resumedAt);
    expect(resumed.lastIntoExit).toBeNull();
    expect(resumed.leaderUnknown).toBe(true);
  });

  it("names the granted train's own ID in follow on the first grant after it comes back, and the train before on every later grant", () => {
    const merge = newMerge();
    merge.step([ask(1)]);
    merge.passThrough();
    merge.off(60);
    merge.repeat(RESUME_SETTLE, [2, 3]);
    expect(merge.step([ask(2), ask(3)])).toEqual([grant(2, 2), refuse(3)]);
    merge.passThrough();
    expect(merge.step([ask(3)])).toEqual([grant(3, 2)]);
  });

  it('keeps the queue and its order when it comes back', () => {
    const resumed = resumeMerge(before, resumedAt);
    expect(resumed.queue.map((r) => [r.train, r.firstHeardAt])).toEqual([
      [3, 5],
      [1, 7],
    ]);
  });

  it('sets every lastHeardAt in the queue to now when it comes back, so dropSilentRequests clears trains that left by clock slot', () => {
    const resumed = resumeMerge(before, resumedAt);
    expect(resumed.queue.map((r) => r.lastHeardAt)).toEqual([resumedAt, resumedAt]);
    // Train 3 left by clock slot and never asks again. It is gone before the window ends.
    let memory = stepMerge({ ...before, holder: null }, resumedAt, [], clear).memory;
    for (let i = 1; i * TICK < RESUME_SETTLE; i++) {
      const inbox = i % 20 === 0 ? [ask(1)] : [];
      memory = stepMerge(memory, resumedAt + i * TICK, inbox, clear).memory;
    }
    expect(memory.queue.map((r) => r.train)).toEqual([1]);
  });

  it('grants nothing until resumedAt + settle', () => {
    expect(canGrantJunction(null, clear, true)).toBe(false);
    const merge = newMerge();
    merge.step();
    merge.off(60);
    const out = merge.repeat(RESUME_SETTLE, [1]);
    expect(out.length).toBeGreaterThan(0);
    expect(out.some((o) => o.msg.type === 'lockGrant')).toBe(false);
    expect(merge.step()).toEqual([grant(1, 1)]);
  });

  it('refuses every JUNCTION request it hears until resumedAt + settle', () => {
    expect(queuedToAnswer({ ...before, resumedAt }, [ask(3), ask(1), ask(4)], true)).toEqual([3, 1, 4]);
    const merge = newMerge();
    merge.step();
    merge.off(60);
    expect(merge.repeat(RESUME_SETTLE, [1, 2])).toEqual([
      refuse(1),
      refuse(2),
      refuse(1),
      refuse(2),
      refuse(1),
      refuse(2),
    ]);
  });

  it('sets zoneOccupiedSinceResume once junctionOccupied reads true after resumedAt', () => {
    const resumed = resumeMerge(before, resumedAt);
    expect(observeZone(resumed, clear).zoneOccupiedSinceResume).toBe(false);
    const seen = observeZone(resumed, inZone);
    expect(seen.zoneOccupiedSinceResume).toBe(true);
    expect(observeZone(seen, clear).zoneOccupiedSinceResume).toBe(true);
  });

  it('releases a holder with seenEnter false once the window is over, if the zone read empty for the whole window', () => {
    expect(grantedBeforeResume(waiting, resumedAt)).toBe(true);
    expect(canReleaseJunction({ ...afterGap, now: windowOver - TICK })).toBe(false);
    expect(canReleaseJunction({ ...afterGap, now: windowOver })).toBe(true);
  });

  it('keeps a holder with seenEnter false if the zone read occupied at any step in the window', () => {
    const check = { ...afterGap, zoneOccupiedSinceResume: true };
    expect(canReleaseJunction({ ...check, now: windowOver })).toBe(false);
    expect(canReleaseJunction({ ...check, now: windowOver + 100 })).toBe(false);
  });

  it('does not repeat the grant of a holder from before the gap, and refuses it instead', () => {
    // The actor does not know what happened in the zone while it was off.
    const merge = newMerge();
    merge.step([ask(1)]);
    merge.off(60);
    merge.idle(1, inZone);
    merge.idle(RESUME_SETTLE);
    expect(merge.step([ask(1)], inZone)).toEqual([refuse(1)]);
  });

  it('does not name a holder from before the gap as the next leader', () => {
    const merge = newMerge();
    merge.step([ask(1)]);
    merge.off(60);
    merge.idle(8, inZone);
    merge.idle(4, justPast);
    expect(merge.step([ask(2)])).toEqual([grant(2, 2)]);
  });

  it('does not grant while a train that started in a clock slot is in the junction zone', () => {
    const merge = newMerge();
    merge.step();
    merge.off(60);
    // The train started on the tick the actor came back and is in the zone a second later.
    merge.idle(1);
    const out = merge.repeat(RESUME_SETTLE + 10, [1], inZone);
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((o) => o.msg.type === 'lockRefuse')).toBe(true);
    expect(merge.step([ask(1)], justPast)).toEqual([refuse(1)]);
    expect(merge.step([], clear)).toEqual([grant(1, 1)]);
  });
});

describe('Scenarios', () => {
  it('four trains asking for the junction leave one at a time in request order', () => {
    const merge = newMerge();
    // Trains 3 and 4 ask first, on the same tick. Then 2, then 1.
    expect(merge.step([ask(4), ask(3)])).toEqual([grant(3, null), refuse(4)]);
    expect(merge.step([ask(2)])).toEqual([refuse(2)]);
    expect(merge.step([ask(1)])).toEqual([refuse(1)]);

    const order: Array<[TrainId, TrainId | null]> = [[3, null]];
    let left = [4, 2, 1];
    for (let round = 0; round < 3; round++) {
      // The holder runs through. The rest keep asking and are refused every time.
      const during = [...merge.repeat(8, left, inZone), ...merge.repeat(4, left, justPast)];
      expect(during.every((o) => o.msg.type === 'lockRefuse')).toBe(true);
      const out = merge.step(left.map(ask));
      const grants = out.filter((o) => o.msg.type === 'lockGrant');
      expect(grants).toHaveLength(1);
      const msg = grants[0].msg;
      if (msg.type !== 'lockGrant') throw new Error('not a grant');
      order.push([msg.to, msg.follow]);
      left = left.filter((t) => t !== msg.to);
    }
    // Each grant names the train that left before it.
    expect(order).toEqual([
      [3, null],
      [4, 3],
      [2, 4],
      [1, 2],
    ]);
  });

  it('a train that breaks down after its grant does not block the junction', () => {
    const merge = newMerge();
    expect(merge.step([ask(1), ask(2)])).toEqual([grant(1, null), refuse(2)]);
    // Train 1 breaks down in its platform and sends nothing. Train 2 keeps asking.
    const out = merge.repeat(MERGE_TIMEOUT + 2 * REQUEST_REPEAT, [2]);
    const grants = out.filter((o) => o.msg.type === 'lockGrant');
    // Nobody has entered EXIT, so train 2 has no leader. It asks once more before it
    // hears the grant, and gets the same grant again.
    expect(grants).toEqual([grant(2, null), grant(2, null)]);
  });

  it('the settle window after a resume', () => {
    const merge = newMerge();
    // Train 1 holds the lock and trains 2 and 3 wait when the actor is switched off.
    merge.step([ask(1), ask(2), ask(3)]);
    merge.off(120);
    // While it was off, train 1 left on its grant and train 2 left by clock slot. Train 3
    // is still asking, and train 4 has started asking.
    const every = Math.round(REQUEST_REPEAT / TICK);
    for (let i = 0; i < Math.round(RESUME_SETTLE / TICK); i++) {
      const out = merge.step(i % every === 0 ? [ask(4), ask(3)] : []);
      if (i % every === 0) expect(out).toEqual([refuse(4), refuse(3)]);
      else expect(out).toEqual([]);
    }
    // The window is over and the zone stayed empty. Train 1's lock is released, train 2
    // is out of the queue, and train 3 goes first with its leader unknown.
    expect(merge.step([ask(4), ask(3)])).toEqual([grant(3, 3), refuse(4)]);
    merge.passThrough();
    expect(merge.step([ask(4)])).toEqual([grant(4, 3)]);
  });
});
