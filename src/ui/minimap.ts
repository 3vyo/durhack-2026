import type { Snapshot } from '../engine/engine';
import { TRACK_LENGTH, TRACK_START } from '../shared/map';
import { STATION_FRAME, isStopped, markersFor, toScreenX, type Frame } from './layout';
import { drawShape, markerSpec } from './markers';

export interface Minimap {
  render(s: Snapshot): void;
}

/** The whole 12.4 km line, from the left edge of A and B to the end of EXIT. */
const FULL_LINE = { xMin: 0, xMax: TRACK_START.EXIT + TRACK_LENGTH.EXIT };


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
    // Shade exactly the stretch the scene above shows.
    const from = toScreenX(STATION_FRAME.xMin, frame);
    ctx!.fillRect(from, 0, toScreenX(STATION_FRAME.xMax, frame) - from, h);
    ctx!.fillStyle = '#3a4658';
    ctx!.fillRect(0, h / 2 - 1, canvas.width, 2);
    // Each train is its mode's shape, so the minimap reads without colour too.
    for (const m of markersFor(s, frame)) {
      const spec = markerSpec(m.mode, isStopped(m.speed));
      ctx!.globalAlpha = spec.opacity;
      const w = Math.max(3, m.lengthPx);
      drawShape(ctx!, spec.shape, m.px - w / 2, h / 2, Math.min(h / 2 - 3, 7), spec.css);
    }
    ctx!.globalAlpha = 1;
  }

  return { render };
}
