import { delaySoFar, timeToNormalSoFar } from './engine/metrics';
import { DEFAULT_TIMETABLE } from './engine/timetable';
import { LiveSession } from './runner/live';
import type { RunResult } from './engine/engine';
import { healthyReference, type ScenarioSummary } from './runner/run';
import { stubBaseline, stubOurs } from './runner/stubs';
import { SCENARIOS } from './scenarios/scenarios';
import { scoreboardRows } from './ui/hud';
import { describeTrain } from './ui/overlay';
import { STATION_FRAME, type CameraMode } from './ui/layout';
import { createMinimap } from './ui/minimap';
import { createPanel } from './ui/panel';
import { createScene } from './ui/scene';

const SEED = 1;
const SCENARIO = SCENARIOS['centre-outage'];

const app = document.getElementById('app');
if (!app) throw new Error('missing #app');

const session = new LiveSession({
  seed: SEED,
  scenario: SCENARIO,
  programs: { baseline: stubBaseline, ours: stubOurs },
  timetable: DEFAULT_TIMETABLE,
});

// Delay is scored against one reference for both systems: the baseline's healthy run of this
// seed. It is the same checked run the batch uses. If it cannot finish, the page says so and
// shows no delay numbers, because numbers measured against a short run would read too small.
let reference: RunResult | null = null;
let referenceError: string | null = null;
try {
  reference = healthyReference(SEED, stubBaseline, DEFAULT_TIMETABLE);
} catch (error) {
  referenceError = error instanceof Error ? error.message : String(error);
}

let restoredAt: number | null = null;
let average: ScenarioSummary | null = null;
let cameraMode: CameraMode = 'angled';

const cameraLabel = (): string =>
  cameraMode === 'angled' ? 'Camera: angled (switch to overhead)' : 'Camera: overhead (switch to angled)';

const panel = createPanel(app, {
  onCutCentre: () => {
    session.press({ centre: false });
    restoredAt = null;
  },
  onRestoreCentre: () => {
    session.press({ centre: true });
    restoredAt = session.ours.now;
  },
  onCutRadio: () => session.press({ radioDrop: 1 }),
  onRestoreRadio: () => session.press({ radioDrop: 0 }),
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
  onCamera: () => {
    cameraMode = cameraMode === 'angled' ? 'overhead' : 'angled';
    baselineView.setCamera(cameraMode);
    oursView.setCamera(cameraMode);
    panel.setCameraLabel(cameraLabel());
  },
});
panel.setCameraLabel(cameraLabel());

const baselineView = createScene(panel.baselineStage, STATION_FRAME);
const oursView = createScene(panel.oursStage, STATION_FRAME);
// Click a train to see how it is deciding. Each scene keeps its own selection.
const selected: { baseline: number | null; ours: number | null } = { baseline: null, ours: null };
baselineView.onPick((id) => {
  selected.baseline = id;
});
oursView.onPick((id) => {
  selected.ours = id;
});
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
  baselineView.render(base);
  oursView.render(ours);
  baselineMap.render(base);
  oursMap.render(ours);
  for (const [side, snap] of [['baseline', base], ['ours', ours]] as const) {
    const train = snap.trains.find((t) => t.id === selected[side]);
    panel.setCard(side, train ? describeTrain(train) : null);
  }

  const b = session.baseline.result();
  const o = session.ours.result();
  const sw = ours.switches;
  if (referenceError !== null || reference === null) {
    panel.setBanner(`${SCENARIO.title}: today's system against our fallback`, `Cannot score this run: ${referenceError}`);
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
  panel.setBanner(
    `${SCENARIO.title}: today's system against our fallback`,
    `Control centre ${sw.centre ? 'ON' : 'OFF'}  |  Radio loss ${Math.round(sw.radioDrop * 100)}%  |  Time ${clock(ours.now)}${ended ? '  |  Run ended' : ''}`,
  );
  panel.setRows(
    scoreboardRows({
      through: { baseline: b.exits.size, ours: o.exits.size },
      delaySeconds: {
        baseline: delaySoFar(b, reference, base.now),
        ours: delaySoFar(o, reference, ours.now),
      },
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
