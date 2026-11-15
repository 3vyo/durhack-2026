import type { Switches } from '../engine/switches';
import { radioLabel, SWITCH_KEYS, type SwitchKey } from './controls';
import type { Row, Tile } from './hud';
import { legendItems, shapePath } from './markers';
import { MODE_STYLE } from './palette';
import './page.css';

export type Side = 'baseline' | 'ours';

export interface PanelHandlers {
  /** Flip one on/off switch. The page reads the new state back from the engines. */
  onToggle(key: SwitchKey): void;
  /** The radio slider moved. `drop` is the share of train-to-train messages dropped, 0 to 1. */
  onRadioDrop(drop: number): void;
  onSpeed(speed: number): void;
  onPause(): void;
  onRestart(): void;
  onCamera(): void;
  /** Show this side's 3D view. */
  onView(side: Side): void;
}

export interface Panel {
  baselineStage: HTMLElement;
  oursStage: HTMLElement;
  baselineMinimap: HTMLCanvasElement;
  oursMinimap: HTMLCanvasElement;
  /** The scenario name and the clock line. */
  setBanner(title: string, status: string): void;
  setRows(rows: Row[]): void;
  /** The three numbers on the delay board. */
  setTiles(tiles: Tile[]): void;
  /** Shows the decision card for a clicked train over a scene, or hides it with null. */
  setCard(side: Side, lines: string[] | null): void;
  setPauseLabel(paused: boolean): void;
  setCameraLabel(text: string): void;
  /** Shows the current switches on the lamps and the radio slider. */
  setSwitches(sw: Switches): void;
  /** Shows one side's view and minimap, and marks it on the view switch. */
  setView(side: Side): void;
}

/**
 * The speed choices. The value is how many simulated seconds pass per real second; the label
 * is relative to the normal speed, 8 simulated seconds a second, which reads as 1x.
 */
export const SPEEDS = [
  { value: 4, label: '0.5x' },
  { value: 8, label: '1x' },
  { value: 16, label: '2x' },
  { value: 32, label: '4x' },
] as const;
export const NORMAL_SPEED = 8;

const SWITCH_NAMES: Record<SwitchKey, string> = {
  centre: 'Control centre',
  platformKeeper: 'Platform keeper',
  junctionKeeper: 'Junction keeper',
  sensors: 'Platform sensors',
};

const SIDE_NAMES: Record<Side, string> = { baseline: "Today's system", ours: 'Our fallback' };
/** The colour tick beside each side's name, the same as on the delay board. */
const SIDE_COLOUR: Record<Side, string> = { baseline: MODE_STYLE.blind.css, ours: MODE_STYLE.central.css };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** A small inline SVG of a mode's marker shape, for the key. */
function shapeIcon(shape: Parameters<typeof shapePath>[0], fill: string, opacity = 1): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('viewBox', '-10 -10 20 20');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', shapePath(shape, 7.5));
  path.setAttribute('fill', fill);
  path.setAttribute('stroke', '#0b0f14');
  path.setAttribute('stroke-width', '1.6');
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('opacity', String(opacity));
  svg.append(path);
  return svg;
}

/** A panel with a heading button that folds its body away. */
function foldingPanel(className: string, heading: string, folded: boolean): { box: HTMLElement; body: HTMLElement } {
  const box = el('section', `glass side ${className}${folded ? ' folded' : ''}`);
  const toggle = el('button', 'fold', heading);
  toggle.setAttribute('aria-expanded', String(!folded));
  const body = el('div', 'body');
  toggle.addEventListener('click', () => {
    const nowFolded = box.classList.toggle('folded');
    toggle.setAttribute('aria-expanded', String(!nowFolded));
  });
  box.append(toggle, body);
  return { box, body };
}

/**
 * The page: one side's 3D view fills the window, and small glass panels float over it. The
 * title and clock top left, the view switch top centre, the delay board top right, the key and
 * the scoreboard on the sides (each folds away), and the minimap over the control dock at the
 * bottom. Everything is plain HTML, so it stays readable whatever the camera does.
 *
 * Keys: V switches the view, Space pauses, C cuts or restores the control centre.
 */
export function createPanel(root: HTMLElement, h: PanelHandlers): Panel {
  root.replaceChildren();

  // The two views. Only the chosen one is shown.
  const stages = { baseline: el('div', 'stage'), ours: el('div', 'stage') };
  const cards = { baseline: el('div', 'card'), ours: el('div', 'card') };
  for (const side of ['baseline', 'ours'] as const) {
    cards[side].hidden = true;
    stages[side].append(cards[side]);
  }

  // Title and clock.
  const title = el('div', 'glass title');
  const scenario = el('span', 'scenario');
  const clock = el('span', 'clock');
  const ended = el('span', 'ended');
  title.append(scenario, clock, ended);

  // Which side is showing.
  const views = el('div', 'glass views');
  views.setAttribute('role', 'group');
  views.setAttribute('aria-label', 'Which railway to show');
  const viewButtons = {} as Record<Side, HTMLButtonElement>;
  for (const side of ['baseline', 'ours'] as const) {
    const b = el('button');
    const tick = el('span', 'tick');
    tick.style.background = SIDE_COLOUR[side];
    b.append(tick, SIDE_NAMES[side]);
    b.title = 'Switch view (V)';
    b.addEventListener('click', () => h.onView(side));
    viewButtons[side] = b;
    views.append(b);
  }

  // The delay board.
  const board = el('section', 'glass board');
  board.append(el('div', 'heading', 'Average delay per train, against a run where nothing fails'));
  const cells = el('div', 'cells');
  const cellParts = [0, 1, 2].map(() => {
    const cell = el('div', 'cell');
    const label = el('div', 'label');
    const value = el('div', 'value');
    const number = el('span');
    value.append(number, el('span', 'unit', 'min'));
    const sub = el('div', 'sub');
    cell.append(label, value, sub);
    cells.append(cell);
    return { cell, label, number, sub };
  });
  board.append(cells);
  const EDGE: Record<Tile['tone'], string> = { baseline: SIDE_COLOUR.baseline, ours: SIDE_COLOUR.ours, neutral: '#a9b6c5' };

  // The key: one compact row of shapes and names. Click it to show what each one means.
  const key = el('button', 'glass key');
  key.setAttribute('aria-expanded', 'false');
  key.title = 'Show what each mark means';
  const keyItem = (icon: Element, name: string, meaning: string) => {
    const item = el('span', 'item');
    item.append(icon, el('span', 'name', name), el('span', 'meaning', meaning));
    key.append(item);
  };
  for (const item of legendItems()) keyItem(shapeIcon(item.shape, item.css), item.label, item.meaning);
  keyItem(shapeIcon('square', '#8b96a5', 0.55), 'Stopped', 'Dimmed, with a STOPPED tag');
  keyItem(el('span', 'zone'), 'Junction zone', 'One train at a time');
  key.addEventListener('click', () => {
    const open = key.classList.toggle('open');
    key.setAttribute('aria-expanded', String(open));
  });

  // The scoreboard, on the right.
  const scores = foldingPanel('right', 'Scoreboard', false);
  const table = el('table', 'scores');
  scores.body.append(table);
  let shownRows = '';

  // The minimap of the whole line, for the side on show.
  const minimapBox = el('div', 'glass minimap');
  minimapBox.title = 'Every train on the whole line. The lighter stretch is what the view shows from above';
  const minimaps = { baseline: el('canvas'), ours: el('canvas') };
  for (const side of ['baseline', 'ours'] as const) {
    minimaps[side].width = 1400;
    minimaps[side].height = 26;
    minimaps[side].setAttribute('aria-label', `Every train on the whole line, ${SIDE_NAMES[side]}`);
    minimapBox.append(minimaps[side]);
  }

  // The control dock: failures on the left, running the demo on the right.
  const dock = el('div', 'glass dock');
  const failures = el('div', 'group');
  failures.setAttribute('role', 'group');
  failures.setAttribute('aria-label', 'Failures');
  const lamps = {} as Record<SwitchKey, HTMLButtonElement>;
  for (const k of SWITCH_KEYS) {
    const b = el('button', 'lamp', SWITCH_NAMES[k]);
    b.setAttribute('aria-pressed', 'true');
    b.title = k === 'centre' ? 'Switch on or off (C)' : 'Switch on or off';
    b.addEventListener('click', () => h.onToggle(k));
    lamps[k] = b;
    failures.append(b);
  }
  const radio = el('label', 'radio');
  const radioText = el('span', 'value', radioLabel(0));
  const slider = el('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '100';
  slider.step = '5';
  slider.value = '0';
  slider.setAttribute('aria-label', 'Share of train-to-train radio messages lost');
  slider.addEventListener('input', () => h.onRadioDrop(Number(slider.value) / 100));
  radio.append(radioText, slider);
  const breakdownHint = el('span', 'hint', 'Double-click a train to break it down');
  failures.append(radio, breakdownHint);

  const run = el('div', 'group push');
  run.setAttribute('role', 'group');
  run.setAttribute('aria-label', 'Run');
  const speed = el('select');
  speed.setAttribute('aria-label', 'Speed');
  for (const s of SPEEDS) {
    const option = el('option', '', `${s.label} speed`);
    option.value = String(s.value);
    speed.append(option);
  }
  speed.value = String(NORMAL_SPEED);
  speed.addEventListener('change', () => h.onSpeed(Number(speed.value)));
  const pause = el('button', '', 'Pause');
  pause.title = 'Pause or resume (Space)';
  pause.addEventListener('click', h.onPause);
  const restart = el('button', '', 'Restart');
  restart.addEventListener('click', h.onRestart);
  const camera = el('button', '', 'Camera');
  camera.addEventListener('click', h.onCamera);
  run.append(speed, pause, restart, camera);
  dock.append(failures, run);

  // The bottom: the key, the minimap and the control dock, stacked.
  const bottom = el('div', 'bottom');
  bottom.append(key, minimapBox, dock);
  root.append(stages.baseline, stages.ours, title, views, board, scores.box, bottom);

  // Keys for the presenter. They do nothing while a text box or a list has focus.
  window.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'v' || e.key === 'V') h.onView(stages.baseline.hidden ? 'baseline' : 'ours');
    else if (e.key === 'c' || e.key === 'C') h.onToggle('centre');
    else if (e.key === ' ' && target?.tagName !== 'BUTTON') {
      e.preventDefault();
      h.onPause();
    }
  });

  return {
    baselineStage: stages.baseline,
    oursStage: stages.ours,
    baselineMinimap: minimaps.baseline,
    oursMinimap: minimaps.ours,
    setBanner(t, s) {
      scenario.textContent = t;
      const [time, ...rest] = s.split('|').map((part) => part.trim());
      clock.textContent = time;
      ended.textContent = rest.join(' ');
    },
    setTiles(tiles) {
      tiles.forEach((t, i) => {
        const part = cellParts[i];
        if (!part) return;
        part.label.textContent = t.label;
        part.number.textContent = t.value;
        part.sub.textContent = t.sub;
        part.cell.style.setProperty('--edge', EDGE[t.tone]);
      });
    },
    setRows(rows) {
      // Rebuild only when the text changes, so the table can be read and selected.
      const text = JSON.stringify(rows);
      if (text === shownRows) return;
      shownRows = text;
      table.replaceChildren();
      const head = el('tr');
      for (const t of ['', "Today's", 'Ours']) head.append(el('th', '', t));
      table.append(head);
      for (const r of rows) {
        const tr = el('tr');
        tr.append(el('td', '', r.label), el('td', '', r.baseline), el('td', '', r.ours));
        table.append(tr);
      }
    },
    setCard(side, lines) {
      const card = cards[side];
      if (lines === null) {
        card.hidden = true;
        return;
      }
      const text = lines.join('\n');
      if (card.dataset.text !== text) {
        card.dataset.text = text;
        card.replaceChildren(...lines.map((line) => el('div', '', line)));
      }
      card.hidden = false;
    },
    setPauseLabel(paused) {
      pause.textContent = paused ? 'Resume' : 'Pause';
    },
    setCameraLabel(text) {
      camera.textContent = text;
    },
    setSwitches(sw) {
      for (const k of SWITCH_KEYS) {
        lamps[k].setAttribute('aria-pressed', String(sw[k]));
        lamps[k].setAttribute('aria-label', `${SWITCH_NAMES[k]}: ${sw[k] ? 'ON' : 'OFF'}`);
        lamps[k].dataset.state = sw[k] ? 'ON' : 'OFF';
      }
      radioText.textContent = radioLabel(sw.radioDrop);
      // Leave the slider alone while it is being dragged, so it does not jump under the pointer.
      const value = String(Math.round(sw.radioDrop * 100));
      if (document.activeElement !== slider && slider.value !== value) slider.value = value;
    },
    setView(side) {
      for (const s of ['baseline', 'ours'] as const) {
        const on = s === side;
        stages[s].hidden = !on;
        minimaps[s].hidden = !on;
        viewButtons[s].setAttribute('aria-pressed', String(on));
      }
    },
  };
}
