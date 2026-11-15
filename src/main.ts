import { averageDelaySoFar, timeToNormalSoFar } from './engine/metrics';
import { DEFAULT_TIMETABLE } from './engine/timetable';
import { LiveSession } from './runner/live';
import type { RunResult } from './engine/engine';
import { healthyReference, type ScenarioSummary } from './runner/run';
import { baselineProgram, ourProgram } from './runner/programs';
import { SCENARIOS } from './scenarios/scenarios';
import { statusTitle } from './ui/controls';
import { heroTiles, scoreboardRows } from './ui/hud';
import { describeTrain } from './ui/overlay';
import { DEFAULT_CAMERA, STATION_FRAME, isStopped, type CameraMode } from './ui/layout';
import { createMinimap } from './ui/minimap';
import { NORMAL_SPEED, createPanel, type Side } from './ui/panel';
import { parseQuality, qualityPreset } from './ui/environment';
import { createScene } from './ui/scene';

const SEED = 1;
const SCENARIO = SCENARIOS['centre-outage'];

const app = document.getElementById('app');
if (!app) throw new Error('missing #app');

const session = new LiveSession({
  seed: SEED,
  scenario: SCENARIO,
  programs: { baseline: baselineProgram, ours: ourProgram },
  timetable: DEFAULT_TIMETABLE,
});
// 1x on the page is 8 simulated seconds a second, so a run fits the time a judge watches.
session.speed = NORMAL_SPEED;

// Delay is scored against one reference for both systems: the baseline's healthy run of this
// seed. It is the same checked run the batch uses. If it cannot finish, the page says so and
// shows no delay numbers, because numbers measured against a short run would read too small.
let reference: RunResult | null = null;
let referenceError: string | null = null;
try {
  reference = healthyReference(SEED, baselineProgram, DEFAULT_TIMETABLE);
} catch (error) {
  referenceError = error instanceof Error ? error.message : String(error);
}

let restoredAt: number | null = null;
let average: ScenarioSummary | null = null;
let cameraMode: CameraMode = DEFAULT_CAMERA;
/** The side on show. The other keeps running; only the one on show is drawn. */
let view: Side = 'baseline';

const cameraLabel = (): string => (cameraMode === 'angled' ? 'Camera: angled' : 'Camera: overhead');

const panel = createPanel(app, {
  // Every failure control goes to both engines at the same simulated time.
  onToggle: (key) => {
    const on = !session.ours.snapshot().switches[key];
    session.press({ [key]: on });
    // Time to normal counts from the moment the control centre comes back.
    if (key === 'centre') restoredAt = on ? session.ours.now : null;
  },
  onRadioDrop: (drop) => session.press({ radioDrop: drop }),
  onSpeed: (speed) => {
    session.speed = speed;
  },
  onPause: () => {
    session.paused = !session.paused;
    panel.setPauseLabel(session.paused);
  },
  onRestart: () => {
    session.restart();
    restoredAt = null;
  },
  onView: (side) => {
    view = side;
    panel.setView(side);
    // A hidden view had no size, so give it the window's now.
    (side === 'baseline' ? baselineView : oursView).resize();
  },
  onCamera: () => {
    cameraMode = cameraMode === 'angled' ? 'overhead' : 'angled';
    baselineView.setCamera(cameraMode);
    oursView.setCamera(cameraMode);
    panel.setCameraLabel(cameraLabel());
  },
});
panel.setCameraLabel(cameraLabel());

// ?quality=low turns off shadows and trees, for a weak laptop.
const quality = qualityPreset(parseQuality(location.search));
const baselineView = createScene(panel.baselineStage, STATION_FRAME, quality);
const oursView = createScene(panel.oursStage, STATION_FRAME, quality);
panel.setView(view);
// One camera for both views: moving either one moves the other to match.
baselineView.onCameraMove((pose) => oursView.setPose(pose));
oursView.onCameraMove((pose) => baselineView.setPose(pose));

// Click a train to see how it is deciding. Each scene keeps its own selection.
const selected: { baseline: number | null; ours: number | null } = { baseline: null, ours: null };
baselineView.onPick((id) => {
  selected.baseline = id;
});
oursView.onPick((id) => {
  selected.ours = id;
});
// Double-click a train to break it down, on both sides at once. A train that has already left
// one side is gone there, so that side is unchanged.
for (const v of [baselineView, oursView]) {
  v.onDoublePick((id) => {
    session.baseline.breakDown(id);
    session.ours.breakDown(id);
  });
}
// The demo check (scripts/demo-check.mjs) opens the page with ?check and reads where the
// trains are, so it can click a real one. The page never reads this itself.
if (new URLSearchParams(location.search).has('check')) {
  (window as unknown as { demoCheck: unknown }).demoCheck = {
    trainPoints: () => (view === 'baseline' ? baselineView : oursView).trainScreenPoints(),
    brokenDown: (id: number) => session.ours.snapshot().trains.some((t) => t.id === id && t.brokenDown === true),
  };
}
const baselineMap = createMinimap(panel.baselineMinimap);
const oursMap = createMinimap(panel.oursMinimap);
window.addEventListener('resize', () => {
  baselineView.resize();
  oursView.resize();
});

// The many-run averages come from a worker so the demo never freezes while they are worked out.
const worker = new Worker(new URL('./runner/batch.worker.ts', import.meta.url), { type: 'module' });
worker.addEventListener('message', (e: MessageEvent<ScenarioSummary>) => {
  average = e.data;
});
worker.postMessage({ scenario: SCENARIO.id });

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function draw(): void {
  const base = session.baseline.snapshot();
  const ours = session.ours.snapshot();
  if (view === 'baseline') {
    baselineView.render(base);
    baselineMap.render(base);
    oursView.observe(ours);
  } else {
    oursView.render(ours);
    oursMap.render(ours);
    baselineView.observe(base);
  }
  for (const [side, snap] of [['baseline', base], ['ours', ours]] as const) {
    const train = snap.trains.find((t) => t.id === selected[side]);
    panel.setCard(side, train ? describeTrain(train) : null);
  }

  const b = session.baseline.result();
  const o = session.ours.result();
  const sw = ours.switches;
  panel.setSwitches(sw);
  if (referenceError !== null || reference === null) {
    panel.setBanner(statusTitle(sw), `${clock(ours.now)} | Cannot score this run: ${referenceError}`);
    panel.setRows([]);
    return;
  }
  // The engine stops at the last whole tick, so compare with a little room for rounding.
  const ended = ours.now >= o.runLength - 1e-6;
  const ttn = (run: RunResult, now: number): { seconds: number | null; capped: boolean } => {
    if (restoredAt === null) return { seconds: null, capped: false };
    const value = timeToNormalSoFar(run, reference!, restoredAt, now);
    // When the run is over, a train that never got back on time is shown at the run length.
    if (value === null && ended) return { seconds: Math.max(0, run.runLength - restoredAt), capped: true };
    return { seconds: value, capped: false };
  };
  const baseTtn = ttn(b, base.now);
  const oursTtn = ttn(o, ours.now);
  const stuck = (run: RunResult): number => reference!.exits.size - [...reference!.exits.keys()].filter((id) => run.exits.has(id)).length;
  panel.setBanner(statusTitle(sw), `${clock(ours.now)}${ended ? ' | Run ended' : ''}`);
  const delaySeconds = {
    baseline: averageDelaySoFar(b, reference, base.now),
    ours: averageDelaySoFar(o, reference, ours.now),
  };
  const stoppedOn = (trains: Array<{ speed: number }>): number => trains.filter((t) => isStopped(t.speed)).length;
  panel.setTiles(heroTiles({ delaySeconds, stopped: { baseline: stoppedOn(base.trains), ours: stoppedOn(ours.trains) } }));
  panel.setRows(
    scoreboardRows({
      through: { baseline: b.exits.size, ours: o.exits.size },
      delaySeconds,
      timeToNormalSeconds: { baseline: baseTtn.seconds, ours: oursTtn.seconds },
      timeToNormalCapped: { baseline: baseTtn.capped, ours: oursTtn.capped },
      stillOnLine: ended ? { baseline: stuck(b), ours: stuck(o) } : null,
      collisions: { baseline: b.collisions, ours: o.collisions },
      closeCalls: { baseline: b.closeCalls, ours: o.closeCalls },
      avg: average,
    }),
  );
}

// Cap the real time passed in, so a tab that was in the background does not run a burst of steps.
const MAX_FRAME_SECONDS = 0.1;
let last = performance.now();
function frame(now: number): void {
  session.tick(Math.min((now - last) / 1000, MAX_FRAME_SECONDS));
  last = now;
  draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
