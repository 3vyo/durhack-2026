import type { Snapshot } from '../engine/engine';
import { TRACK_LENGTH, TRACK_START } from '../engine/map';
import { isStopped, markersFor, modeColor, toScreenX, type Frame } from './layout';

export interface Minimap {
  render(s: Snapshot): void;
}

/** The whole 12.4 km line, from the left edge of A and B to the end of EXIT. */
const FULL_LINE = { xMin: 0, xMax: TRACK_START.EXIT + TRACK_LENGTH.EXIT };

/** Where the station area is, so the minimap can show which stretch the main view frames. */
const STATION_FROM = 4300;
const STATION_TO = 6600;

function hex(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`;
}

/**
 * A thin strip showing every train on the whole line. A scene frames only the station area,
 * so this is how a judge sees trains approaching and leaving. Plain canvas 2D, outside three.js.
 */
export function createMinimap(canvas: HTMLCanvasElement): Minimap {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d canvas');

  function render(s: Snapshot): void {
    const frame: Frame = { ...FULL_LINE, width: canvas.width };
    const h = canvas.height;
    ctx!.clearRect(0, 0, canvas.width, h);
    ctx!.fillStyle = '#1b222c';
    ctx!.fillRect(0, 0, canvas.width, h);
    ctx!.fillStyle = '#2c3746';
    const from = toScreenX(STATION_FROM, frame);
    ctx!.fillRect(from, 0, toScreenX(STATION_TO, frame) - from, h);
    ctx!.fillStyle = '#3a4658';
    ctx!.fillRect(0, h / 2 - 1, canvas.width, 2);
    for (const m of markersFor(s, frame)) {
      ctx!.fillStyle = hex(modeColor(m.mode));
      ctx!.globalAlpha = isStopped(m.speed) ? 0.45 : 1;
      const w = Math.max(3, m.lengthPx);
      ctx!.fillRect(m.px - w, h / 2 - 5, w, 10);
    }
    ctx!.globalAlpha = 1;
  }

  return { render };
}
