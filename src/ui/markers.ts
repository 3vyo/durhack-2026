import { MODES, MODE_STYLE, type MarkerShape, type Mode } from './palette';

// What the shape marker over each train looks like, and the legend that explains them. Pure:
// no three.js, so the tests can load it. scene.ts turns a spec into a sprite, the minimap draws
// the same shapes small, and the legend draws them as SVG.

export interface MarkerSpec {
  shape: MarkerShape;
  hex: number;
  css: string;
  opacity: number;
  /** True for a stopped train. The scene draws a STOPPED tag under its marker. */
  stopped: boolean;
}

/** How much a stopped train's marker fades. It keeps its colour, so its mode still reads. */
export const STOPPED_MARKER_OPACITY = 0.55;

/** The marker over a train in this mode. */
export function markerSpec(mode: Mode, stopped: boolean): MarkerSpec {
  const style = MODE_STYLE[mode];
  return { shape: style.shape, hex: style.hex, css: style.css, opacity: stopped ? STOPPED_MARKER_OPACITY : 1, stopped };
}

/** What to multiply a train body's colour by, so stopped trains look dimmer than moving ones. */
export function bodyDim(stopped: boolean): number {
  return stopped ? 0.45 : 1;
}

export interface LegendItem {
  mode: Mode;
  label: string;
  css: string;
  shape: MarkerShape;
  meaning: string;
}

/** One legend entry per mode, in the order of MODES. */
export function legendItems(): LegendItem[] {
  return MODES.map((mode) => {
    const s = MODE_STYLE[mode];
    return { mode, label: s.label, css: s.css, shape: s.shape, meaning: s.meaning };
  });
}

/**
 * The outline of a shape centred on (0, 0) with the given radius, as a list of points. A
 * circle has none, so the caller draws an arc. Every shape fills about the same area, so no
 * mode looks more important than another.
 */
export function shapePoints(shape: MarkerShape, r: number): Array<[number, number]> {
  switch (shape) {
    case 'circle':
      return [];
    case 'square': {
      const s = r * 0.86;
      return [[-s, -s], [s, -s], [s, s], [-s, s]];
    }
    case 'hexagon':
      return Array.from({ length: 6 }, (_, i) => {
        const a = (Math.PI / 3) * i;
        return [r * Math.cos(a), r * Math.sin(a)] as [number, number];
      });
    case 'triangle':
      return [[0, -r * 1.05], [r * 1.05, r * 0.8], [-r * 1.05, r * 0.8]];
    case 'diamond':
      return [[0, -r * 1.12], [r * 1.0, 0], [0, r * 1.12], [-r * 1.0, 0]];
  }
}

/** An SVG path for a shape, for the legend. */
export function shapePath(shape: MarkerShape, r: number): string {
  if (shape === 'circle') return `M ${-r} 0 A ${r} ${r} 0 1 0 ${r} 0 A ${r} ${r} 0 1 0 ${-r} 0 Z`;
  const pts = shapePoints(shape, r);
  return `M ${pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(' L ')} Z`;
}

/** Draws a shape into a 2D canvas context at (cx, cy), filled, with a dark outline. */
export function drawShape(
  ctx: CanvasRenderingContext2D,
  shape: MarkerShape,
  cx: number,
  cy: number,
  r: number,
  fill: string,
  outline = '#0b0f14',
  lineWidth = Math.max(1, r * 0.2),
): void {
  ctx.beginPath();
  if (shape === 'circle') {
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
  } else {
    const pts = shapePoints(shape, r);
    ctx.moveTo(cx + pts[0][0], cy + pts[0][1]);
    for (const [x, y] of pts.slice(1)) ctx.lineTo(cx + x, cy + y);
    ctx.closePath();
  }
  ctx.lineJoin = 'round';
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = outline;
  ctx.fillStyle = fill;
  ctx.stroke();
  ctx.fill();
}
