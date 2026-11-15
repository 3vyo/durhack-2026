import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Switches } from '../engine/switches';
import { JUNCTION_END_X, JUNCTION_START_X, TRACK_LENGTH, TRACK_START } from '../shared/map';
import type { TrackId } from '../shared/types';
import {
  DEVICE_SITES,
  LANE_SPACING,
  UNITS_PER_METRE,
  POINTS_LENGTH,
  deviceLook,
  laneOf,
  toScreenX,
  type DeviceKey,
  type Frame,
} from './layout';
import { railFit } from './rails';

// The fixed scenery: track, platforms, the four devices and the junction zone. It changes only
// to show which devices are switched on and whether the junction zone has a train in it.

export interface World {
  /** Swaps the flat strips for the kit's track pieces. Call once, when the models have loaded. */
  useKitRails(rail: THREE.Object3D): void;
  /** Height of the top of the rail, where a train's wheels sit. */
  railTop(): number;
  setDevices(sw: Switches): void;
  setJunctionBusy(busy: boolean): void;
}

const STRIP_HEIGHT = 0.4;
const STRIP_DEPTH = 2.2;
const KIT_RAIL_TOP = 0.1;
/** How far beyond the frame to draw track, in metres, so it never ends inside the picture. */
const TRACK_MARGIN = 300;

const STRIP_COLOR: Record<TrackId, number> = {
  A: 0x4a5a70,
  B: 0x4a5a70,
  P1: 0x7088a6,
  P2: 0x7088a6,
  P3: 0x7088a6,
  P4: 0x7088a6,
  EXIT: 0x4a5a70,
};

function material(color: number, roughness = 0.85): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.05 });
}

function roundedBox(w: number, h: number, d: number, color: number, radius = 0.15): THREE.Mesh {
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(radius, w / 2, h / 2, d / 2)), material(color));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

interface Device {
  body: THREE.MeshStandardMaterial;
  roof: THREE.MeshStandardMaterial | null;
  lamp: THREE.MeshStandardMaterial;
}

export function buildWorld(scene: THREE.Scene, frame: Frame, trees = 0): World {
  const z = (track: TrackId) => laneOf(track) * LANE_SPACING;
  const x = (metres: number) => toScreenX(metres, frame);
  const tracks = Object.keys(TRACK_START) as TrackId[];

  // Flat strips until the kit loads, and for good if it never does.
  const strips = new THREE.Group();
  for (const track of tracks) {
    const length = TRACK_LENGTH[track] * UNITS_PER_METRE;
    const strip = new THREE.Mesh(new THREE.BoxGeometry(length, STRIP_HEIGHT, STRIP_DEPTH), material(STRIP_COLOR[track]));
    strip.position.set(x(TRACK_START[track]) + length / 2, STRIP_HEIGHT / 2, z(track));
    strip.receiveShadow = true;
    strips.add(strip);
  }
  scene.add(strips);
  let top = STRIP_HEIGHT;

  // Platform islands sit in the A and B lanes, which are empty beside the platforms.
  // The islands start after the points, where the platform tracks run straight.
  const islandStart = TRACK_START.P1 + POINTS_LENGTH + 10;
  const islandEnd = TRACK_START.EXIT;
  const platformLength = (islandEnd - islandStart) * UNITS_PER_METRE;
  const platformX = x((islandStart + islandEnd) / 2);
  for (const lane of ['A', 'B'] as const) {
    const island = roundedBox(platformLength, 0.55, 4.2, 0xaebfd6, 0.2);
    island.position.set(platformX, 0.28, z(lane));
    scene.add(island);
    for (const side of [-1, 1]) {
      const edge = roundedBox(platformLength, 0.1, 0.18, 0xeef2f7, 0.04);
      edge.position.set(platformX, 0.58, z(lane) + side * 1.95);
      scene.add(edge);
    }
    // A small shelter, not a canopy, so the trains stay visible from above.
    const roof = roundedBox(5, 0.22, 1.6, 0xe6c9a0, 0.08);
    roof.position.set(platformX, 2.6, z(lane));
    scene.add(roof);
    for (const dx of [-2, 2]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2, 8), material(0x5b6b80));
      post.position.set(platformX + dx, 1.5, z(lane));
      post.castShadow = true;
      scene.add(post);
    }
  }

  // The junction zone: the last 100 m of every platform and the first 200 m of EXIT.
  const zoneMaterial = new THREE.MeshBasicMaterial({ color: 0xd9a441, transparent: true, opacity: 0.12, depthWrite: false });
  const lanes = (['P1', 'P2', 'P3', 'P4'] as const).map(z);
  const zoneWidth = x(TRACK_START.EXIT) - x(JUNCTION_START_X);
  const ends = new THREE.Mesh(new THREE.PlaneGeometry(zoneWidth, Math.max(...lanes) - Math.min(...lanes) + 3), zoneMaterial);
  ends.rotation.x = -Math.PI / 2;
  ends.position.set(x(JUNCTION_START_X) + zoneWidth / 2, 0.03, (Math.max(...lanes) + Math.min(...lanes)) / 2);
  const exitWidth = x(JUNCTION_END_X) - x(TRACK_START.EXIT);
  const start = new THREE.Mesh(new THREE.PlaneGeometry(exitWidth, 3), zoneMaterial);
  start.rotation.x = -Math.PI / 2;
  start.position.set(x(TRACK_START.EXIT) + exitWidth / 2, 0.03, z('EXIT'));
  scene.add(ends, start);

  // A few trees well away from the track. Decoration only, placed the same way every time.
  for (let i = 0; i < trees; i++) {
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 1.1, 8), material(0x6b4f3a));
    trunk.position.y = 0.55;
    const crown = new THREE.Mesh(new THREE.ConeGeometry(1.25 + (i % 3) * 0.2, 3.2, 9), material(i % 2 ? 0x3d7a55 : 0x4a8a5d));
    crown.position.y = 2.6;
    for (const m of [trunk, crown]) {
      m.castShadow = true;
      tree.add(m);
    }
    const far = i % 2 === 0;
    tree.position.set(((i * 37) % 100) / 100 * frame.width, 0, far ? -14 - ((i * 7) % 9) : 26 + ((i * 5) % 9));
    scene.add(tree);
  }

  // The four devices: a control centre building, a hut for each keeper, a post for the sensors.
  const devices = new Map<DeviceKey, Device>();
  const lampMaterial = () => new THREE.MeshStandardMaterial({ color: 0x7be07b, emissive: 0x3bd13b, emissiveIntensity: 1.4 });
  for (const key of Object.keys(DEVICE_SITES) as DeviceKey[]) {
    const site = DEVICE_SITES[key];
    const look = deviceLook(key, true);
    const group = new THREE.Group();
    group.position.set(x(site.x), 0, site.z);
    const lamp = lampMaterial();
    let device: Device;
    if (key === 'centre') {
      const body = roundedBox(3, 2, 2.2, look.body, 0.25);
      body.position.y = 1;
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.4, 8), material(0xc5ccd6));
      mast.position.y = 2.7;
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), lamp);
      bulb.position.y = 3.5;
      group.add(body, mast, bulb);
      device = { body: body.material as THREE.MeshStandardMaterial, roof: null, lamp };
    } else if (key === 'sensors') {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 1.5, 10), material(look.body));
      post.position.y = 0.75;
      post.castShadow = true;
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 10), lamp);
      bulb.position.y = 1.65;
      group.add(post, bulb);
      device = { body: post.material as THREE.MeshStandardMaterial, roof: null, lamp };
    } else {
      const hut = roundedBox(1.6, 1.2, 1.4, look.body, 0.2);
      hut.position.y = 0.6;
      const roof = roundedBox(1.9, 0.2, 1.7, look.roof, 0.08);
      roof.position.y = 1.3;
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), lamp);
      bulb.position.set(0, 1.6, 0);
      group.add(hut, roof, bulb);
      device = {
        body: hut.material as THREE.MeshStandardMaterial,
        roof: roof.material as THREE.MeshStandardMaterial,
        lamp,
      };
    }
    scene.add(group);
    devices.set(key, device);
  }

  function useKitRails(rail: THREE.Object3D): void {
    const mesh = rail.getObjectByProperty('isMesh', true) as THREE.Mesh | undefined;
    if (!mesh) return;
    rail.updateMatrixWorld(true);
    // One piece, centred on its middle, running along +x.
    const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    geometry.computeBoundingBox();
    // Read the sizes first: translate and rotate recompute the bounding box.
    const box = geometry.boundingBox!.clone();
    const centre = box.getCenter(new THREE.Vector3());
    const pieceUnits = box.max.z - box.min.z;
    geometry.translate(-centre.x, -box.min.y, -centre.z);
    geometry.rotateY(Math.PI / 2);
    const pieceMetres = pieceUnits / UNITS_PER_METRE;

    const placements: THREE.Matrix4[] = [];
    // Straight track from `from` to `to` metres in one lane, filled exactly with pieces.
    const straight = (lane: TrackId, from: number, to: number) => {
      const a = Math.max(from, frame.xMin - TRACK_MARGIN);
      const b = Math.min(to, frame.xMax + TRACK_MARGIN);
      const fit = railFit(b - a, pieceMetres);
      for (let i = 0; i < fit.count; i++) {
        const at = a + (i + 0.5) * fit.step;
        placements.push(new THREE.Matrix4().compose(new THREE.Vector3(x(at), 0, z(lane)), new THREE.Quaternion(), new THREE.Vector3(fit.scale, 1, 1)));
      }
    };
    // Entry lines run straight to their end, where they split. Platforms run straight once
    // past the points. EXIT runs straight once the platforms have joined it.
    for (const entry of ['A', 'B'] as const) straight(entry, TRACK_START[entry], TRACK_START[entry] + TRACK_LENGTH[entry]);
    for (const p of ['P1', 'P2', 'P3', 'P4'] as const) straight(p, TRACK_START[p] + POINTS_LENGTH, TRACK_START.EXIT);
    straight('EXIT', TRACK_START.EXIT + POINTS_LENGTH, TRACK_START.EXIT + TRACK_LENGTH.EXIT);
    // The points: each entry line bends into its two platforms, and each platform bends into
    // EXIT. Trains follow the same path (pathAt in layout.ts).
    const diagonal = (fromX: number, fromZ: number, toX: number, toZ: number) => {
      const dx = x(toX) - x(fromX);
      const dz = toZ - fromZ;
      const length = Math.hypot(dx, dz);
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3((x(fromX) + x(toX)) / 2, 0, (fromZ + toZ) / 2),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.atan2(dz, dx)),
        new THREE.Vector3(length / pieceUnits, 1, 1),
      );
      placements.push(m);
    };
    const split = TRACK_START.P1;
    diagonal(split, z('A'), split + POINTS_LENGTH, z('P1'));
    diagonal(split, z('A'), split + POINTS_LENGTH, z('P2'));
    diagonal(split, z('B'), split + POINTS_LENGTH, z('P3'));
    diagonal(split, z('B'), split + POINTS_LENGTH, z('P4'));
    for (const p of ['P1', 'P2', 'P3', 'P4'] as const) diagonal(TRACK_START.EXIT, z(p), TRACK_START.EXIT + POINTS_LENGTH, z('EXIT'));

    const rails = new THREE.InstancedMesh(geometry, mesh.material, placements.length);
    placements.forEach((m, i) => rails.setMatrixAt(i, m));
    rails.receiveShadow = true;
    scene.remove(strips);
    scene.add(rails);
    top = KIT_RAIL_TOP;
  }

  function setDevices(sw: Switches): void {
    for (const [key, d] of devices) {
      const look = deviceLook(key, sw[key]);
      d.body.color.setHex(look.body);
      d.roof?.color.setHex(look.roof);
      d.lamp.color.setHex(look.light ?? 0x221818);
      d.lamp.emissive.setHex(look.light === null ? 0x000000 : 0x3bd13b);
      d.lamp.emissiveIntensity = look.light === null ? 0 : 1.4;
    }
  }

  function setJunctionBusy(busy: boolean): void {
    zoneMaterial.opacity = busy ? 0.32 : 0.12;
  }

  return { useKitRails, railTop: () => top, setDevices, setJunctionBusy };
}
