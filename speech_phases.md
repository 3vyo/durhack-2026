# speech_phases

2026-11-15

## Overview

This plan is how we run the demo, built on the run sheet in the demo brief. Ugradar drives the keys and explains what the screen shows. Isa tells the story and ties each moment back to the problem. A phase ends when its trigger happens on screen, not on a clock.

| Phase | Key | What the screen shows | Ugradar | Isa |
|---|---|---|---|---|
| 1. Today's system, healthy | none | Blue squares (central mode), trains flowing | Names what the squares and title mean | Manchester story and why it matters |
| 2. Cut the centre | C | Title turns "Control centre down"; today's trains stop 5 s later (blind diamond plus STOPPED tag) | Explains the 5 s permit timeout | Frames the stranded passengers |
| 3. The reveal | V, then L | Green circles on our side; grants and train-ahead lines drawn | Walks through one train's decisions | Says what is different in plain words |
| 4. Restore the centre | C | Our trains return to blue squares on the next tick; delay board | Reads the delay board | A layer underneath, not a replacement |
| 5. Go down the ladder, hand over | C, then switches, double-click, T | Both keepers off, radio loss 100%, a broken-down train, a spawned train | Operates each failure and names the backup rule | Invites judges to try their own cases |
| 6. Future plans and close | none | Final frame | Hardware and technical next steps | Product, first customer, closing line |

Keys: V switches view, C cuts or restores the centre, L draws grants and train-ahead lines, Space pauses, T spawns a train, Esc closes the Show menu, double-click breaks down a train. At 1x the sim runs 8 simulated seconds per real second. The page is fixed to the centre-outage scenario, seed 1, and nothing fails until a key is pressed.

## Before the demo

Taken from the checklist in the demo brief. Tick these off before we go on.

- [ ] Tests pass (1870 in 53 files) and the centre-outage parameter file runs clean.
- [ ] The 50-seed batch passes (9 scenarios, no collisions).
- [ ] Demo-check is at 36/37: the Show menu test expects 7 boxes but #76 added an 8th. Fix the test or know why it fails.
- [ ] Measure the frame rate on the demo laptop with `--gpu`.
- [ ] Record a backup video of the full run in case the live demo fails.
- [ ] PR #78 is not merged. Decide whether it is in the demo build.
- [ ] Present from `npm run build` and `npx vite preview`, not the dev server.
- [ ] Know what is not there: no scenario picker, no results view, and slow restart works only from a parameter file.
- [ ] Rehearse once with Isa speaking and Ugradar on the keys, so Isa never reaches for the keyboard.

## Phase 1: open on today's system, healthy, and tell the Manchester story

Key: none. The screen opens on today's system with the centre working, so every train is a blue square (central mode). The page is fixed to seed 1 and nothing fails until we press a key.

**Ends when:** about 8 trains are in the station. That is the busy moment the run sheet cuts the centre at.

- **Isa:** the Manchester story. On 6 August 2026 a power cut at 13:41 (Harpurhey) hit the Manchester control centre, and trains stopped across the North West. Network Rail says signalling was fully restored late that evening, with disruption into the next morning. Say clearly that Manchester is our motivation, and that we understand the current model and its flaws and built a system in response. The 90-second figure is only "reportedly", so use that word.
- **Ugradar:** what the screen means. Blue squares are trains obeying the control centre's permits, one a second. The title shows the centre's state. While the centre works, nothing else we can break (radio, keepers, sensors) affects either side.
- **Railway link:** one sentence from Ugradar that when the centre or radio fails, today's rule is that every train in the area stops until staff restart them one at a time.

## Phase 2: press C to cut the centre and let today's trains stop

Key: C. The title turns to "Control centre down". Five seconds later (the permit timeout) today's trains stop, shown as the blind diamond plus a STOPPED tag.

**Ends when:** every train on today's side is stopped. Pause with Space if the room needs a moment to look.

- **Ugradar:** say what just happened. Permits stop, a train holding no permit under 5 seconds old brakes to a stop, and today's trains wait. Point out that the blind diamond on today's side means no permit, not a broken train.
- **Isa:** put passengers on that screen. Every stopped square is a full train. Staff move them by radio one at a time, and that cannot start until about 20 minutes after the outage and needs the radio working.
- **Do not** switch view yet. Let the stopped screen sit for a beat before the reveal.

## Phase 3: press V for the reveal, then L to draw the grants and train-ahead lines

Keys: V, then L. V switches to our side, where trains are green circles (full mode) and keep moving after the same cut. L draws the lock grants and the train-ahead lines.

**Ends when:** the room has seen our trains moving while today's stayed stopped, and one grant and one train-ahead line have been pointed at.

- **Ugradar:** the single driving rule. Each train follows the train ahead and brakes so it can always stop before it. At the ask point (x=4800) it asks the platform keeper for a platform, and silence means no. Then point at one grant line and one train-ahead line with L on.
- **Isa:** the same idea in plain words. The platform keeper is a booking desk that gives out one platform at a time. The junction keeper is a set of traffic lights that lets one train through the shared zone. Neither needs the control centre, and neither is a new central brain.
- **Honest framing (Isa):** this is not an alternative to the centre. While the centre works, our trains obey it exactly as today's do. Our rules take over only after 5 seconds of silence.

## Phase 4: press C to restore the centre and read the delay board

Key: C. At about 2 minutes of simulated outage the centre comes back. Our trains return to blue squares on the next tick, because they obey permits again and drop their own rules.

**Ends when:** the delay board has been read and the point has landed.

- **Ugradar:** read the board. Seed 1 with the centre down for 2 minutes: today's trains lose 1.8 minutes each on average and take 859 seconds to get back to normal. Ours lose 0.0 and take 238 seconds. Across 50 seeds, centre outage gives delay of 1.4 against 0.0 minutes, and time to normal of 12.4 against 2.2 minutes.
- **Ugradar, if asked:** 900 batch runs, zero collisions and zero close calls in both programs.
- **Isa:** the product line. Our trains are a layer underneath the centre. It is not a replacement, and while the centre works they do exactly what today's trains do.
- **Caveat to say once:** slow restart is off by default and its 60 seconds per train is our assumption, so the gap would be wider if staff restart trains one at a time.

## Phase 5: re-cut the centre, go down the ladder and hand the controls to the judges

Keys: C again, then the failure switches, double-click on a train, and T. This phase is "if time" in the brief. Cut the centre first: while the centre works, no other failure changes anything, so a judge who switches off a keeper first will see nothing happen.

**Ends when:** the judges have the controls, or we are told time is up.

| Failure | Press or switch | What our trains do | Who says it |
|---|---|---|---|
| Platform keeper off | Switch in the dock | After 10 s of silence, use the fixed split: each line takes its own platform pair, lowest number first, if the sensor shows empty | Ugradar |
| Junction keeper off | Switch in the dock | After 10 s, use clock slots so only one train starts at a time | Ugradar |
| Platform sensors off | Switch in the dock | Creep toward the first platform of their pair that they cannot see a train in | Ugradar |
| Radio loss 100% | Slider | No train hears another, so they follow what they can see and stay at or below 21 m/s | Ugradar |
| Break down a train | Double-click it | It stops where it is, the train behind brakes for it | Ugradar |
| Spawn a train | T | A new train joins the queue | Ugradar |

The four-layer ladder, shown as the visual for this phase:

| Layer | Today's system | With ours |
|---|---|---|
| 1 | The control centre | The control centre |
| 2 | | Our trains' own rules, 5 seconds after the centre goes quiet |
| 3 | Radio working, about 20 minutes after the outage | Radio working, which our trains do not need in the sim |
| 4 | Nothing moves | Nothing moves |

- **Isa:** invite the judges to pick a failure and try their own case. Say it plainly: each failure we turn off, the trains fall one layer down the ladder and keep moving, and only layer 4 stops them.
- **Handover:** Ugradar steps back from the keys. Isa says which key does what, and Ugradar answers from beside the laptop.

## Phase 6: future plans and the closing line

Key: none. This phase starts when the judges are done with the controls, or when we stop the demo.

- **Isa:** what a product looks like. Name the components we would claim, who the first customer would be, and how someone reaches the simulation to try their own case. These are open questions, listed at the end of this doc, so fill them in before we present.
- **Ugradar:** the technical next steps, including the hardware a real fallback layer would need. Stretch goals from the design (early booking, borrowing a platform, hazard broadcast, junction order hints) are the safe examples.
- **Closing line (Isa, draft):** Manchester showed what happens when one central system goes quiet. We are not replacing it. We are the layer that keeps trains moving until it comes back.
- **Last action:** leave the screen on the delay board, not on a failure.

## Handoffs, talking rules and Q&A

**Talking rules**

- Ugradar speaks while he is on the keys. Isa speaks between key presses and never touches the keyboard.
- Say "reportedly" for the 90-second power cut. Say "Network Rail says" for the restoration times.
- Say we are a layer underneath the centre, never a replacement, and Manchester is our motivation. Our claim is that we understand the current model and its flaws and built a system in response.
- Quote the batch as "900 runs, zero collisions", not "100% safe".
- The baseline's radio working delay (20 minutes) comes from a 2019 Modern Railways article. The 60 seconds per release is our assumption, and we say so.

**Judge questions from the demo brief.** The answers below are drawn from the design doc, so check them against the brief's wording before we present.

| Question | Owner | Answer |
|---|---|---|
| What if backup power was supposed to cover this? | Isa | We do not claim to fix power. We assume the centre can fail for any reason, and ask what the trains do next. |
| Are you replacing the control centre? | Isa | No. We are a layer underneath. While the centre works our trains obey it exactly as today's do. |
| What if the keepers lose power too? | Ugradar | Trains fall back: the fixed split without the platform keeper, clock slots without the junction keeper, creeping without sensors. The blackout scenarios cover this. |
| What about points and a real network? | Ugradar | The map is deliberately simple: left to right, one junction zone, one exit. The rules rely on that, so this is a proof of the idea, not a full network model. |
| Why does the 300 m sensor matter? | Ugradar | A train sees 300 m ahead. 21 m/s is the fastest speed that can stop within 250 m of that, so it can always stop. |
| Is the baseline fair? | Ugradar | Same timetable, same seed, same permits. Today's trains obey permits and stop when they stop. |
| Where does the 20 minutes come from? | Ugradar | A 2019 Modern Railways article on emergency special working. The per-train release time is our assumption. |
| Can it crash? | Ugradar | Across 900 batch runs there were zero collisions and zero close calls, and the test suite has 1870 tests. It is still a simulation. |

## What changed and what is still open

**Changed from the last version**

- Rebuilt around the demo brief's run sheet: six phases keyed to what is pressed and what appears, replacing the five speech phases.
- Judges must cut the centre before any other failure does anything.
- Each failure now has its backup rule written beside it.
- Added the booking-desk and traffic-lights analogies, the four-layer ladder table, and the blind-diamond callout on today's side.
- Phases end on triggers, not times, and metrics stay light.

**Still open**

- The run sheet restores the centre at about 2 minutes of simulated time. Do we instead hold the outage until the radio working markers appear, for the long-outage variant?
- Wording to confirm: "Manchester's backups failed", "Network Rail is already adding it" and the 90-second figure are all "reportedly" claims. Keep them hedged or cut them.
- The pre-demo checklist items: demo-check 36/37, frame rate, backup video and PR #78.
- Which product components do we claim, and who is the first customer?
- How do judges reach the simulation: a link or a QR code?
- Does Ugradar say the railway lines in Phase 1, or does Isa?
- Did "phases" earlier mean the speech phases only? This version assumes yes.

## Draft speech

Spoken lines, in order, as bullets to say in our own words. Isa is **I**, Ugradar is **U**. Square brackets are actions, not speech.

**Phase 1: today's system, healthy**

- **I:** We all commute into university by train. When something goes wrong, there is nothing you can do except wait and refresh an app.
- **I:** On 6 August, reportedly 90 seconds without power at the Manchester control centre stopped trains across the North West. Network Rail says signalling was not fully restored until late that evening.
- **I:** We understand how the current model works and where it fails: every decision sits in one place, a single point of failure. So we built a fallback layer that lets trains decide for themselves when that place goes quiet, and keeps them moving safely. Here is what it does.
- **U:** This is today's system. Every blue square is a train obeying the control centre, which sends it a permit every second.
- **U:** The title shows the state of the centre. Right now it is working and everything flows.
- **U:** Today's rule is simple. If the centre or the radio fails, every train in the area stops until staff restart them one at a time.

**Phase 2: cut the centre**

- **I:** About eight trains are in the station, so this is a busy moment. Ugradar is going to cut the centre. [U presses C]
- **U:** The title now says control centre down. A train with no permit under five seconds old brakes to a stop, so in five seconds they all stop.
- **U:** The diamond with a STOPPED tag means no permit, not a broken train.
- **I:** Every one of those squares is a full train. Staff can move them by radio, but that starts about twenty minutes after the outage and needs the radio working.

**Phase 3: the reveal**

- **I:** Now the same moment, same trains, same failure, with our rules. [U presses V]
- **U:** The green circles are our trains. They lost the centre too, and they are still moving. [U presses L]
- **U:** There is one driving rule: follow the train ahead and brake so you can always stop behind it. Here is a train-ahead line.
- **U:** At the ask point a train asks the platform keeper for a platform. Here is a grant. If it hears nothing, silence means no, and it stops.
- **I:** Think of the platform keeper as a booking desk that gives out one platform at a time, and the junction keeper as traffic lights for the shared zone.
- **I:** Neither is a new central brain. And this is not a replacement for the centre. While the centre works, our trains obey it exactly as today's do. Our rules only take over after five seconds of silence.

**Phase 4: restore the centre**

- **I:** The centre comes back. [U presses C]
- **U:** Our trains are blue squares again on the next tick. They obey permits and drop their own rules.
- **U:** On this run, with the centre down for two minutes, today's trains lose 1.8 minutes each and take 859 seconds to get back to normal. Ours lose 0.0 and take 238 seconds.
- **U:** Across 50 seeds of this scenario, delay is 1.4 minutes against 0.0, and time to normal is 12.4 minutes against 2.2. In 900 batch runs there were no collisions.
- **I:** So it is a layer underneath the centre. It does nothing until the centre is gone.

**Phase 5: the ladder and the handover (if time)**

- **I:** We want you to try to break it. First cut the centre, because while it works, nothing else you switch off changes anything.
- **U:** Without the platform keeper, trains use a fixed split after ten seconds, each line taking its own pair of platforms.
- **U:** Without the junction keeper, they use clock slots so one train goes at a time.
- **U:** Without the sensors, they creep towards a platform they can see is empty. With the radio at 100% loss, they follow what they can see and stay slow.
- **U:** Double-click any train to break it down, and the train behind brakes. T adds a train.
- **I:** Each failure drops the trains one layer down the ladder, and they keep moving. Only the last layer stops them. [U steps back from the keys]

**Phase 6: future plans and close**

- **I:** We want to explore this at a smaller scale first, in logistics, building software for the people who need it. Logistics has the same shape as the track, and so does any system where many moving units depend on one coordinator. The purpose is the same as on the track: keep things moving safely without waiting for a control centre.
- **U:** Next steps are the hardware a real fallback layer needs, plus early booking of platforms, borrowing a platform, hazard broadcast and junction order hints.
- **I:** Manchester showed what happens when one central system goes quiet. We are not replacing it. We are the layer that keeps trains moving until it comes back. Thank you.
