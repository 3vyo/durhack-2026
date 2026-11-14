# Design

A browser simulation where trains run themselves, share track through local locks, and keep moving at reduced speed when the radio or the control centre fails.

## Why

Today a regional control centre sets every signal. When it or the rail radio fails, every train in the area stops until staff restart them one at a time. On 6 August 2026 a 90-second power cut at the Manchester control centre stopped trains across the North West for the rest of the day.

We show a fallback where trains keep moving safely through that kind of outage. We pitch it as a layer underneath the central system. It does not replace it.

## The map

All trains run left to right. Every track sits on one shared x axis, in metres. A train's x is its track's start plus its offset.

```
A ──────────────────┬─ P1 ─┐
                    └─ P2 ─┤
                           ├── EXIT ──────────────►
B ──────────────────┬─ P3 ─┤
                    └─ P4 ─┘
x=0               6000   6400                 12400
```

| Track | Starts at x | Length | Notes |
|---|---|---|---|
| A | 0 | 6000 | Entry line. Feeds P1 and P2 |
| B | 0 | 6000 | Entry line. Feeds P3 and P4 |
| P1 to P4 | 6000 | 400 | Platforms. A train stops with its front at offset 300 |
| EXIT | 6400 | 6000 | Single line out |

Two fixed places matter.

- The ask point is at offset 4800 on A and B. It is the last place a train at full speed can still brake before the station.
- The junction zone is the last 100 m of every platform plus the first 200 m of EXIT. Only one train may be in it.

## Units and constants

Metres, seconds, metres per second. These live in `src/shared/constants.ts`.

| Name | Value | Meaning |
|---|---|---|
| `MAX_SPEED` | 45 | About 100 mph |
| `ACCEL` | 0.5 | Acceleration |
| `BRAKE` | 0.9 | Braking rate |
| `TRAIN_LENGTH` | 100 | |
| `MARGIN` | 50 | Extra gap kept beyond braking distance |
| `SENSOR_RANGE` | 300 | How far a train's own sensor sees along its path |
| `SIGHT_SPEED` | 21 | Fastest speed that can stop within `SENSOR_RANGE - MARGIN` |
| `FRESH` | 5 | A position message older than this is stale |
| `TICK` | 0.1 | Simulation step |

Braking distance is speed squared divided by twice `BRAKE`. The speed that can stop within a distance `d` is the square root of `2 * BRAKE * d`. Call that `safeSpeed(d)`.

## The actors

- A train knows its own state, the timetable, and whatever messages it has received. It never reads another train's state directly.
- The merge actor owns the junction zone and grants one lock at a time.
- The station actor owns the four platforms and grants one lock per platform.
- Each platform has a sensor that broadcasts empty or occupied.

The merge and station actors have wired sensors, so they see their own track without radio.

## The radio

Every message goes through one function in the engine.

- Long range reaches every train. A slider sets the share of long-range messages the engine drops.
- Short range does not drop messages at random. A local actor is either alive or switched off.
- A train reaches the station actor when its x is between 4300 and 6400.
- A train reaches the merge actor when its x is between 6000 and 6600.
- A train hears platform sensors when its x is between 5500 and 6400.

## Shared types

These go in `src/shared/types.ts`. Changing them needs its own pull request.

```ts
export type TrainId = number;
export type TrackId = 'A' | 'B' | 'P1' | 'P2' | 'P3' | 'P4' | 'EXIT';
export type PlatformId = 'P1' | 'P2' | 'P3' | 'P4';
export type ResourceId = PlatformId | 'JUNCTION';

export interface Position { track: TrackId; offset: number }

export interface TrainState {
  id: TrainId;
  pos: Position;          // front of the train
  speed: number;
  brokenDown: boolean;
}

export interface TimetableEntry {
  id: TrainId;
  entry: 'A' | 'B';
  enterAt: number;
  platform: PlatformId;   // default platform, always in the entry track's own pair
  leader: TrainId | null; // the train directly ahead on the same entry track
  dwell: number;          // seconds to wait in the platform
}

export type Message =
  | { type: 'position'; from: TrainId; pos: Position; speed: number; sentAt: number }
  | { type: 'lockRequest'; from: TrainId; resource: ResourceId }
  | { type: 'lockGrant'; to: TrainId; resource: ResourceId; follow: TrainId | null }
  | { type: 'lockRefuse'; to: TrainId; resource: ResourceId; alternative: PlatformId | null }
  | { type: 'platformStatus'; platform: PlatformId; occupied: boolean; sentAt: number };

export interface Outgoing { msg: Message; range: 'long' | 'short' }

export interface TrainInput {
  now: number;
  self: TrainState;
  inbox: Message[];
  sightAhead: number | null; // metres to the nearest train on this train's path, or null if none within SENSOR_RANGE
}

export interface TrainOutput {
  accel: number;             // between -BRAKE and ACCEL
  nextTrack: TrackId | null; // where to go at the end of the current track
  outbox: Outgoing[];
}

export interface TrainAgent {
  decide(input: TrainInput): TrainOutput;
}

export interface SensorReadings {
  platformOccupied: Record<PlatformId, boolean>;
  junctionOccupied: boolean;
  exitStartClear: boolean;   // true if the first 300 m of EXIT is empty
}

export interface LocalActor {
  id: 'station' | 'merge';
  step(now: number, inbox: Message[], sensors: SensorReadings): Outgoing[];
}
```

The engine calls `decide` on every train each tick, applies the returned acceleration, moves the train, and delivers the outbox through the radio. `sightAhead` also reports any train inside the junction zone as an obstacle at the zone's edge.

## Train rules

### Following

Each train broadcasts a `position` message every second over long range.

A train knows who its leader is. On A and B the timetable names it. On EXIT the merge actor names it in the `follow` field of the grant.

The limit point is the leader's last reported rear minus `MARGIN`, however old that report is. The leader cannot have moved backwards, so the track up to that point is clear.

```
limit = min(MAX_SPEED, max(safeSpeed(distance to limit point), SIGHT_SPEED))
if sightAhead is not null:
    limit = min(limit, safeSpeed(sightAhead - MARGIN))
```

If a train has never heard its leader, or does not know who its leader is, it has no limit point and stays at `SIGHT_SPEED` or below.

The display labels each train with a mode.

| Mode | Meaning |
|---|---|
| full | Leader's report is under `FRESH` seconds old |
| stale | Leader's report is older |
| blind | No report from the leader, or leader unknown |

### Entering the station

1. A train may not pass the end of A or B without a platform. It treats the end of its entry track as a limit point until it has one.
2. At the ask point it sends a `lockRequest` for its default platform and repeats it every 2 seconds.
3. On a `lockGrant` it sets `nextTrack` to that platform and runs in.
4. On a `lockRefuse` with an alternative it requests the alternative. With no alternative it keeps braking and keeps asking.
5. With no reply at all, it stops before the end of its entry track. Silence means no.

The station actor grants a platform only if its sensor says empty and no other train holds the lock. It only offers platforms from the train's own pair. It releases a lock when the sensor shows the train has left.

### Station switched off

A train stopped at the end of its entry track with no reply uses the fixed split. Track A owns P1 and P2. Track B owns P3 and P4.

```
for each platform my entry track owns, lowest number first:
    if its sensor says empty, take it and enter at SIGHT_SPEED or below
if none are empty, wait
```

If the sensors are switched off too, the train creeps toward the first platform of its pair that it cannot see a train in.

This is safe because trains on one entry track arrive in a queue, and trains on different entry tracks never want the same platform.

### Leaving the station

1. After its dwell time a train sends a `lockRequest` for `JUNCTION` and repeats it every 2 seconds.
2. The merge actor grants one train at a time, oldest request first, lowest ID on a tie. It grants only when `junctionOccupied` is false and `exitStartClear` is true. That stops a train entering the junction when it cannot clear the far side.
3. On a grant the train sets `nextTrack` to `EXIT`, departs, and treats the `follow` train as its leader.
4. The merge actor releases the lock when its sensor shows the junction zone is empty again.

### Merge switched off

After 10 seconds without a reply, a train uses clock slots. Every train has an accurate clock, so no messages are needed.

```
slot = floor(now / 60) mod 4
platform Pk may start during the first 15 seconds of slot k - 1
```

A train starts only if `sightAhead` shows the junction zone empty. It does not know its leader on EXIT, so it stays at `SIGHT_SPEED` until it hears one.

## Failures the demo can inject

- A slider for the share of long-range messages dropped.
- Switches for the station actor, the merge actor and the platform sensors.
- A button to break down a chosen train, which stops it where it is.

## Today's rule, for comparison

A toggle swaps in a baseline. A central controller sends every train a permit each second over long range and decides platforms and junction order itself. A train with no permit for 5 seconds brakes to a stop and waits until permits resume. This lives in `src/baseline/`.

## Metrics

- Trains per hour leaving the right-hand end of EXIT.
- Total delay against the timetable.
- Collisions, meaning two trains overlapping on one track or two trains in the junction zone. This must stay at zero.
- Close calls, meaning a gap under `MARGIN`.

## Folders

| Folder | Holds |
|---|---|
| `src/shared/` | Types and constants |
| `src/engine/` | Clock, physics, map, radio, timetable, failure switches, metrics |
| `src/train/` | The train agent |
| `src/locks/` | Station actor, merge actor, platform sensors |
| `src/baseline/` | Central controller and the baseline train agent |
| `src/ui/` | Canvas, controls, metrics panel |

Stack: TypeScript, Vite, a canvas, and Vitest for tests. No server.

## Stretch goals

Build these only after the five issues are done.

- Early booking. A train asks the station for a platform over long range before the ask point and adjusts its speed to arrive as the platform frees.
- Borrowing. When the station is off and nearby trains can hear each other, the lowest ID picks first and may take a free platform from the other pair.
- Hazard broadcast. A train that spots a problem tells nearby trains, and only trains heading towards it stop.
- An advisory control centre that suggests a better junction order when it is healthy.
