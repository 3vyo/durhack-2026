# UI improvements

What the screen does now, and what is left. How to work on it is in [ui-handoff.md](ui-handoff.md).

## The story in 60 seconds

When a control centre fails, every train depending on it stops. On 6 August 2026 a 90-second power cut at the Manchester control centre stopped trains across the North West for the rest of the day. Our trains obey the control centre while it works, exactly like today's. When it fails they keep moving on their own rules, five seconds later, instead of waiting about 20 minutes for staff to start moving them by radio.

Headline: **"When the hub goes dark, every train still decides for itself, and the railway keeps moving."**

## Done

- **Readable from across a room.** Three big tiles show each side's delay per train so far and the delay saved, with how many trains are stopped on each side. Delay is the hero number. Time to normal stays in the table.
- **Modes without relying on colour.** Five checked colours, each with its own shape: central square, radio hexagon, full circle, stale triangle, blind diamond. Stopped trains dim and carry a STOPPED tag. A legend explains every mode and the junction zone.
- **The look.** Kenney Train Kit subway units and track (CC0), platform islands with a shelter, a building for the control centre and each keeper, a sensors post, lamps that go out when a device is switched off, the junction zone lit while a train is in it, a sky, ground, fog, trees, and shadows.
- **Real scale.** 0.08 scene units per metre, so trains are their true length. The frame is x 5000 to 6800.
- **Camera.** The page opens in a close angled 3D view of the station (x 5,500 to 6,500 m, 30 degrees above the horizon), where the trains read as models. The button switches to the overhead overview, which fits the whole frame to the canvas whatever its shape.
- **Labels.** Tracks and devices are labelled in HTML over each scene.
- **Full-window view.** One side fills the window at a time, with a switch at the top. The title and clock, the delay board, the scoreboard, a one-row key, the minimap and the control dock float over it in small glass panels. Failure switches read as signal lamps. Keys: V, Space, C.
- **Free camera, double-click to break down, a live title.** Drag to turn the camera, right-drag to slide, scroll to zoom. Double-click a train to break it down. The title says what is down right now. 1x speed is 8 simulated seconds a second.
- **Trains follow the points.** Each entry line splits where it ends and bends into its platforms. The way out joins in two stages: each pair of platforms, then the two pairs into EXIT. Every car is placed on that path on its own, so a train bends through the points.
- **Every failure control.** Switches for the centre, both keepers and the sensors, a radio-loss slider, and a breakdown picker. Each acts on both sides at once.
- **A safety net.** Trains fall back to boxes if a model fails to load. `?quality=low` turns off shadows and trees.
- **A check.** `npm run demo-check` drives the page in Chrome, including the built copy and the real GPU.

## Left to do, most useful first

1. **Demo flow.** The page is fixed to the centre outage and seed 1 (`SEED` and `SCENARIO` in `src/main.ts`). A scenario picker, or guided steps, would let the presenter show healthy running first, then the outage, then the long outage where radio working starts.
2. **A results view.** The closing moment wants delay saved and collisions for every scenario. The worker only averages the centre outage. `npm run batch` already has the numbers for all nine scenarios.
3. **Presenter mode.** Full screen, keyboard shortcuts (space to pause, keys to cut and restore), and a recorded backup video of a clean run.
4. **Hardening:**
   - A selected train stays selected after a restart.
   - The batch worker has no error handler, so if it fails the averages never appear.
   - There is no handling for a lost WebGL context.
   - `LiveSession.tick` does not reject a negative or NaN time.
   - The scoreboard table rebuilds its rows every frame, so its text cannot be selected.
   - Time to normal on the live page counts only from the control centre coming back. Other restores do not start it.
5. **The `reason` line.** A train's card has no "why" line until the shared types gain an optional `reason` on a train's output.
6. **Slow restart.** It can be turned on from a parameter file (`timers.restartGap`). The page has no row for it yet. Its label must say that the time per train is our assumption.

## Decisions on record

- Kenney Train Kit subway unit, native units and the x 5000 to 6800 frame: chosen by the project owner.
- Both camera views, the close angled view first and overhead as the overview: chosen by the project owner, so the screen reads as 3D when it opens.
- The #51 failure controls stay: chosen by the project owner.
- The `radio` mode and its purple hexagon: chosen by the project owner, so radio working shows apart from the control centre.
- Today's system on the left, ours on the right, same timetable, same failures.
- Labels, controls and numbers are plain HTML outside the scene.
