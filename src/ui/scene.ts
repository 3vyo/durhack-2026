import * as THREE from 'three';
import type { Snapshot } from '../engine/engine';
import { TRACK_LENGTH, TRACK_START } from '../engine/map';
import type { TrackId } from '../shared/types';
import {
  LANE_SPACING,
  cameraPreset,
  isStopped,
  laneOf,
  markersFor,
  modeColor,
  toScreenX,
  type CameraMode,
  type Frame,
} from './layout';

export interface SceneView {
  /** Draws one snapshot. The view only reads it. */
  render(s: Snapshot): void;
  setCamera(mode: CameraMode): void;
  /** Calls back with the id of the train under a click, or null for a click on empty space. */
  onPick(handler: (id: number | null) => void): void;
  resize(): void;
  dispose(): void;
}

const TRAIN_HEIGHT = 10;
const TRAIN_DEPTH = 14;
const TRACK_DEPTH = 22;
const TRACK_HEIGHT = 4;
const STOPPED_DIM = 0.4;
const DEVICE_ON = 0x7be07b;
const DEVICE_OFF = 0x7a2f2f; // dull red: clearly off, and still visible against the background

const TRACK_COLOR: Record<TrackId, number> = {
  A: 0x4a5a70,
  B: 0x4a5a70,
  P1: 0x7088a6,
  P2: 0x7088a6,
  P3: 0x7088a6,
  P4: 0x7088a6,
  EXIT: 0x4a5a70,
};

type DeviceKey = 'centre' | 'station' | 'merge' | 'sensors';

/** Where each device sits, in metres along the track and scene z. They go dark when switched off. */
const DEVICES: Array<{ key: DeviceKey; x: number; z: number }> = [
  { key: 'centre', x: 5500, z: -90 },
  { key: 'station', x: 5200, z: -40 },
  { key: 'merge', x: 6300, z: -40 },
  { key: 'sensors', x: 5800, z: -40 },
];

/**
 * Builds the whole three.js scene once: flat strips for tracks and platforms, boxes for
 * trains coloured by mode, markers for the devices that go dark when switched off, and a
 * camera that can switch between an angled and an overhead view. Labels, controls and
 * metrics are plain HTML outside the scene.
 */
export function createScene(container: HTMLElement, frame: Frame): SceneView {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f141b);
  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const sun = new THREE.DirectionalLight(0xffffff, 0.9);
  sun.position.set(frame.width / 2, 600, 400);
  scene.add(sun);

  const scale = frame.width / (frame.xMax - frame.xMin);
  for (const track of Object.keys(TRACK_START) as TrackId[]) {
    const length = TRACK_LENGTH[track] * scale;
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(length, TRACK_HEIGHT, TRACK_DEPTH),
      new THREE.MeshStandardMaterial({ color: TRACK_COLOR[track] }),
    );
    strip.position.set(
      toScreenX(TRACK_START[track], frame) + length / 2,
      TRACK_HEIGHT / 2,
      laneOf(track) * LANE_SPACING,
    );
    scene.add(strip);
  }

  const devices = new Map<DeviceKey, THREE.MeshStandardMaterial>();
  for (const d of DEVICES) {
    const material = new THREE.MeshStandardMaterial({ color: DEVICE_ON });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(24, 14, 24), material);
    mesh.position.set(toScreenX(d.x, frame), 7, d.z);
    scene.add(mesh);
    devices.set(d.key, material);
  }

  const camera = new THREE.PerspectiveCamera(45, 1, 1, 50000);
  const trainGeometry = new THREE.BoxGeometry(1, TRAIN_HEIGHT, TRAIN_DEPTH);
  const trains = new Map<number, THREE.Mesh>();

  function setCamera(mode: CameraMode): void {
    const { position, lookAt } = cameraPreset(mode, frame);
    camera.position.set(...position);
    // Looking straight down makes "up" ambiguous, so point the top of the picture at -z.
    camera.up.set(0, mode === 'overhead' ? 0 : 1, mode === 'overhead' ? -1 : 0);
    camera.lookAt(...lookAt);
  }

  function resize(): void {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function render(s: Snapshot): void {
    for (const [key, material] of devices) material.color.setHex(s.switches[key] ? DEVICE_ON : DEVICE_OFF);

    const seen = new Set<number>();
    for (const m of markersFor(s, frame)) {
      seen.add(m.id);
      let mesh = trains.get(m.id);
      if (!mesh) {
        mesh = new THREE.Mesh(trainGeometry, new THREE.MeshStandardMaterial());
        scene.add(mesh);
        trains.set(m.id, mesh);
      }
      const colour = new THREE.Color(modeColor(m.mode));
      if (isStopped(m.speed)) colour.multiplyScalar(STOPPED_DIM);
      (mesh.material as THREE.MeshStandardMaterial).color.copy(colour);
      mesh.scale.x = m.lengthPx;
      mesh.position.set(m.px - m.lengthPx / 2, TRACK_HEIGHT + TRAIN_HEIGHT / 2, m.lane * LANE_SPACING);
    }
    for (const [id, mesh] of trains) {
      if (!seen.has(id)) {
        scene.remove(mesh);
        (mesh.material as THREE.Material).dispose();
        trains.delete(id);
      }
    }
    renderer.render(scene, camera);
  }

  const raycaster = new THREE.Raycaster();
  function onPick(handler: (id: number | null) => void): void {
    renderer.domElement.addEventListener('click', (e) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
      const hit = raycaster.intersectObjects([...trains.values()])[0];
      if (!hit) return handler(null);
      for (const [id, mesh] of trains) if (mesh === hit.object) return handler(id);
      handler(null);
    });
  }

  function dispose(): void {
    renderer.dispose();
    renderer.domElement.remove();
  }

  setCamera('angled');
  resize();
  return { render, setCamera, onPick, resize, dispose };
}
