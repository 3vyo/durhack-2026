import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Switches } from '../engine/switches';
import {
  ENTRIES,
  JUNCTION_END_X,
  JUNCTION_START_X,
  PLATFORMS,
  TRACK_LENGTH,
  TRACK_START,
  entryOf,
  isPlatform,
} from '../shared/map';
import type { PlatformId, TrackId } from '../shared/types';
import {
  DEVICE_SITES,
  LANE_SPACING,
  UNITS_PER_METRE,
  EXIT_MERGE,
  POINTS_LENGTH,
  deviceLook,
  exitJoinLength,
  laneOf,
  sensorSite,
  toScreenX,
  type DeviceKey,
  type Frame,
} from './layout';
import { railFit } from './rails';

// The fixed scenery: track, platforms, the four devices and the junction zone. It is built
// once, for the layout in use when the scene is made. After that it changes only to show which
// devices are switched on, what the platform sensors read, and whether the junction zone is
// drawn and has a train in it.

export interface World {
  /** Swaps the flat strips for the kit's track pieces. Call once, when the models have loaded. */
  useKitRails(rail: THREE.Object3D): void;
  /** Height of the top of the rail, where a train's wheels sit. */
  railTop(): number;
  setDevices(sw: Switches): void;
  /**
   * Shows the junction zone in yellow, brighter while a train is in it. With `visible` false
   * the zone is not drawn.
   */
  setJunctionZone(busy: boolean, visible: boolean): void;
  /**
   * Shows each platform sensor's reading on its track and its box's lamp. `on` is the sensors'
   * switch. With `visible` false the tracks are untinted and the lamps only show the switch.
   */
  setSensors(occupied: Readonly<Record<PlatformId, boolean>>, on: boolean, visible: boolean): void;
}

/** What a platform sensor shows: empty, occupied, or switched off (it then reads occupied). */
export type SensorShown = 'empty' | 'occupied' | 'off';

export function sensorReading(occupied: boolean, on: boolean): SensorShown {
  if (!on) return 'off';
  return occupied ? 'occupied' : 'empty';
}

/** The colour of each reading, on the platform track's tint and the box's lamp. */
export const SENSOR_TINT: Record<SensorShown, number> = { empty: 0x3fbf6a, occupied: 0xff5a5a, off: 0x8794a6 };

/** The junction zone's yellow, and how see-through it is when empty and when a train is in it. */
export const ZONE_COLOUR = 0xffd23f;
export const ZONE_OPACITY = { empty: 0.22, busy: 0.45 } as const;

/** Height of the top of a platform island, where the sensor boxes stand. */
const ISLAND_TOP = 0.55;

const STRIP_HEIGHT = 0.4;
const STRIP_DEPTH = 2.2;
const KIT_RAIL_TOP = 0.1;
/** How far beyond the frame to draw track, in metres, so it never ends inside the picture. */
const TRACK_MARGIN = 300;

/** A flat strip's colour: platforms are lighter than the entry lines and EXIT. */
function stripColor(track: TrackId): number {
  return isPlatform(track) ? 0x7088a6 : 0x4a5a70;
}

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
  // The tracks of the layout in use. A track outside it is never drawn.
  const entries = [...ENTRIES];
  const platforms = [...PLATFORMS];
  const tracks: TrackId[] = [...entries, ...platforms, 'EXIT'];

  // Flat strips until the kit loads, and for good if it never does.
  const strips = new THREE.Group();
  for (const track of tracks) {
    const length = TRACK_LENGTH[track] * UNITS_PER_METRE;
    const strip = new THREE.Mesh(new THREE.BoxGeometry(length, STRIP_HEIGHT, STRIP_DEPTH), material(stripColor(track)));
    strip.position.set(x(TRACK_START[track]) + length / 2, STRIP_HEIGHT / 2, z(track));
    strip.receiveShadow = true;
    strips.add(strip);
  }
  scene.add(strips);
  let top = STRIP_HEIGHT;

  // Platform islands sit in the entry lines' lanes, which are empty beside the platforms.
  // The islands start after the points, where the platform tracks run straight.
  // Every platform starts at the same x, where every entry line ends and splits.
  const split = TRACK_START[platforms[0]];
  const islandStart = split + POINTS_LENGTH + 10;
  const islandEnd = TRACK_START.EXIT;
  const platformLength = (islandEnd - islandStart) * UNITS_PER_METRE;
  const platformX = x((islandStart + islandEnd) / 2);
  for (const lane of entries) {
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
  const zoneMaterial = new THREE.MeshBasicMaterial({
    color: ZONE_COLOUR,
    transparent: true,
    opacity: ZONE_OPACITY.empty,
    depthWrite: false,
  });
  const lanes = platforms.map(z);
  const pairLanes = entries.map(z);
  // The platform ends and the pairs' merge share one patch; the start of EXIT gets another,
  // as wide as the pairs' lanes it gathers in.
  const pairsEnd = TRACK_START.EXIT + EXIT_MERGE.pairs;
  const zoneWidth = x(pairsEnd) - x(JUNCTION_START_X);
  const ends = new THREE.Mesh(new THREE.PlaneGeometry(zoneWidth, Math.max(...lanes) - Math.min(...lanes) + 3), zoneMaterial);
  ends.rotation.x = -Math.PI / 2;
  ends.position.set(x(JUNCTION_START_X) + zoneWidth / 2, 0.03, (Math.max(...lanes) + Math.min(...lanes)) / 2);
  const exitWidth = x(JUNCTION_END_X) - x(pairsEnd);
  const start = new THREE.Mesh(new THREE.PlaneGeometry(exitWidth, Math.max(...pairLanes) - Math.min(...pairLanes) + 3), zoneMaterial);
  start.rotation.x = -Math.PI / 2;
  start.position.set(x(pairsEnd) + exitWidth / 2, 0.03, (Math.max(...pairLanes) + Math.min(...pairLanes)) / 2);
  scene.add(ends, start);

  // A few trees well away from the track, beyond the first and the last lane. Decoration only,
  // placed the same way every time.
  const nearSide = Math.max(...lanes) + 6;
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
    tree.position.set(((i * 37) % 100) / 100 * frame.width, 0, far ? -14 - ((i * 7) % 9) : nearSide + ((i * 5) % 9));
    scene.add(tree);
  }

  // Each platform's sensor covers its whole track, from the points to where it joins EXIT. A
  // see-through strip over the rails shows what it reads.
  const sensorStrips = new Map<PlatformId, THREE.MeshBasicMaterial>();
  for (const p of platforms) {
    const tint = new THREE.MeshBasicMaterial({ color: SENSOR_TINT.empty, transparent: true, opacity: 0.35, depthWrite: false });
    const piece = (fromX: number, fromZ: number, toX: number, toZ: number) => {
      const dx = x(toX) - x(fromX);
      const dz = toZ - fromZ;
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(Math.hypot(dx, dz), 1.7), tint);
      strip.rotation.set(-Math.PI / 2, 0, -Math.atan2(dz, dx), 'YXZ');
      strip.position.set((x(fromX) + x(toX)) / 2, 0.16, (fromZ + toZ) / 2);
      strip.renderOrder = 1;
      scene.add(strip);
    };
    piece(split, z(entryOf(p)), split + POINTS_LENGTH, z(p));
    piece(split + POINTS_LENGTH, z(p), TRACK_START.EXIT, z(p));
    sensorStrips.set(p, tint);
  }
  const sensorLamps = new Map<PlatformId, THREE.MeshStandardMaterial>();

  // The four devices: a control centre building, a hut for each keeper, and a box per platform
  // for the sensors.
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
      // One box per platform, on the island beside its own track. They share a body, so the
      // switch greys them all, and each has its own lamp for its own reading.
      const body = material(look.body);
      for (const p of platforms) {
        const at = sensorSite(p);
        const box = new THREE.Mesh(new RoundedBoxGeometry(0.6, 0.5, 0.5, 2, 0.08), body);
        box.position.set(x(at.x), ISLAND_TOP + 0.25, at.z);
        box.castShadow = true;
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), lampMaterial());
        bulb.position.set(x(at.x), ISLAND_TOP + 0.65, at.z);
        scene.add(box, bulb);
        sensorLamps.set(p, bulb.material as THREE.MeshStandardMaterial);
      }
      device = { body, roof: null, lamp };
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
    for (const entry of entries) straight(entry, TRACK_START[entry], TRACK_START[entry] + TRACK_LENGTH[entry]);
    for (const p of platforms) straight(p, TRACK_START[p] + POINTS_LENGTH, TRACK_START.EXIT);
    const pairsJoined = TRACK_START.EXIT + EXIT_MERGE.pairs;
    // EXIT's own lane starts where the nearest pair reaches it. Pairs further out join it later.
    const firstJoined = pairsJoined + Math.min(...entries.map(exitJoinLength));
    straight('EXIT', firstJoined, TRACK_START.EXIT + TRACK_LENGTH.EXIT);
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
    for (const p of platforms) diagonal(split, z(entryOf(p)), split + POINTS_LENGTH, z(p));
    // The way out joins in two stages: each pair of platforms first, then every pair into EXIT.
    for (const p of platforms) diagonal(TRACK_START.EXIT, z(p), pairsJoined, z(entryOf(p)));
    for (const entry of entries) {
      const join = exitJoinLength(entry);
      // A pair already in line with EXIT runs straight on: EXIT's own track starts there.
      if (join <= 0) continue;
      // A long join is laid as several pieces end to end, each as long as the default layout's
      // one piece, so the sleepers are not stretched.
      const pieces = Math.max(1, Math.round(join / EXIT_MERGE.join));
      const stepX = join / pieces;
      const stepZ = (z('EXIT') - z(entry)) / pieces;
      for (let i = 0; i < pieces; i++) {
        diagonal(pairsJoined + i * stepX, z(entry) + i * stepZ, pairsJoined + (i + 1) * stepX, z(entry) + (i + 1) * stepZ);
      }
    }

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

  function setJunctionZone(busy: boolean, visible: boolean): void {
    ends.visible = visible;
    start.visible = visible;
    zoneMaterial.opacity = busy ? ZONE_OPACITY.busy : ZONE_OPACITY.empty;
  }

  function setSensors(occupied: Readonly<Record<PlatformId, boolean>>, on: boolean, visible: boolean): void {
    for (const strip of sensorStrips.values()) strip.visible = visible;
    for (const p of platforms) {
      const reading = sensorReading(occupied[p], on);
      sensorStrips.get(p)!.color.setHex(SENSOR_TINT[reading]);
      sensorStrips.get(p)!.opacity = reading === 'off' ? 0.2 : 0.35;
      const lamp = sensorLamps.get(p);
      if (!lamp) continue;
      // Hidden readings leave the lamp like any other device's: lit while switched on.
      const colour = reading === 'off' ? null : visible ? SENSOR_TINT[reading] : 0x7be07b;
      lamp.color.setHex(colour ?? 0x221818);
      lamp.emissive.setHex(colour === null ? 0x000000 : visible ? colour : 0x3bd13b);
      lamp.emissiveIntensity = colour === null ? 0 : 1.2;
    }
  }

  return { useKitRails, railTop: () => top, setDevices, setJunctionZone, setSensors };
}
