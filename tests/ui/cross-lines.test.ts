// The page's side of the cross links ("Cross links" in docs/design.md): the ?cross=1 address,
// the Cross links box, the extra rail the scenery lays for each link, and the path a train's
// cars follow over one. No train crosses in these tests. The states are made by hand.

import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ENTRIES,
  LAYOUT_IDS,
  PLATFORMS,
  TRACK_START,
  applyCrossLines,
  applyLayout,
  crossPlatforms,
  entryOf,
  resetLayout,
  type LayoutId,
} from '../../src/shared/map';
import type { EntryId, PlatformId } from '../../src/shared/types';
import { crossBoxState, crossUrl, keepCrossShown, layoutUrl, parseCross, parseLayout } from '../../src/ui/controls';
import {
  EXIT_MERGE,
  LANE_SPACING,
  POINTS_LENGTH,
  laneOf,
  pathAt,
  routeOf,
  stationFrame,
  toScreenX,
  type Frame,
  type Route,
} from '../../src/ui/layout';
import { buildWorld } from '../../src/ui/world';

afterEach(() => resetLayout());

/** The cross links each layout has with the switch on, as [line, platform]. */
const LINKS: Record<LayoutId, Array<[EntryId, PlatformId]>> = {
  branch: [],
  junction: [['A', 'P3']],
  busy: [['A', 'P3'], ['B', 'P5']],
  hub: [['A', 'P3'], ['B', 'P5'], ['C', 'P7']],
};

describe('parseCross', () => {
  it('switches the cross links on for ?cross=1', () => {
    expect(parseCross('?cross=1')).toBe(true);
    expect(parseCross('?layout=busy&cross=1&quality=low')).toBe(true);
  });

  it('leaves them off when the address does not name them', () => {
    expect(parseCross('')).toBe(false);
    expect(parseCross('?layout=hub')).toBe(false);
    expect(parseCross('?crossing=1')).toBe(false);
  });

  it('leaves them off for any value but 1', () => {
    for (const value of ['0', '', 'false', 'true', 'yes', '2', '11']) {
      expect(parseCross(`?cross=${value}`), value).toBe(false);
    }
    expect(parseCross('?cross')).toBe(false);
  });
});

describe('crossUrl', () => {
  it('adds cross=1 and keeps the layout and every other parameter', () => {
    const url = new URL(crossUrl('http://localhost:5173/?layout=busy&quality=low', true));
    expect(url.searchParams.get('cross')).toBe('1');
    expect(url.searchParams.get('layout')).toBe('busy');
    expect(url.searchParams.get('quality')).toBe('low');
    expect(url.pathname).toBe('/');
  });

  it('takes cross out again and keeps the rest', () => {
    const url = new URL(crossUrl('http://localhost:5173/?layout=hub&cross=1&quality=low', false));
    expect(url.searchParams.has('cross')).toBe(false);
    expect(url.searchParams.get('layout')).toBe('hub');
    expect(url.searchParams.get('quality')).toBe('low');
  });

  it('changes nothing when the address already says so', () => {
    expect(crossUrl('http://localhost:5173/?layout=hub', false)).toBe('http://localhost:5173/?layout=hub');
    expect(crossUrl('http://localhost:5173/?layout=hub&cross=1', true)).toBe('http://localhost:5173/?layout=hub&cross=1');
  });

  it('gives an address that parseCross and parseLayout read back', () => {
    const on = crossUrl('http://localhost:5173/?layout=busy', true);
    expect(parseCross(new URL(on).search)).toBe(true);
    expect(parseLayout(new URL(on).search)).toBe('busy');
    const off = crossUrl(on, false);
    expect(parseCross(new URL(off).search)).toBe(false);
    expect(parseLayout(new URL(off).search)).toBe('busy');
  });

  it('is kept when the layout list loads another layout', () => {
    const url = layoutUrl('http://localhost:5173/?layout=junction&cross=1', 'hub');
    expect(parseCross(new URL(url).search)).toBe(true);
    expect(parseLayout(new URL(url).search)).toBe('hub');
  });
});

describe('crossBoxState', () => {
  it('is clear and usable on every layout with two or more lines while the switch is off', () => {
    for (const id of LAYOUT_IDS.filter((l) => l !== 'branch')) {
      applyLayout(id);
      expect(crossBoxState(), id).toEqual({ checked: false, disabled: false });
    }
  });

  it('is ticked on every layout with two or more lines while the switch is on', () => {
    applyCrossLines(true);
    for (const id of LAYOUT_IDS.filter((l) => l !== 'branch')) {
      applyLayout(id);
      expect(crossBoxState(), id).toEqual({ checked: true, disabled: false });
    }
  });

  it('cannot be used on the one-line layout, and is never ticked there', () => {
    applyLayout('branch');
    expect(crossBoxState()).toEqual({ checked: false, disabled: true });
    applyCrossLines(true);
    expect(crossBoxState()).toEqual({ checked: false, disabled: true });
  });
});

describe('keepCrossShown', () => {
  /** A stand-in for the Cross links box and the window: the box, and a way to show the page again. */
  function page(checked = false) {
    const box = { checked, disabled: false, autocomplete: '' };
    const shown: Array<() => void> = [];
    const win = { addEventListener: (type: 'pageshow', listener: () => void) => void (type === 'pageshow' && shown.push(listener)) };
    return { box, win, showAgain: () => shown.forEach((listener) => listener()) };
  }

  it('shows what the page is running when it is built', () => {
    const off = page(true);
    keepCrossShown(off.box, off.win);
    expect(off.box.checked).toBe(false);
    applyCrossLines(true);
    const on = page(false);
    keepCrossShown(on.box, on.win);
    expect(on.box.checked).toBe(true);
    expect(on.box.disabled).toBe(false);
  });

  it("shows it again after the browser's Back button brings the page back", () => {
    // The page runs without cross links. The box is ticked, the page is left, and Back returns
    // to it with the box still ticked.
    const { box, win, showAgain } = page();
    keepCrossShown(box, win);
    box.checked = true;
    showAgain();
    expect(box.checked).toBe(false);
  });

  it('switches the box off on the one-line layout', () => {
    applyLayout('branch');
    applyCrossLines(true);
    const { box, win } = page(true);
    keepCrossShown(box, win);
    expect(box).toMatchObject({ checked: false, disabled: true });
  });

  it('tells the browser not to put an old tick back when it loads the page again', () => {
    const { box, win } = page();
    keepCrossShown(box, win);
    expect(box.autocomplete).toBe('off');
  });
});

describe('routeOf with the line a train came in on', () => {
  const everyEntry: EntryId[] = ['A', 'B', 'C', 'D'];

  it('gives the same route with or without it while the switch is off', () => {
    for (const id of LAYOUT_IDS) {
      applyLayout(id);
      for (const origin of everyEntry) {
        for (const entry of ENTRIES) expect(routeOf(entry, null, origin)).toStrictEqual(routeOf(entry, null));
        for (const p of PLATFORMS) {
          expect(routeOf(p, null, origin)).toStrictEqual({ entry: entryOf(p), platform: p });
          expect(routeOf('EXIT', p, origin)).toStrictEqual(routeOf('EXIT', p));
        }
      }
    }
  });

  it('remembers the line for a train in the platform its cross link reaches', () => {
    applyCrossLines(true);
    for (const id of LAYOUT_IDS) {
      applyLayout(id);
      for (const [line, platform] of LINKS[id]) {
        expect(routeOf(platform, null, line), `${id} ${line}`).toStrictEqual({ entry: entryOf(platform), platform, from: line });
      }
    }
  });

  it('does not for a train in its own pair, or in a platform no link from its line reaches', () => {
    applyCrossLines(true);
    applyLayout('hub');
    for (const origin of everyEntry) {
      for (const p of PLATFORMS) {
        if (crossPlatforms(origin).includes(p)) continue;
        expect(routeOf(p, null, origin), `${origin} ${p}`).toStrictEqual({ entry: entryOf(p), platform: p });
      }
    }
    // One direction only: nothing leads from B back up into A's pair.
    expect(routeOf('P1', null, 'B')).toStrictEqual({ entry: 'A', platform: 'P1' });
  });

  it('leaves a train on an entry line or on EXIT as it was', () => {
    applyCrossLines(true);
    expect(routeOf('A', null, 'A')).toStrictEqual({ entry: 'A', platform: null });
    // Its rear is past the points by the time its front is on EXIT, so the line no longer matters.
    expect(routeOf('EXIT', 'P3', 'A')).toStrictEqual({ entry: 'B', platform: 'P3' });
  });
});

describe('pathAt for a train that crossed', () => {
  const lane = (t: Parameters<typeof laneOf>[0]) => laneOf(t) * LANE_SPACING;
  const split = TRACK_START.P1;

  it('keeps the rear cars in their own line, bends over the link, and leaves with the platform\'s pair', () => {
    applyCrossLines(true);
    const route = routeOf('P3', null, 'A');
    expect(pathAt(split - 50, route)).toEqual({ z: lane('A'), slope: 0 });
    expect(pathAt(split, route).z).toBeCloseTo(lane('A'), 9);
    expect(pathAt(split + POINTS_LENGTH / 2, route).z).toBeCloseTo((lane('A') + lane('P3')) / 2, 9);
    expect(pathAt(split + POINTS_LENGTH / 2, route).slope).toBeCloseTo((lane('P3') - lane('A')) / POINTS_LENGTH, 9);
    expect(pathAt(split + POINTS_LENGTH, route)).toEqual({ z: lane('P3'), slope: 0 });
    expect(pathAt(split + 300, route)).toEqual({ z: lane('P3'), slope: 0 });
    // P3 leaves with P4, in line B's lane, like any other train in P3.
    expect(pathAt(TRACK_START.EXIT + EXIT_MERGE.pairs, route).z).toBeCloseTo(lane('B'), 9);
  });

  it('never jumps lanes along the way, on every link of every layout', () => {
    applyCrossLines(true);
    for (const id of LAYOUT_IDS) {
      applyLayout(id);
      for (const [line, platform] of LINKS[id]) {
        const route = routeOf(platform, null, line);
        let last = pathAt(5800, route).z;
        expect(last).toBe(lane(line));
        for (let x = 5801; x <= stationFrame().xMax; x += 1) {
          const { z } = pathAt(x, route);
          // The steepest drawn track moves two lanes over the points length.
          expect(Math.abs(z - last), `${id} ${line} to ${platform} at x ${x}`).toBeLessThanOrEqual((2 * LANE_SPACING) / POINTS_LENGTH + 1e-9);
          last = z;
        }
        expect(last).toBeCloseTo(lane('EXIT'), 9);
      }
    }
  });

  it('is the old path once the switch is off, whatever line is passed', () => {
    const plain = routeOf('P3', null);
    const withLine = routeOf('P3', null, 'A');
    for (let x = 5800; x <= 6800; x += 5) expect(pathAt(x, withLine)).toEqual(pathAt(x, plain));
    expect(pathAt(5900, withLine)).toEqual({ z: lane('B'), slope: 0 });
  });
});

/** One laid piece of track as a line on the ground, from end to end, in scene units. */
interface Piece {
  a: THREE.Vector2;
  b: THREE.Vector2;
  used: boolean;
}

/** Length of the stand-in track piece, in scene units. It runs along z, as the kit's piece does. */
const PIECE_LENGTH = 2;

/** How far a train may be drawn from the middle of a piece, in scene units. 1 unit is 12.5 m. */
const ON_THE_RAILS = 0.01;

/** Builds the scenery of the layout in use and lays the kit track, as the page does. */
function laidTrack(frame: Frame): Piece[] {
  const scene = new THREE.Scene();
  const world = buildWorld(scene, frame, 0);
  const rail = new THREE.Group();
  rail.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, PIECE_LENGTH), new THREE.MeshBasicMaterial()));
  world.useKitRails(rail);
  const laid = scene.children.filter((c) => (c as THREE.InstancedMesh).isInstancedMesh) as THREE.InstancedMesh[];
  expect(laid).toHaveLength(1);
  const pieces: Piece[] = [];
  const m = new THREE.Matrix4();
  for (let i = 0; i < laid[0]!.count; i++) {
    laid[0]!.getMatrixAt(i, m);
    // useKitRails turns the piece to run along x before it places it.
    const a = new THREE.Vector3(-PIECE_LENGTH / 2, 0, 0).applyMatrix4(m);
    const b = new THREE.Vector3(PIECE_LENGTH / 2, 0, 0).applyMatrix4(m);
    pieces.push({ a: new THREE.Vector2(a.x, a.z), b: new THREE.Vector2(b.x, b.z), used: false });
  }
  return pieces;
}

/** Distance from a point on the ground to a piece. */
function distanceTo(piece: Piece, p: THREE.Vector2): number {
  const along = piece.b.clone().sub(piece.a);
  const t = Math.max(0, Math.min(1, p.clone().sub(piece.a).dot(along) / along.lengthSq()));
  return p.distanceTo(piece.a.clone().add(along.multiplyScalar(t)));
}

/** The pieces laid from the end of `line`'s lane to the start of `platform`'s lane, over the points. */
function linkPieces(pieces: Piece[], frame: Frame, line: EntryId, platform: PlatformId): Piece[] {
  const from = new THREE.Vector2(toScreenX(TRACK_START.P1, frame), laneOf(line) * LANE_SPACING);
  const to = new THREE.Vector2(toScreenX(TRACK_START.P1 + POINTS_LENGTH, frame), laneOf(platform) * LANE_SPACING);
  // The laid pieces are stored as 32-bit numbers, so allow for their rounding.
  const near = (p: THREE.Vector2, q: THREE.Vector2) => p.distanceTo(q) < 1e-3;
  return pieces.filter((p) => (near(p.a, from) && near(p.b, to)) || (near(p.a, to) && near(p.b, from)));
}

/** Walks a train along a route across the frame. Returns the furthest it is drawn from the track, and marks the pieces it uses. */
function walk(route: Route, frame: Frame, pieces: Piece[]): number {
  let worst = 0;
  for (let x = frame.xMin; x <= frame.xMax; x += 2) {
    const point = new THREE.Vector2(toScreenX(x, frame), pathAt(x, route).z);
    let nearest = Infinity;
    for (const piece of pieces) {
      const d = distanceTo(piece, point);
      if (d < ON_THE_RAILS) piece.used = true;
      nearest = Math.min(nearest, d);
    }
    worst = Math.max(worst, nearest);
  }
  return worst;
}

describe.each([...LAYOUT_IDS])('the drawn cross links on the %s layout', (id: LayoutId) => {
  it('lays no cross link while the switch is off', () => {
    applyLayout(id);
    const frame = stationFrame();
    const pieces = laidTrack(frame);
    for (const [line, platform] of LINKS.hub) expect(linkPieces(pieces, frame, line, platform), `${line} to ${platform}`).toHaveLength(0);
  });

  it('lays one more diagonal for each link with the switch on, and nothing else', () => {
    applyLayout(id);
    const frame = stationFrame();
    const off = laidTrack(frame);
    applyCrossLines(true);
    const on = laidTrack(frame);
    expect(on).toHaveLength(off.length + LINKS[id].length);
    for (const [line, platform] of LINKS[id]) expect(linkPieces(on, frame, line, platform), `${line} to ${platform}`).toHaveLength(1);
    // Every other piece is where it was.
    const spot = (p: Piece) => [p.a.x, p.a.y, p.b.x, p.b.y].map((n) => n.toFixed(3)).join(' ');
    const before = new Set(off.map(spot));
    const added = on.filter((p) => !before.has(spot(p)));
    expect(added).toHaveLength(LINKS[id].length);
    // A link no layout of this size has is not laid: nothing leads out of the last line.
    for (const [line, platform] of LINKS.hub) {
      if (LINKS[id].some(([l]) => l === line)) continue;
      expect(linkPieces(on, frame, line, platform), `${line} to ${platform}`).toHaveLength(0);
    }
  });

  it('lies under a train that crosses, and has no piece no train runs along', () => {
    applyLayout(id);
    applyCrossLines(true);
    const frame = stationFrame();
    const pieces = laidTrack(frame);
    for (const p of PLATFORMS) expect(walk(routeOf(p, null), frame, pieces), p).toBeLessThan(ON_THE_RAILS);
    for (const [line, platform] of LINKS[id]) {
      expect(walk(routeOf(platform, null, line), frame, pieces), `${line} to ${platform}`).toBeLessThan(ON_THE_RAILS);
    }
    const inPicture = pieces.filter((p) => Math.max(p.a.x, p.b.x) >= 0 && Math.min(p.a.x, p.b.x) <= frame.width);
    const spare = inPicture.filter((p) => !p.used);
    expect(spare.map((p) => `${p.a.x.toFixed(1)},${p.a.y.toFixed(1)} to ${p.b.x.toFixed(1)},${p.b.y.toFixed(1)}`)).toEqual([]);
  });
});
