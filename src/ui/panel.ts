import type { Switches } from '../engine/switches';
import type { TrainId } from '../shared/types';
import { radioLabel, SWITCH_KEYS, switchLabel, type SwitchKey } from './controls';
import type { Row, Tile } from './hud';
import { legendItems, shapePath } from './markers';
import { TEXT } from './palette';

export interface PanelHandlers {
  /** Flip one on/off switch. The page reads the new state back from the engines. */
  onToggle(key: SwitchKey): void;
  /** The radio slider moved. `drop` is the share of train-to-train messages dropped, 0 to 1. */
  onRadioDrop(drop: number): void;
  onBreakDown(id: TrainId): void;
  onSpeed(speed: number): void;
  onPause(): void;
  onRestart(): void;
  onCamera(): void;
}

export interface Panel {
  baselineStage: HTMLElement;
  oursStage: HTMLElement;
  baselineMinimap: HTMLCanvasElement;
  oursMinimap: HTMLCanvasElement;
  setBanner(title: string, status: string): void;
  setRows(rows: Row[]): void;
  /** The three big numbers above the scenes. */
  setTiles(tiles: Tile[]): void;
  /** Shows the decision card for a clicked train over a scene, or hides it with null. */
  setCard(side: 'baseline' | 'ours', lines: string[] | null): void;
  setPauseLabel(paused: boolean): void;
  setCameraLabel(text: string): void;
  /** Shows the current switches on the switch buttons and the radio slider. */
  setSwitches(sw: Switches): void;
  /** The trains the breakdown picker offers. */
  setTrains(ids: TrainId[]): void;
}

const SPEEDS = [1, 4, 8, 16];

const SVG_NS = 'http://www.w3.org/2000/svg';

/** A small inline SVG of a mode's marker shape, for the legend. */
function shapeIcon(shape: Parameters<typeof shapePath>[0], fill: string, size = 18, opacity = 1): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '-10 -10 20 20');
  svg.style.flex = 'none';
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

/** "How each train is deciding": one entry per mode, its shape, colour and meaning, plus stopped. */
function legendBox(): HTMLElement {
  const box = el('div', `flex:1;min-width:0;padding:8px 12px;border:1px solid #26303c;border-radius:6px;`);
  box.append(el('div', `font-size:12px;color:${TEXT.muted};text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;`, 'How each train is deciding'));
  const grid = el('div', 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 16px;');
  const entry = (icon: Element, label: string, meaning: string): HTMLElement => {
    const row = el('div', 'display:flex;gap:8px;align-items:flex-start;');
    const words = el('div', 'min-width:0;');
    words.append(el('div', `font-size:14px;color:${TEXT.primary};`, label), el('div', `font-size:12px;color:${TEXT.secondary};`, meaning));
    row.append(icon, words);
    return row;
  };
  for (const item of legendItems()) grid.append(entry(shapeIcon(item.shape, item.css), item.label, item.meaning));
  grid.append(entry(shapeIcon('square', '#8b96a5', 18, 0.55), 'Stopped', 'Dimmed, with a STOPPED tag'));
  const zone = el('span', 'flex:none;width:18px;height:18px;border-radius:4px;background:rgba(217,164,65,0.35);border:1px dashed #d9a441;');
  grid.append(entry(zone, 'Junction zone', 'Only one train in it at a time. Brighter while a train is in it'));
  box.append(grid);
  return box;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  style: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.style.cssText = style;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * The page around the two scenes: banner, a column each for the baseline and ours with a
 * minimap under each, the scoreboard, and the buttons. Everything here is plain HTML, so
 * the numbers stay readable whatever the camera does.
 */
export function createPanel(root: HTMLElement, h: PanelHandlers): Panel {
  root.style.cssText =
    'position:fixed;inset:0;display:flex;flex-direction:column;background:#0b0f14;color:#e6edf3;font-family:system-ui,sans-serif;';

  const banner = el('div', 'padding:10px 16px;border-bottom:1px solid #26303c;');
  const title = el('div', 'font-size:20px;font-weight:600;');
  const status = el('div', 'font-size:14px;color:#9fb0c3;margin-top:2px;');
  const legend = el(
    'div',
    'font-size:12px;color:#7d8da1;margin-top:2px;',
    'A device with a green lamp is on; dull red with no lamp is off. Click a train to see how it is deciding.',
  );
  banner.append(title, status, legend);

  // The three big numbers, readable from across a room. Built once; only their text changes.
  const tilesRow = el('div', 'display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;padding:10px 16px 0 16px;');
  const ACCENT: Record<Tile['tone'], string> = { baseline: '#d55181', ours: '#3987e5', neutral: '#9fb0c3' };
  const tileParts = [0, 1, 2].map(() => {
    const box = el('div', 'padding:8px 14px;border:1px solid #26303c;border-left-width:4px;border-radius:8px;background:#121821;min-width:0;');
    const label = el('div', `font-size:14px;color:${TEXT.secondary};`);
    const value = el('div', `font-size:52px;font-weight:700;line-height:1.05;color:${TEXT.primary};font-variant-numeric:tabular-nums;`);
    const unit = el('span', `font-size:20px;font-weight:500;color:${TEXT.secondary};margin-left:6px;`, 'min');
    const number = el('span', '');
    value.append(number, unit);
    const sub = el('div', `font-size:13px;color:${TEXT.secondary};`);
    box.append(label, value, sub);
    tilesRow.append(box);
    return { box, label, number, sub };
  });

  const columns = el('div', 'display:flex;gap:12px;padding:12px 16px;flex:1;min-height:0;');
  function column(heading: string): { wrap: HTMLElement; stage: HTMLElement; minimap: HTMLCanvasElement } {
    const wrap = el('div', 'flex:1;display:flex;flex-direction:column;min-width:0;');
    const label = el('div', 'font-size:16px;font-weight:600;margin-bottom:6px;', heading);
    const stage = el('div', 'flex:1;min-height:0;position:relative;border:1px solid #26303c;border-radius:6px;overflow:hidden;');
    const minimap = el('canvas', 'width:100%;height:36px;margin-top:6px;border-radius:4px;');
    minimap.width = 700;
    minimap.height = 36;
    wrap.append(label, stage, minimap);
    return { wrap, stage, minimap };
  }
  const left = column("Today's system");
  const right = column('Our fallback');
  const cardStyle =
    'position:absolute;top:8px;left:8px;padding:8px 10px;font-size:13px;line-height:1.5;background:rgba(11,15,20,0.88);border:1px solid #3a4658;border-radius:6px;display:none;pointer-events:none;z-index:2;';
  const cards = { baseline: el('div', cardStyle), ours: el('div', cardStyle) };
  left.stage.append(cards.baseline);
  right.stage.append(cards.ours);
  columns.append(left.wrap, right.wrap);

  const table = el('table', 'border-collapse:collapse;font-size:15px;');
  const scoreboard = el('div', 'display:flex;gap:16px;align-items:flex-start;padding:4px 16px 8px 16px;');
  const tableBox = el('div', 'flex:1;min-width:0;');
  tableBox.append(table);
  scoreboard.append(tableBox, legendBox());

  const controls = el('div', 'display:flex;flex-wrap:wrap;gap:16px;padding:10px 16px;border-top:1px solid #26303c;');
  const groupStyle = 'display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:6px 10px;border:1px solid #26303c;border-radius:6px;';
  function group(heading: string): HTMLElement {
    const g = el('div', groupStyle);
    g.append(el('span', 'font-size:12px;color:#7d8da1;text-transform:uppercase;letter-spacing:0.05em;', heading));
    return g;
  }
  function button(text: string, onClick: () => void): HTMLButtonElement {
    const b = el('button', 'padding:8px 12px;font-size:14px;cursor:pointer;', text);
    b.addEventListener('click', onClick);
    return b;
  }

  // Failures: one toggle per switch, the radio slider, and the breakdown picker.
  const failures = group('Failures');
  const toggles = {} as Record<SwitchKey, HTMLButtonElement>;
  for (const key of SWITCH_KEYS) {
    toggles[key] = button(switchLabel(key, true), () => h.onToggle(key));
    failures.append(toggles[key]);
  }
  const radio = el('label', 'display:flex;align-items:center;gap:6px;font-size:14px;');
  const radioText = el('span', 'min-width:118px;', radioLabel(0));
  const slider = el('input', 'width:120px;cursor:pointer;');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '100';
  slider.step = '5';
  slider.value = '0';
  slider.addEventListener('input', () => h.onRadioDrop(Number(slider.value) / 100));
  radio.append(radioText, slider);
  const breakdown = el('label', 'display:flex;align-items:center;gap:6px;font-size:14px;', 'Break down train');
  const picker = el('select', 'padding:8px;font-size:14px;');
  const breakButton = button('▸', () => {
    if (picker.value !== '') h.onBreakDown(Number(picker.value));
  });
  breakButton.title = 'Break down the chosen train on both sides';
  breakdown.append(picker, breakButton);
  failures.append(radio, breakdown);

  // Running the demo.
  const run = group('Run');
  const pause = button('Pause', h.onPause);
  const camera = button('Camera', h.onCamera);
  const speed = el('select', 'padding:8px;font-size:14px;');
  for (const s of SPEEDS) {
    const option = el('option', '', `${s}x speed`);
    option.value = String(s);
    speed.append(option);
  }
  speed.addEventListener('change', () => h.onSpeed(Number(speed.value)));
  run.append(speed, pause, button('Restart', h.onRestart), camera);
  controls.append(failures, run);

  let shownTrains = '';

  root.append(banner, tilesRow, columns, scoreboard, controls);

  return {
    baselineStage: left.stage,
    oursStage: right.stage,
    baselineMinimap: left.minimap,
    oursMinimap: right.minimap,
    setBanner(t, s) {
      title.textContent = t;
      status.textContent = s;
    },
    setTiles(tiles) {
      tiles.forEach((t, i) => {
        const part = tileParts[i];
        if (!part) return;
        part.label.textContent = t.label;
        part.number.textContent = t.value;
        part.sub.textContent = t.sub;
        part.box.style.borderLeftColor = ACCENT[t.tone];
      });
    },
    setRows(rows) {
      table.replaceChildren();
      const head = el('tr', 'color:#9fb0c3;text-align:left;');
      for (const text of ['', "Today's system", 'Our fallback']) head.append(el('th', 'padding:2px 24px 2px 0;white-space:nowrap;', text));
      table.append(head);
      for (const r of rows) {
        const tr = el('tr', '');
        tr.append(
          el('td', 'padding:2px 24px 2px 0;color:#9fb0c3;', r.label),
          el('td', 'padding:2px 24px 2px 0;font-variant-numeric:tabular-nums;', r.baseline),
          el('td', 'padding:2px 24px 2px 0;font-variant-numeric:tabular-nums;', r.ours),
        );
        table.append(tr);
      }
    },
    setCard(side, lines) {
      const card = cards[side];
      if (lines === null) {
        card.style.display = 'none';
        return;
      }
      card.replaceChildren(...lines.map((line) => el('div', '', line)));
      card.style.display = 'block';
    },
    setPauseLabel(paused) {
      pause.textContent = paused ? 'Resume' : 'Pause';
    },
    setCameraLabel(text) {
      camera.textContent = text;
    },
    setSwitches(sw) {
      for (const key of SWITCH_KEYS) {
        const on = sw[key];
        toggles[key].textContent = switchLabel(key, on);
        toggles[key].style.background = on ? '' : '#5a2a2a';
        toggles[key].style.color = on ? '' : '#ffd7d7';
      }
      radioText.textContent = radioLabel(sw.radioDrop);
      // Leave the slider alone while it is being dragged, so it does not jump under the pointer.
      const value = String(Math.round(sw.radioDrop * 100));
      if (document.activeElement !== slider && slider.value !== value) slider.value = value;
    },
    setTrains(ids) {
      // Rebuild only when the list changes, so an open dropdown is not closed every frame.
      const key = ids.join(',');
      if (key === shownTrains) return;
      shownTrains = key;
      const chosen = picker.value;
      picker.replaceChildren(
        ...ids.map((id) => {
          const option = el('option', '', String(id));
          option.value = String(id);
          return option;
        }),
      );
      if (ids.map(String).includes(chosen)) picker.value = chosen;
      breakButton.disabled = ids.length === 0;
    },
  };
}
