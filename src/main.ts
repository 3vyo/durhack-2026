import { Engine } from './engine/engine';
import { DEFAULT_TIMETABLE, generateTimetable, runLengthFor } from './engine/timetable';
import { stubOurs } from './runner/stubs';
import { STATION_FRAME, type CameraMode } from './ui/layout';
import { createScene } from './ui/scene';
import { TICK } from './shared/constants';

// Simulated seconds per real second. A first look at the engine, before the live session.
const SPEED = 8;

const app = document.getElementById('app');
if (!app) throw new Error('missing #app');
app.style.cssText = 'position:fixed;inset:0;font-family:system-ui,sans-serif;';

const stage = document.createElement('div');
stage.style.cssText = 'position:absolute;inset:0;';
app.appendChild(stage);

const timetable = generateTimetable(1, DEFAULT_TIMETABLE);
const engine = new Engine({
  timetable,
  program: stubOurs,
  seed: 1,
  runLength: runLengthFor(timetable),
});
const view = createScene(stage, STATION_FRAME);

// Controls are plain HTML, outside the scene.
let mode: CameraMode = 'angled';
const toggle = document.createElement('button');
toggle.style.cssText = 'position:absolute;top:12px;left:12px;padding:8px 12px;font-size:14px;';
const label = (): string => (mode === 'angled' ? 'Camera: angled (switch to overhead)' : 'Camera: overhead (switch to angled)');
toggle.textContent = label();
toggle.addEventListener('click', () => {
  mode = mode === 'angled' ? 'overhead' : 'angled';
  view.setCamera(mode);
  toggle.textContent = label();
});
app.appendChild(toggle);

window.addEventListener('resize', () => view.resize());

let last = performance.now();
let carry = 0;
function frameLoop(now: number): void {
  carry += ((now - last) / 1000) * SPEED;
  last = now;
  while (carry >= TICK) {
    engine.step();
    carry -= TICK;
  }
  view.render(engine.snapshot());
  requestAnimationFrame(frameLoop);
}
requestAnimationFrame(frameLoop);
