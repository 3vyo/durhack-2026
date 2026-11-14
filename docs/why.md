# Why

The case for building the train simulation. How it works is in [design.md](design.md).

## The problem

Britain's signalling is fail-safe by design. If a signal loses power it goes dark, and a driver must not pass it. If the system detects a fault, signals turn red and trains stop. That is the right behaviour for safety, but it means a failure in the control layer stops every train that depends on it, and getting them moving again is slow.

There are two kinds of failure, and they differ in how often they happen and how much damage they do.

## Local failures: frequent, small, costly in aggregate

Signal failures are routine. Network Rail data shows passengers lost 988,419 minutes to signal failures between 2018/19 and mid-2024, and about 190,000 minutes in the 2023/24 financial year alone. These figures count all delay attributed to signal failure, not only failures of a control centre.

Each failure usually hits one signal, section or junction. A train waits at a red signal, and because the network is busy the knock-on delay can be large. One Network Rail shared-learning case: a slug got into an axle counter junction box and shorted a circuit board, causing 52 full cancellations, 10 part cancellations and 377 delay minutes.

The common causes, and how each maps to a failure switch in the demo:

| Real failure | What goes wrong | What the train sees | Demo switch |
|---|---|---|---|
| Train detection | Track circuits fail through corrosion, contamination or flooding. Some axle counters respond poorly to heat, and restart without detecting trains after a power failure. | The system can't tell if a section is clear, so the signal stays red until staff check and reset. | Platform sensors off |
| Points | Debris, ice, drive mechanism failure, or heat expansion. | The protecting signal turns red. Points can sometimes be secured in one position. | Not modelled |
| Power | Loss of the main supply or ageing cable, often in places where cables are older or stolen. | Signals go dark. A power failure can affect systems over a very large area. | Station or merge actor off |
| Telecoms links | Failure of base stations or communication links. | Signals show red with no train present, or no movement authority reaches trains. | Train-to-train radio slider |
| Control centre | The centre loses power or its links, as at Manchester in 2026. | No permits reach any train. | Control centre off |
| Cable theft | Thieves target signalling, telecoms and power cables for scrap. | Any of the above, depending on which cable. | Any |

Most failures are the safe kind: the system fails to red. A rarer and more dangerous kind is the wrong-side failure, where a track circuit makes a train disappear. A dead sensor in the demo must therefore read as occupied, never as empty.

## The major blackout: rare, severe, regional

On 6 August 2026 a power cut hit the area around Network Rail's Manchester Rail Operating Centre at 13:41. The local outage reportedly lasted 90 seconds, but backup systems did not perform as expected and key communication systems had to be reconfigured and replaced. The Manchester centre is the North West's main hub for controlling train movements, so trains stopped across the region and hundreds of services were cancelled. Signalling was not fully restored until late that evening. Trains and crews were left in the wrong places, and some disruption ran into the next morning.

The cause there was power and signalling communications, not the rail radio. The radio is a separate failure mode, and the demo treats it as one.

This is the only clear case of a whole control centre going down that I found. I found no record of how often it happens, so the pitch should call it rare and high-impact and should not quote a frequency.

## The proposal

Show a fallback where trains keep moving safely through an outage. Trains share track through small local locks and fall back to simple rules when the centre or the radio is unavailable.

We pitch it as a layer underneath the central system. It does not replace the control centre. When the centre is healthy it runs the railway as it does today. When it fails, trains degrade to reduced speed instead of stopping.

The model is a ladder of fallbacks, so each step down stays safe and throughput falls gradually.

1. **Healthy.** The control centre sends every train a permit each second, and trains follow them. Each train still runs its own rules and holds its own locks underneath.
2. **Centre lost, local actors alive.** Trains carry on under their own rules with the station and merge locks. This is the best fallback.
3. **Local actors lost too.** Trains use the fixed platform split and clock slots, at `SIGHT_SPEED` or below. The spec caps this at about 60 trains an hour through the junction.
4. **Sensors dead as well.** Trains creep towards a platform they can't see a train in. This only works if a dead sensor reads as occupied.

## How the model answers each failure

**Local failures.** The argument is cost per fault. A single failed sensor or lock should not stop a whole station. Today the section is protected by stopping trains until staff arrive. With steps 2 to 4, trains keep moving at reduced speed. The test is delay minutes against the baseline.

**The blackout.** The argument is blast radius, not smarter trains. One centre failing stops a whole region. Spreading decisions across many small local units means one failure stops one unit. The Manchester backups failed in practice, which supports having a second line of defence that does not depend on the first.

## What the demo should show

Run four scenarios against the baseline, where every train waits for the control centre.

| Scenario | Control centre | Station and merge actors | Train-to-train radio |
|---|---|---|---|
| Local fault | On | One device off | On |
| Centre outage | Off | On | On |
| Blackout, trains talking | Off | Off | On |
| Blackout, trains silent | Off | Off | Off |

- **Local fault.** One trackside device stops working. That is the station actor, the merge actor or the platform sensors.
- **Centre outage.** The control centre is off and the local actors are alive. This is the Manchester case, and it uses the best fallback.
- **Blackout.** The control centre, the station actor and the merge actor are all off. Train-to-train radio is a separate setting, so the blackout has two versions.

"Train-to-train radio off" is the radio slider at 100%, not a second control. With trains silent, every train runs at `SIGHT_SPEED` or below, which is the slowest case the demo shows.

One train losing its long-range radio is an optional second local fault.

For each, report throughput, average delay per train and collisions, using the metrics in design.md. The claims to test:

- Collisions stay at zero in every failure the demo can inject.
- Delay is lower with the fallback than with the baseline in each of the four scenarios.
- Trains recover to normal running when the failure ends, without staff restarting them one at a time.

## When nothing has failed

Ours is the same as the baseline when nothing has failed. While the control centre works, our trains obey its permits exactly as today's trains do, and our own rules stay out of the way. The same holds for any failure that leaves the centre working: the train-to-train radio, the station actor, the merge actor or the platform sensors. The claim of lower delay covers the failures where the centre is down.

## What the demo does not prove

A browser simulation shows the logic works under its own assumptions. It says nothing yet about these, and the pitch should name them honestly.

- **Cheaper alternatives.** Better backup power is cheaper than a new control layer. Network Rail is already rolling out uninterruptible power supplies. The fallback is defence in depth, not a substitute.
- **Today's manual workarounds.** Signallers already have ways to move trains past a failed signal. The model has to beat that degraded working, not "everything stops". I haven't verified how much that already recovers.
- **Power for the local actors.** The blackout case only works if the local actors keep power. If an outage takes down the lineside equipment too, trains are down to step 3 or 4.
- **Points.** Trains choose their own route in the sim. Real points are moved and locked by the signalling that fails in an outage, so a real version needs a safe way to set them without it.
- **Obstacle detection.** The fallback relies on a 300 m sensor that always works, and it lets trains run at 21 m/s (about 47 mph) on that basis. No such sensor is specified in the sim, and a real one would need its own safety case.
- **Braking.** Trains plan at their full braking rate with no reserve, and there is no allowance for low adhesion.
- **Passing dark signals.** The fallback has trains move where today's rules say stop. That needs regulator approval, not just a working simulation.

## How the baseline is chosen

The baseline in the sim is an idealised central controller that knows the true state of every train and stops all trains five seconds after it loses contact. Real lineside signalling works in fixed blocks and lets trains run on to the next signal. The comparison is a model of today's behaviour, not a measurement of it, and any numbers from it should be presented that way.

The controller does not use the station actor, the merge actor or our platform sensors. Those are part of our fallback, so switching them off changes nothing for the baseline. The controller's own train detection is assumed to keep working. A failure of that detection is not modelled.

The baseline and ours are two train programs. Both obey the controller's permits while they come. The baseline stops when they stop. Ours carries on with its own rules, its locks and the local actors.

## Sources

- [ITV, Rail disruption expected into morning after power outage](https://www.itv.com/news/2026-08-06/rail-disruption-expected-into-morning-after-power-outage-grinds-trains-to-halt)
- [Rail Business Daily, Network Rail thanks passengers across North West](https://news.railbusinessdaily.com/network-rail-thanks-passengers-across-north-west-following-manchester-power-outage/)
- [Rail Engineer, North West rail disruption](https://www.railengineer.co.uk/north-west-rail-disruption)
- [Safety Critical Systems Club, How a 90-second power outage sparked chaos](https://scsc.uk/forums/safety-in-the-news/how-a-90-second-power-outage-sparked-chaos-for-rail-commuters)
- [Network Rail media centre, Updated travel advice after signalling outage](https://www.networkrailmediacentre.co.uk/news/updated-travel-advice-after-greater-manchester-rail-disruption)
- [Network Rail, Signals and points failure](https://www.networkrail.co.uk/?p=4046)
- [Network Rail, Signalling failures: common causes](https://www.networkrail.co.uk/?p=57648)
- [Network Rail signalling shared learning, Jan to Jun 2019](https://safety.networkrail.co.uk/safety/industry-groups/ip-signalling-shared-learning/sl19_01_jan-2019-jun-2019)
- [Rail Engineer, Signalling failures: why do we hear about them so much?](https://www.railengineer.co.uk/signalling-failures-why-do-we-hear-about-them-so-much/)
- [Express & Star, Signal failures delayed rail passengers by almost one million minutes](https://www.expressandstar.com/uk-news/signal-failures-delayed-rail-passengers-by-almost-one-million-minutes-since-2018-5775799)
- [Liberal Democrats, A million minutes of rail passenger delays](https://www.libdems.org.uk/news/article/a-million-minutes-of-rail-passenger-delays-due-to-signal-failures)
