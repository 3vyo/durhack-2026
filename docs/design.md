# Design

A browser simulation where trains run themselves, share track through local locks, and keep moving at reduced speed when the radio or the control centre fails.

## Why

Today a regional control centre sets every signal. When it or the rail radio fails, every train in the area stops until staff restart them one at a time. On 6 August 2026 a 90-second power cut at the Manchester control centre stopped trains across the North West for the rest of the day.

We show a fallback where trains keep moving safely through that kind of outage. We pitch it as a layer underneath the central system. It does not replace it. While the control centre works, our trains obey it exactly as today's trains do. Our own rules take over only when it fails.

| Layer | Today's system | With ours |
|---|---|---|
| 1 | The control centre | The control centre |
| 2 | | Our trains' own rules, 5 seconds after the centre goes quiet |
| 3 | Radio working, 20 minutes after the centre goes down | Radio working, which our trains do not need in the sim |
| 4 | Nothing moves | Nothing moves |

Radio working is how the railway moves stranded trains today. Staff tell each driver by radio when to move, one train at a time, at caution speed. It cannot start until about 20 minutes after the outage, and it needs the radio.

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

The timers the rules use are constants too.

| Name | Value | Meaning |
|---|---|---|
| `PERMIT_FRESH` | 5 | A permit older than this is dropped |
| `PERMIT_INTERVAL` | 1 | How often the control centre sends permits |
| `POSITION_INTERVAL` | 1 | How often a train broadcasts its position |
| `REQUEST_REPEAT` | 2 | How often a train repeats a lock request |
| `MERGE_TIMEOUT` | 10 | Silence from the merge actor before a train uses clock slots |
| `STATION_TIMEOUT` | 10 | Silence from the station actor before a stopped train uses the fixed split |
| `RESUME_SETTLE` | 5 | How long a local actor grants nothing after it is switched back on |
| `SLOT_LENGTH`, `SLOT_WINDOW`, `SLOT_COUNT` | 60, 15, 4 | The clock slots |
| `RADIO_WORKING_DELAY` | 1200 | How long the centre is down before staff move the first train by radio |
| `RADIO_RELEASE_GAP` | 60 | How often staff release one stopped train by radio. Our assumption |

### The parameter file

These values are the defaults. A parameter file can change them for one run. It is one JSON file, and every part of it is optional.

```json
{
  "name": "centre outage",
  "physics": { "maxSpeed": 45, "brake": 0.9, "sensorRange": 300 },
  "timers": { "mergeTimeout": 10 },
  "timetable": { "seed": 1, "trains": 12, "headway": 45, "dwell": 30 },
  "start": { "centre": true, "radioDrop": 0 },
  "failures": [
    { "at": 300, "centre": false },
    { "at": 480, "centre": true },
    { "at": 600, "breakDown": 3 }
  ],
  "runLength": 3600
}
```

- `src/shared/params.ts` reads and checks the file, and lists every problem at once.
- `applyParams` replaces the constants before a run starts. The constants are declared with `let`, so every file that imports one sees the new value. Read a constant where you use it, inside a function. A copy made when a file loads keeps the old value.
- The map is not a parameter.
- `npm run sim -- params/centre-outage.json` runs a file with our program and with the baseline, and prints both. Example files are in `params/`.

## The actors

- A train knows its own state, the timetable, and whatever messages it has received. It never reads another train's state directly.
- The merge actor owns the junction zone and grants one lock at a time.
- The station actor owns the four platforms and grants one lock per platform.
- Each platform has a sensor that broadcasts empty or occupied.
- The control centre sees the true state of every train. While it is switched on, it sends each train a `permit` every second. It is today's system. It does not use the station actor, the merge actor or the platform sensors.

The merge and station actors have wired sensors, so they see their own track without radio.

## The radio

Every message goes through one function in the engine.

- Long range reaches every train. A slider sets the share of train-to-train messages the engine drops.
- The slider does not affect the control centre's permits. The centre is either on or switched off.
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
  | { type: 'platformStatus'; platform: PlatformId; occupied: boolean; sentAt: number }
  // From the control centre. `leader` is the train directly ahead on this train's path, null
  // if there is none, and absent if the sender does not say.
  | { type: 'permit'; to: TrainId; untilX: number; nextTrack: TrackId | null; sentAt: number; leader?: TrainId | null };

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
  mode: 'central' | 'full' | 'stale' | 'blind'; // for the display only
}

export interface TrainAgent {
  decide(input: TrainInput): TrainOutput;
}

// Every agent is built from its own ID and the full timetable, and nothing else.
export type TrainAgentFactory = (id: TrainId, timetable: TimetableEntry[]) => TrainAgent;

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

`sightAhead` looks along the train's path.

- The path follows the `nextTrack` the train returned on the previous tick. When `nextTrack` is null, the path ends at the end of the current track.
- A train may change `nextTrack` on any tick until its front crosses the end of the track.
- It reports the nearest obstacle on the path, whether that is a train or the edge of an occupied junction zone.
- The distance is from this train's front to the rear of the obstacle.

A message sent on tick t is in the inbox on tick t + 1. This holds for trains, local actors and the control centre.

A train enters at the start of A or B at `SIGHT_SPEED`, the one speed that can always stop within what it sees. It waits outside the map until the first `SENSOR_RANGE + TRAIN_LENGTH` metres of its entry track are clear, and the wait counts as delay. Trains on one entry track enter in timetable order.

## Train rules

### The centre comes first

While a train holds a permit under 5 seconds old, it obeys the control centre like today's trains. The centre picks its platform, orders the junction and says how far it may run.

- It takes the permit's `nextTrack` and never passes the permit's `untilX`.
- It brakes for `sightAhead`, as a driver would.
- It sends no lock requests and ignores the local actors' replies.
- It still broadcasts its position every second, so the trains behind it can follow it if the centre fails.

It needs nothing from the train-to-train radio, the station actor, the merge actor or the platform sensors. A failure of any of those, with the centre still working, costs it nothing.

When its permit goes stale, the train runs on the rules in the rest of this section. It starts from where the centre left it.

- On EXIT, or past offset 300 in its platform and so in the junction zone, it takes the `leader` its last permit named as its leader. The centre let it through, so it carries on out without asking the merge actor.
- On A or B, if it can no longer stop before the end of its entry track, it keeps the platform its last permit sent it to and asks the station actor for that platform. The centre only sent it there if the platform was free, and no other train can reach that platform before it.
- Anywhere else it stops where its own rules say and asks for what it needs.

When permits return, the train obeys them again on the next tick. It forgets its request timers and drops a junction grant, because the centre now orders the junction. The centre takes over from where the trains are.

- A train on A or B whose route is set into a platform of its own pair is sent there.
- A train already in the junction zone becomes the junction holder, so the centre lets no other train in until it has cleared the zone.

The centre sees each train's set route as the signalling shows it. The engine passes it with the trains' true state.

### Following

Each train broadcasts a `position` message every second over long range.

A train knows who its leader is. On A and B the timetable names it. On EXIT the merge actor names it in the `follow` field of the grant.

"No leader" and "leader unknown" are different.

- **No leader.** The timetable gives `leader: null` for the first train on an entry track, and a junction grant gives `follow: null` when no train has entered EXIT. The line ahead is clear. The train has no limit point, so only `MAX_SPEED`, `sightAhead` and stop points limit it. It shows `full`.
- **Leader unknown.** A train that left on a clock slot does not know who is ahead. Nor does a train whose junction grant names its own ID in `follow`, which is how a merge actor that was just switched back on says it does not know. The train stays at `SIGHT_SPEED` or below and shows `blind`.

The limit point is the leader's last reported rear minus `MARGIN`, however old that report is. The leader cannot have moved backwards, so the track up to that point is clear.

```
limit = min(MAX_SPEED, max(safeSpeed(distance to limit point), SIGHT_SPEED))
if sightAhead is not null:
    limit = min(limit, safeSpeed(sightAhead - MARGIN))
```

The `SIGHT_SPEED` floor applies to the leader's limit point only. `sightAhead` covers the last 300 m behind the leader, so the train can still stop.

If a train has never heard its leader, or does not know who its leader is, it has no limit point and stays at `SIGHT_SPEED` or below.

A train that leaves the map sends one last `position` on the tick it leaves, with its front at the end of EXIT. Only a train that is leaving can report that, so a leader whose last report says it has gone leaves no limit point. Without this, the train behind would slow to `SIGHT_SPEED` near the end of the line, because its leader's last report would still sit there.

A stop point is a place the train must not pass. There are two.

- The end of an entry track, for a train with no platform.
- Offset 300 in a platform.

A stop point has no floor.

```
limit = min(limit, safeSpeed(distance to stop point))
```

A train stops at or before a stop point, never past it. It starts braking one tick early, so rounding leaves it a few centimetres short. Offset 300 in a platform is the edge of the junction zone, so a train that passes it counts as being in the zone.

The display labels each train with a mode.

| Mode | Meaning |
|---|---|
| central | The train holds a permit under 5 seconds old and obeys it. This label takes priority over the other three |
| full | Leader's report is under `FRESH` seconds old |
| stale | Leader's report is older |
| blind | No report from the leader, or leader unknown |

### Entering the station

1. A train may not pass the end of A or B without a platform. It treats the end of its entry track as a stop point until it has one.
2. At the ask point it sends a `lockRequest` and repeats it every 2 seconds. It asks for its default platform, unless it kept a platform from its last permit.
3. On a `lockGrant` it sets `nextTrack` to that platform and runs in. It keeps repeating its request for that platform every 2 seconds until its front is in the platform.
4. On a `lockRefuse` with an alternative it requests the alternative. With no alternative it keeps braking and keeps asking.
5. With no reply at all, it stops before the end of its entry track. Silence means no.
6. A broken-down train brakes, keeps broadcasting its position and sends no lock requests.

The station actor grants a platform only if its sensor says empty and no other train holds the lock. It only offers platforms from the train's own pair. It releases a lock after the sensor has shown the train arrive and then leave. If two trains ask for the same free platform on the same tick, the train with the earlier `enterAt` gets it.

The station actor grants only to the front train on each entry track. Trains on one entry track stand in a queue and cannot pass each other. A platform given to a train further back could never be reached, and the queue would stop for good. So while a train with no lock is still asking, the actor refuses every train that entered the same entry track after it.

The train counts its own dwell time from the moment it stops in the platform.

### Station switched off

A train stopped at the end of its entry track with no reply for `STATION_TIMEOUT` uses the fixed split. The time counts from the later of its first request and the last reply it heard. Track A owns P1 and P2. Track B owns P3 and P4.

```
for each platform my entry track owns, lowest number first:
    if its sensor says empty, take it and enter at SIGHT_SPEED or below
if none are empty, wait
```

If the sensors are switched off too, the train creeps toward the first platform of its pair that it cannot see a train in.

A train sees one platform at a time, because `sightAhead` follows its `nextTrack`.

1. It sets `nextTrack` to the first platform of its pair and reads `sightAhead` on the next tick.
2. If it sees a train, it switches to the other platform and reads again.
3. If both show a train, it waits.

A train that has just changed `nextTrack` does not accelerate until the next tick, because that tick's `sightAhead` still reports the old path.

This is safe because trains on one entry track arrive in a queue, and trains on different entry tracks never want the same platform.

### Platform sensors switched off

A switched-off platform sensor does two things.

- It stops sending `platformStatus`. A train whose x is between 5500 and 6400 should hear the sensors. If it has no `platformStatus` from a platform newer than `FRESH`, it treats that platform as having no sensor. Further back, hearing no status is normal.
- It reads as occupied in `SensorReadings.platformOccupied`. The station actor never grants that platform. If the other platform of the pair is free, the actor offers it as the alternative.

With every sensor off and the station actor alive, the actor refuses every request. A refusal is a reply, so a train would wait forever. So a train that is refused with no alternative, and has no fresh `platformStatus` from the platforms of its pair, treats the refusal as silence. It uses the station-off rule and creeps.

The station actor cannot tell a dead sensor from a train arriving, or the sensor's return from a train leaving. It must never release a lock while the lock's train could still be on its way in. So a train repeats its platform request after the grant until its front is in the platform, as step 3 of "Entering the station" says. The station actor keeps a lock while it hears those requests. It answers each one with the grant again, never a refusal, even when the train's own front makes the sensor read occupied. A train that holds a platform grant ignores a later refusal for that platform.

### Leaving the station

1. After its dwell time a train sends a `lockRequest` for `JUNCTION` and repeats it every 2 seconds.
2. The merge actor grants one train at a time, oldest request first, lowest ID on a tie. It grants only when `junctionOccupied` is false and `exitStartClear` is true. That stops a train entering the junction when it cannot clear the far side.
3. The merge actor answers every `JUNCTION` request it cannot grant with a `lockRefuse`, on the tick it hears the request, over short range. A refusal is a reply. A train that gets one keeps waiting and keeps asking. Without the refusal, a train waiting behind others would hear nothing for 10 seconds, leave on a clock slot, and could be in the junction zone with a train the merge actor has just granted. The merge actor never refuses the train that holds the lock, and a train that holds the grant ignores any later `JUNCTION` refusal.
4. On a grant the train stops asking, sets `nextTrack` to `EXIT`, departs, and treats the `follow` train as its leader.
5. The merge actor releases the lock when its sensor shows the junction zone is empty again.
6. A grant that is not used runs out. If the junction zone has not become occupied within `MERGE_TIMEOUT` of a grant, the merge actor releases it. This covers a train that breaks down in its platform after being granted. A train that cannot enter the zone within `MERGE_TIMEOUT - REQUEST_REPEAT` of its grant drops the grant and asks again, so it never enters on a grant the actor has released.

### A local actor switched back on

The engine steps a local actor only while its switch is on, so an actor that comes back still has the memory it had when it went off. Trains may have used the fixed split or clock slots in between.

- For `RESUME_SETTLE` seconds after it comes back, an actor grants nothing and refuses every request. A waiting train hears a reply, so it stops falling back.
- The station actor keeps every lock it had. It releases a lock whose train it never saw arrive only if the platform reads empty and the holder stayed silent for the whole settle time.
- The merge actor does not know who last entered EXIT. Its first grant after coming back names the granted train's own ID in `follow`, which the train reads as "leader unknown".
- A platform that read occupied with no lock on it must read empty for `RESUME_SETTLE` before it is granted. A train on the fixed split may still be near it.

### Merge switched off

After 10 seconds without a reply, a train uses clock slots. The 10 seconds count from the later of its first `JUNCTION` request and the last reply it heard from the merge actor. Every train has an accurate clock, so no messages are needed.

```
slot = floor(now / 60) mod 4
platform Pk may start during the first 15 seconds of slot k - 1
```

A train starts only if `sightAhead` shows the junction zone empty. It does not know its leader on EXIT, so it stays at `SIGHT_SPEED` until it hears one.

## Failures the demo can inject

- A switch for the control centre.
- A slider for the share of train-to-train messages dropped. At 100% no train hears another.
- Switches for the station actor, the merge actor and the platform sensors.
- A button to break down a chosen train, which stops it where it is.

## Today's rule, for comparison

A toggle swaps in a baseline. A central controller sees the true state of every train and decides platforms and junction order itself. Each second it sends every train a `permit` over long range, which says how far along the x axis the train may run and which track to take next. A train with no permit for 5 seconds brakes to a stop and waits until permits resume. This lives in `src/baseline/`.

### Radio working

When the centre has been down for `RADIO_WORKING_DELAY` seconds, staff start moving the stopped trains by radio. This is today's "emergency special working". The 20 minutes is from a 2019 Modern Railways article on it.

- Staff release one stopped train every `RADIO_RELEASE_GAP` seconds, the one furthest along first. The time per train is our assumption. No source gives one.
- Staff know where every train is and make the same decisions as the centre. Their permits carry `caution: true`, and a train holding one stays at `SIGHT_SPEED` or below.
- The permits go over the radio, so the radio slider drops them. With the radio fully down, no train moves until the centre is back.
- When the centre comes back it takes over at once.

In the engine, `ControlCentre.radioStep` is called once a second while the centre is switched off. Our trains ignore a permit with `caution: true`. By then they are already running on their own rules, which are faster.

When its permits stop, a baseline train keeps two things from its last permit.

- It keeps its last `nextTrack` while it waits. A train still braking can cross onto its platform, and a null `nextTrack` would end its path at the end of its entry track.
- The `untilX` of its last permit still applies after the permit is stale. A baseline train never goes faster than `safeSpeed` of the distance to that `untilX`, so full braking always stops it at or before that x.

There is one control centre, and it lives in `src/baseline/`. Both train programs get the same permits from it. The baseline is a second train program. It holds no locks, obeys its permits, and stops when they stop. Ours obeys the same permits while they come, and runs on its own rules when they stop.

The centre is today's system, so it never depends on the station actor, the merge actor or our platform sensors. Switching those off changes nothing for the baseline. The centre knows where every train is from its own train detection, which the engine gives it as true sensor readings.

The baseline train also brakes for `sightAhead`, as a driver would. The centre is safe without it.

## Metrics

- Trains per hour leaving the right-hand end of EXIT.
- Average delay per train against the baseline with nothing failed. This is what a passenger on a typical train sees, and it does not grow with the number of trains. A train that never leaves counts at the run length.
- Collisions, meaning two trains overlapping on one track or two trains in the junction zone. This must stay at zero.
- Close calls, meaning a gap under `MARGIN`.

## Folders

| Folder | Holds |
|---|---|
| `src/shared/` | Types, constants, the map and the parameter file |
| `src/engine/` | Clock, physics, radio, timetable, failure switches, metrics |
| `src/scenarios/` | The demo's scenarios, as data only |
| `src/runner/` | Live and batch runs, parameter file runs, and the two programs |
| `src/train/` | The train agent |
| `src/locks/` | Station actor, merge actor, platform sensors |
| `src/baseline/` | The control centre, used by both train programs, and the baseline train agent |
| `src/ui/` | The three.js view, controls, metrics panel |
| `params/` | Example parameter files |

Stack: TypeScript, Vite, three.js for the view, and Vitest for tests. No server.

## Stretch goals

Build these only after the five issues are done.

- Early booking. A train asks the station for a platform over long range before the ask point and adjusts its speed to arrive as the platform frees.
- Borrowing. When the station is off and nearby trains can hear each other, the lowest ID picks first and may take a free platform from the other pair.
- Hazard broadcast. A train that spots a problem tells nearby trains, and only trains heading towards it stop.
- Junction order hints. The control centre suggests a better junction order through its permits.
- A radio kill for one train. Its long-range radio dies and its short-range radio keeps working.
- A switch for a single platform sensor. Without it, the sensors switch off together.
