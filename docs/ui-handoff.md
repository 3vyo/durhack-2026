# UI handoff

For whoever works on the screen next: what is there, how it fits together, and how to check your work. What is left to do is in [ui-improvements.md](ui-improvements.md). The rules are in [design.md](design.md) and the case is in [why.md](why.md).

## What the demo is

Two railways on the same seeded timetable, today's system and our fallback. One fills the window at a time; the switch at the top (or the V key) flips between them. The presenter cuts the control centre live. Today's trains stop, and after 20 minutes staff start moving them by radio, one at a time. Ours keep going on their own rules. Three big numbers at the top show each side's delay per train and the delay saved.

## Run it

Needs Node 22 or newer and Chrome (for the check).

```
npm install
npm run dev                          # the live page, usually http://localhost:5173
npm test                             # every test
npm run batch                        # 50 seeds of every scenario, no screen
npm run batch -- --layout=hub        # the same on one layout: branch, junction (the default), busy or hub
npm run batch -- 10 --layout=all     # 10 seeds on every layout, one block each
npm run demo-check                   # drives the page in headless Chrome, saves screenshots
npm run demo-check -- --quick        # shorter waits
npm run demo-check -- --built        # builds and checks the built copy
npm run demo-check -- --gpu          # uses the graphics card, for a real frame rate
npm run demo-check -- --quality=low  # checks the page as ?quality=low
```

`demo-check` fails on page errors, console errors and failed downloads, presses every control, clicks a real train, and saves screenshots to `demo-check-out/` (git-ignored), including a close-up of our scene. **Open the screenshots and look at them.** A passing check does not mean it looks right.

Present from a built copy: `npm run build`, then `npx vite preview`. The dev server is for development.

## Layouts

The page draws and runs any of the four layouts in [design.md](design.md): `branch`, `junction` (the default), `busy` and `hub`.

- The page address picks the layout: `?layout=hub`. `src/main.ts` reads it first and calls `applyLayout` before anything else is built. A name that is not a layout gives the default.
- The Layout list in the control dock shows the layout in use. Choosing another reloads the page with the new `?layout=`, and keeps the rest of the address, such as `?quality=low`. `parseLayout` and `layoutUrl` in `controls.ts` do this.
- Nothing in `src/ui/` keeps a copy of the layout. Lanes, labels, cameras, scenery and the spawn list read `ENTRIES` and `PLATFORMS` when they are called, so each is right for the layout in use. A scene is built once, for the layout in use at that moment.
- Lanes run P1, A, P2, P3, B, P4, P5, C, P6, P7, D, P8, and EXIT runs down the middle of the lanes the layout has. With one or three lines, EXIT is in line with the middle entry line.
- The way out joins in two stages. Each pair of platforms joins in its entry line's lane over 60 m. Then each pair bends into EXIT at the same angle the default layout uses, about 32 degrees, so a pair further from EXIT takes longer: 360 m for lines A and D of `hub`. `exitJoinLength` in `layout.ts` gives the length, and both the drawn track (`world.ts`) and the trains (`pathAt`) use it.
- `stationFrame()` is the stretch a scene shows for the layout in use. It is `STATION_FRAME` (x 5000 to 6800), made longer on the right for `busy` and `hub` so the whole join is in the picture.
- Both cameras centre on the lanes the layout has. The angled camera backs off in proportion for a layout deeper than the default.
- `demo-check` opens `?layout=hub` and `?layout=branch` near its end and saves an angled and an overhead screenshot of each.
- The 50-run averages come from a worker, which has its own copy of the layout. `src/main.ts` sends it the layout with the scenario (`BatchRequest` in `src/runner/run.ts`).
- `npm run batch` and `npm run sim` name the layout at the top of what they print. A parameter file picks its layout with `"layout"`; `params/layout-branch.json`, `layout-busy.json` and `layout-hub.json` are examples.

## How the pieces fit

```
engine (two copies: baseline and ours)  ->  LiveSession  ->  src/main.ts (frame loop)  ->  src/ui/*
```

The view only reads engine state. three.js is imported only in `src/ui/`, and only in the files marked "three" below. Everything else is pure and tested.

| File | What it does |
|---|---|
| `palette.ts` | The five mode colours, checked together with the data-viz palette checker, and a shape per mode. The one source of mode colours |
| `markers.ts` | The marker over each train, stopped dimming, the legend entries, and drawing the shapes |
| `layout.ts` | The path through the points (`pathAt`, `routeOf`), so each car follows the rails. Real-scale units (0.08 per metre), the frame (`stationFrame()`, x 5000 to 6800 in the default layout), lanes for the layout in use (`laneOf`), the two cameras (a close angled view of `ANGLED_FOCUS`, x 5650 to 6650, opens first; overhead fits the whole frame), label anchors, device sites and looks, `junctionBusy` |
| `assets.ts`, `kit.ts`, `consist.ts`, `rails.ts` | Kenney model paths, loading with a fallback, laying cars end to end, laying track pieces |
| `environment.ts` | The sky, light and fog values, and `?quality=low` |
| `hud.ts` | The scoreboard rows and the three big tiles |
| `controls.ts` | Switch labels, the banner line, the breakdown picker, the lines a train can be spawned on (`entryLines`), and the layout in the page address (`parseLayout`, `layoutUrl`) |
| `overlay.ts` | The lines on a clicked train's card |
| `scene.ts` (three) | One scene per side: trains from the models (boxes if they fail), markers, STOPPED tags, HTML labels, and a free camera (drag to turn, right-drag to slide, scroll to zoom; the camera button resets it) |
| `world.ts` (three) | The fixed scenery: track, platforms, the four device buildings, the junction zone, trees |
| `panel.ts`, `page.css` | The page: the full-window view, and the glass panels over it (title and clock, view switch, delay board, scoreboard, key, minimap, control dock). Keys: V switches view, Space pauses, C cuts or restores the centre, T spawns a train. Double-click a train to break it down. Spawn train adds a train at the start of the chosen line on both sides at once The title says what is down, from the switches (`statusTitle` in controls.ts). 1x speed is 8 simulated seconds a second |
| `minimap.ts` | The whole-line strip at the bottom |

## What the screen reads from the engine

- **`LiveSession`** (`src/runner/live.ts`): `baseline` and `ours`, `speed`, `paused`, `tick`, `press`, `spawn`, `restart`. `spawn(line)` adds a train due now with `Engine.addTrain`. It enters in timetable order on its line, so the next train due there follows it. It is not in the healthy reference run, so it adds traffic but has no delay score of its own. A restart forgets it.
- **`engine.snapshot()`**: `{ now, switches, trains }`. Each train has `id`, `pos`, `x`, `speed`, `mode`, `leaderAge`, `permitAge`, `lastGrants`, and `brokenDown` once broken.
- **Modes**: `central` (obeys the centre), `radio` (a baseline train moved by staff under radio working), `full`, `stale`, `blind`.
- **Switches**: `centre`, `platformKeeper`, `junctionKeeper`, `sensors`, `radioDrop`.
- **Metrics**: `averageDelaySoFar` and `timeToNormalSoFar` in `src/engine/metrics.ts`. The 50-run averages come from `src/runner/batch.worker.ts`.

To add a button, add it to `PanelHandlers` in `panel.ts` and call `session.press` from the handler in `main.ts`.

## Things to watch

- The page opens with `?check` only for `demo-check`, which then reads where the trains are on screen. The page itself never uses it.
- Never scale a train up to make it easier to see. Collisions are judged on true lengths, and a bigger train would look as if it overlapped one it does not. The markers and labels carry the signal.
- Do not change a mode colour without running the palette checker again (the command is at the top of `palette.ts`).
- The engine is deterministic: the same seed and the same presses give the same run. Use that to repeat a bug.
- Measured on an Intel Arc laptop GPU, built copy, both scenes, 16x speed: about 100 to 115 fps in high quality and 120 in low. Measure on the presenting laptop with `--gpu`.
