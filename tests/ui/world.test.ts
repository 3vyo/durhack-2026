// The drawn track against the path the trains follow. world.ts lays the rails and pathAt in
// layout.ts places each car, and nothing but these tests keeps the two in step. The scenery is
// built for real, without a canvas, and every point a train can be drawn at must lie on a laid
// piece of track.

import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { LAYOUT_IDS, PLATFORMS, applyLayout, entryOf, resetLayout, type LayoutId } from '../../src/shared/map';
import { pathAt, stationFrame, toScreenX, type Frame } from '../../src/ui/layout';
import { buildWorld } from '../../src/ui/world';

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

/**
 * Walks a train through every platform of the layout in use, from one edge of the frame to
 * the other, and returns the furthest it is ever drawn from the laid track. Marks each piece
 * a train runs along.
 */
function furthestFromTrack(frame: Frame, pieces: Piece[]): { distance: number; at: string } {
  let worst = { distance: 0, at: '' };
  for (const platform of PLATFORMS) {
    const route = { entry: entryOf(platform), platform };
    for (let x = frame.xMin; x <= frame.xMax; x += 2) {
      const z = pathAt(x, route).z;
      const point = new THREE.Vector2(toScreenX(x, frame), z);
      let nearest = Infinity;
      for (const piece of pieces) {
        const d = distanceTo(piece, point);
        if (d < ON_THE_RAILS) piece.used = true;
        nearest = Math.min(nearest, d);
      }
      if (nearest > worst.distance) worst = { distance: nearest, at: `${platform} at x ${x}, z ${z.toFixed(2)}` };
    }
  }
  return worst;
}

afterEach(() => resetLayout());

describe.each([...LAYOUT_IDS])('the drawn track on the %s layout', (id: LayoutId) => {
  it('lies under every train, all the way through every platform and out along EXIT', () => {
    applyLayout(id);
    const frame = stationFrame();
    const worst = furthestFromTrack(frame, laidTrack(frame));
    expect(worst.distance, `furthest from the track: ${worst.at}`).toBeLessThan(ON_THE_RAILS);
  });

  it('has no piece in the picture that no train runs along', () => {
    applyLayout(id);
    const frame = stationFrame();
    const pieces = laidTrack(frame);
    furthestFromTrack(frame, pieces);
    const inPicture = pieces.filter((p) => Math.max(p.a.x, p.b.x) >= 0 && Math.min(p.a.x, p.b.x) <= frame.width);
    expect(inPicture.length).toBeGreaterThan(0);
    const spare = inPicture.filter((p) => !p.used);
    expect(spare.map((p) => `${p.a.x.toFixed(1)},${p.a.y.toFixed(1)} to ${p.b.x.toFixed(1)},${p.b.y.toFixed(1)}`)).toEqual([]);
  });
});

describe('the drawn track follows the layout in use', () => {
  it('lays more track for a layout with more lines', () => {
    const counts = LAYOUT_IDS.map((id) => {
      applyLayout(id);
      return laidTrack(stationFrame()).length;
    });
    for (let i = 1; i < counts.length; i++) expect(counts[i]!).toBeGreaterThan(counts[i - 1]!);
  });
});

describe('sensorReading', () => {
  it('shows a switched-off sensor as off, whatever it reads', async () => {
    const { sensorReading } = await import('../../src/ui/world');
    expect(sensorReading(false, true)).toBe('empty');
    expect(sensorReading(true, true)).toBe('occupied');
    expect(sensorReading(true, false)).toBe('off');
  });
});
