# UI handoff

For whoever builds the screen. It says what exists, what you own, what you must not change, how to check your work, and what is left to do, most important first.

The case for the project is in [why.md](why.md) and the rules are in [design.md](design.md). The plan and the design for the demo are in issue [#26](https://github.com/3vyo/durhack-2026/issues/26), with the agreed decisions in #23, #24 and #33.

## What the demo is

A judge watches two railways side by side on the same seeded timetable: today's system on the left and our fallback on the right. The presenter cuts the control centre live. Today's trains stop and ours keep going. The scoreboard shows delay in minutes, time to normal, and collisions, which must read zero. The point to land is: when the hub goes dark, every train still decides for itself and the railway keeps moving.

## Your part and the boundary

You own `src/ui/` and `src/main.ts`, and you may add things to `src/runner/batch.worker.ts`. You may change how anything looks or is laid out.

Please do not change these without asking, because the engine and your teammates' code depend on them:

- `src/engine/`, `src/shared/`, `src/runner/run.ts`, `live.ts`, `failure.ts`, `src/scenarios/` and `docs/design.md`.
- If the screen needs something the engine does not give you, ask for it. Do not reach into the engine.

Rules that already hold, and tests enforce some of them:

- **The view only reads.** It draws what the engine reports and never changes it. That is what keeps the numbers and the pictures from disagreeing.
- **three.js is imported only in `src/ui/`.** The tests never load it.
- **Labels, controls and numbers are plain HTML outside the scene.** Text inside a three.js scene is hard to read.
- **Put logic in small pure functions** (like `markersFor`, `scoreboardRows`, `describeTrain`) and test them. Leave only drawing in the three.js and DOM code.

## Get it running

Needs Node 22 or newer.

```
git fetch && git switch isa/demo-engine    # until the draft PR #39 merges; then use main
npm install
npm run dev          # the live page, usually at http://localhost:5173
npm test             # all tests
npm run batch        # 50 seeds of each must-have scenario, no screen
npm run demo-check   # drives a real headless Chrome through the demo (see below)
```

Working rules for the repo are in `CLAUDE.md`: branch as `yourname/short-task`, open a pull request, squash merge, and never push to `main`.

## How the pieces fit

```
engine (two copies: baseline and ours)
   |  Snapshot, RunResult
   v
LiveSession  -- steps both engines together, applies button presses to both
   |
   v
src/main.ts  -- the frame loop; turns engine output into what the screen shows
   |-- ui/scene.ts      one three.js scene per side
   |-- ui/minimap.ts    a thin strip showing the whole 12.4 km line
   |-- ui/panel.ts      the page: banner, two columns, scoreboard, buttons
   |-- ui/hud.ts        scoreboard rows as text (pure, tested)
   |-- ui/overlay.ts    the card shown when you click a train (pure, tested)
   `-- ui/layout.ts     metres to scene units, lanes, colours, camera presets (pure, tested)
```

| File | What it does |
|---|---|
| `src/ui/layout.ts` | `Frame` and `STATION_FRAME` (the 4000 to 7000 m stretch the scenes show), `toScreenX`, `laneOf`, `markersFor` (one marker per train), `modeColor`, `isStopped`, `cameraPreset` |
| `src/ui/scene.ts` | `createScene(container, frame)` gives `render(snapshot)`, `setCamera`, `onPick`, `resize`, `dispose`. Tracks, trains, the four device boxes and the camera |
| `src/ui/minimap.ts` | `createMinimap(canvas)` draws every train on the whole line, with the station stretch shaded |
| `src/ui/panel.ts` | `createPanel(root, handlers)` builds the page and returns the stages, minimaps, and `setBanner`, `setRows`, `setCard` |
| `src/ui/hud.ts` | `scoreboardRows(input)` turns numbers into the scoreboard text |
| `src/ui/overlay.ts` | `describeTrain(view)` gives the lines on a train's card |
| `src/main.ts` | Builds a `LiveSession`, the scenes and the panel, runs the frame loop, and wires the buttons |
| `src/runner/batch.worker.ts` | Works out the 50-run averages off the page's thread |

## What the screen reads from the engine

This is the contract. It is stable. Ask before changing it.

- **`LiveSession`** (`src/runner/live.ts`): `baseline` and `ours` (two `Engine`s), `speed`, `paused`, `tick(realSeconds)`, `press(set)`, `restart()`.
- **`engine.snapshot()`** gives `{ now, switches, trains }`. Each train has `id`, `pos`, `x`, `speed`, `mode` (`central`, `full`, `stale` or `blind`), an optional `reason`, `leaderAge`, `permitAge` and `lastGrants`.
- **`engine.result()`** gives `{ runLength, finished, exits, collisions, closeCalls, overruns }`.
- **`switches`** are `centre`, `station`, `merge`, `sensors` (all on or off) and `radioDrop` (0 to 1). A button just calls `session.press({ ... })`.
- **Metrics** are in `src/engine/metrics.ts`: `delaySoFar` and `timeToNormalSoFar` for the live numbers. `main.ts` already uses both.
- **Averages** come from `runBatch` in the worker as a `ScenarioSummary`.

To add a button, add it to `PanelHandlers` in `panel.ts` and call `session.press` from the handler in `main.ts`.

## Check your work

- `npm test` for the pure functions.
- `npm run demo-check` for everything else. It drives a real Chrome, presses the buttons, saves screenshots to `demo-check-out/`, and fails if a check breaks. `npm run demo-check -- --quick` takes about 10 seconds. The full run took 70 seconds here; allow a few minutes on a slower machine. Open the screenshots and look at them. A passing check does not mean it looks right.
- Chrome or Chromium must be installed. Set `CHROME_PATH` if it is somewhere unusual.

## What works today

- Two scenes, a minimap under each, and a scoreboard.
- Buttons to cut and restore the control centre and the radio, a speed selector (1x, 4x, 8x, 16x), pause, restart and a camera switch.
- Trains are coloured by mode and dim when stopped. A switched-off device turns dull red. Clicking a train opens its card.
- The live delay counts trains that have not left yet as overdue, so the baseline does not read zero while stuck. The 50-run averages arrive from the worker.
- The page shows "Run ended" and counts unfinished trains at the run length when the run is over.

## What is still stand-in

- The train, station, merge and baseline programs are stubs until the teammates' versions are plugged in. So **mode colours mean little yet** (the stub ours shows `blind`, which is red), the `reason` line is empty, and the stub baseline collides at the junction.
- The page is fixed to the centre outage and seed 1. The constants `SEED` and `SCENARIO` at the top of `main.ts` set that.

## What to build, most important first

1. **Make it readable from across a room.** This matters most, because judges decide fast.
   - The scoreboard is a small table. Make the headline numbers large: delay for each side, and the difference.
   - Add a legend for the four mode colours. Red and green together are bad for colour-blind viewers, so add a second cue such as a label, a shape or a pattern.
   - Label the tracks, platforms and devices in HTML. Today only the legend line explains the device boxes.
   - Make stopped against moving obvious at a glance. Dimming alone is subtle.
   - Choose the default camera. The overhead view is clearly easier to read than the angled one, and the angled one still has a lot of empty space. This is a decision for the team.
2. **Support the demo flow.** The script is not written yet, so ask the team what it needs. Likely pieces:
   - A scenario picker or guided steps: healthy control, centre outage, then the should-haves.
   - Buttons for the should-have scenarios once the engine supports them: kill the merge actor, cut the local actors, break down a train, and a labelled slow-restart row.
   - A scoreboard row or banner that says which scenario is running.
3. **A results view for the end.** The worker only computes the centre outage averages. The closing slide wants delay saved, time to normal and collisions for every scenario, averaged over many runs.
4. **Presenter mode.** Full screen, no clutter, keyboard shortcuts (space to pause, a key to cut and restore), and a clean state at the start. Also a recorded backup video, in case the live demo fails.
5. **Harden it for the day.** Known rough edges the reviewer found:
   - A selected train stays selected after a restart.
   - The batch worker has no error handler, so a failure leaves the averages missing without a message.
   - There is no WebGL context-loss handling.
   - `LiveSession.tick` does not reject a negative or NaN time.
   - The scoreboard rebuilds its DOM every frame, so its text cannot be selected.
   - The time-to-normal tracking in `main.ts` is loose: a restore without a cut, or a second restore.

## Things to watch

- **Two WebGL scenes can be slow on a weak laptop.** Test on the machine that will present. Software rendering, as in `demo-check`, is the slow case.
- **Do not rely on the dev server for the demo.** Run `npm run build` and serve `dist/` (`npx vite preview`), and test that version.
- **The engine is deterministic.** The same seed and the same button presses give the same run. Use that to repeat a bug.
- **The numbers move when the real programs arrive.** Do not tune anything to the stub values.

## Open decisions

Raise these with the team before spending time on them:

- Which camera opens first.
- The wording of the headings. They are "Today's system" and "Our fallback" now.
- Which scenarios the live demo shows, and in what order.
- Whether the closing results view is a page in the app or a slide.

## Where to ask

- Anything about the engine or the data above: the author of draft PR #39.
- What the pitch needs from the screen: the team, in #26.
- Why a rule is the way it is: `docs/design.md` and `docs/why.md`.
