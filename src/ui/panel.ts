import type { Row } from './hud';

export interface PanelHandlers {
  onCutCentre(): void;
  onRestoreCentre(): void;
  onCutRadio(): void;
  onRestoreRadio(): void;
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
  /** Shows the decision card for a clicked train over a scene, or hides it with null. */
  setCard(side: 'baseline' | 'ours', lines: string[] | null): void;
  setPauseLabel(paused: boolean): void;
  setCameraLabel(text: string): void;
}

const SPEEDS = [1, 4, 8, 16];

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
    'Boxes above the track, left to right: platform keeper, control centre (back), platform sensors, junction keeper. Green is on, dull red is off. Click a train to see how it is deciding.',
  );
  banner.append(title, status, legend);

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
    'position:absolute;top:8px;left:8px;padding:8px 10px;font-size:13px;line-height:1.5;background:rgba(11,15,20,0.88);border:1px solid #3a4658;border-radius:6px;display:none;pointer-events:none;';
  const cards = { baseline: el('div', cardStyle), ours: el('div', cardStyle) };
  left.stage.append(cards.baseline);
  right.stage.append(cards.ours);
  columns.append(left.wrap, right.wrap);

  const table = el('table', 'border-collapse:collapse;margin:0 16px;font-size:15px;');
  const scoreboard = el('div', 'padding:4px 0 8px 0;');
  scoreboard.append(table);

  const controls = el('div', 'display:flex;flex-wrap:wrap;gap:8px;padding:10px 16px;border-top:1px solid #26303c;');
  function button(text: string, onClick: () => void): HTMLButtonElement {
    const b = el('button', 'padding:8px 12px;font-size:14px;cursor:pointer;', text);
    b.addEventListener('click', onClick);
    return b;
  }
  const pause = button('Pause', h.onPause);
  const camera = button('Camera', h.onCamera);
  const speed = el('select', 'padding:8px;font-size:14px;');
  for (const s of SPEEDS) {
    const option = el('option', '', `${s}x speed`);
    option.value = String(s);
    speed.append(option);
  }
  speed.addEventListener('change', () => h.onSpeed(Number(speed.value)));
  controls.append(
    button('Cut control centre', h.onCutCentre),
    button('Restore control centre', h.onRestoreCentre),
    button('Cut radio', h.onCutRadio),
    button('Restore radio', h.onRestoreRadio),
    speed,
    pause,
    button('Restart', h.onRestart),
    camera,
  );

  root.append(banner, columns, scoreboard, controls);

  return {
    baselineStage: left.stage,
    oursStage: right.stage,
    baselineMinimap: left.minimap,
    oursMinimap: right.minimap,
    setBanner(t, s) {
      title.textContent = t;
      status.textContent = s;
    },
    setRows(rows) {
      table.replaceChildren();
      const head = el('tr', 'color:#9fb0c3;text-align:left;');
      for (const text of ['', "Today's system", 'Our fallback']) head.append(el('th', 'padding:2px 24px 2px 0;', text));
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
  };
}
