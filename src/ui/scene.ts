import * as THREE from 'three';
import type { Snapshot } from '../engine/engine';
import { TRACK_LENGTH, TRACK_START } from '../engine/map';
import type { TrackId } from '../shared/types';
import {
  LANE_SPACING,
  cameraPreset,
  laneOf,
  markersFor,
  toScreenX,
  type CameraMode,
  type Frame,
} from './layout';

export interface SceneView {
  /** Draws one snapshot. The view only reads it. */
  render(s: Snapshot): void;
  setCamera(mode: CameraMode): void;
  resize(): void;
  dispose(): void;
}

const TRAIN_HEIGHT = 8;
const TRAIN_DEPTH = 10;
const TRACK_DEPTH = 12;

const TRACK_COLOR: Record<TrackId, number> = {
  A: 0x3a4658,
  B: 0x3a4658,
  P1: 0x55657d,
  P2: 0x55657d,
  P3: 0x55657d,
  P4: 0x55657d,
  EXIT: 0x3a4658,
};

/**
 * Builds the whole three.js scene once: flat strips for tracks and platforms, boxes for
 * trains, and a camera that can switch between an angled and an overhead view. Labels,
 * controls and metrics are plain HTML outside the scene.
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
      new THREE.BoxGeometry(length, 2, TRACK_DEPTH),
      new THREE.MeshStandardMaterial({ color: TRACK_COLOR[track] }),
    );
    strip.position.set(toScreenX(TRACK_START[track], frame) + length / 2, 1, laneOf(track) * LANE_SPACING);
    scene.add(strip);
  }

  const camera = new THREE.PerspectiveCamera(45, 1, 1, 50000);
  const trainMaterial = new THREE.MeshStandardMaterial({ color: 0x4da3ff });
  const trainGeometry = new THREE.BoxGeometry(1, TRAIN_HEIGHT, TRAIN_DEPTH);
  const trains = new Map<number, THREE.Mesh>();

  function setCamera(mode: CameraMode): void {
    const { position, lookAt } = cameraPreset(mode, frame);
    camera.position.set(...position);
    camera.up.set(0, 1, 0);
    // Looking straight down makes "up" ambiguous, so point the top of the picture at -z.
    if (mode === 'overhead') camera.up.set(0, 0, -1);
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
    const seen = new Set<number>();
    for (const m of markersFor(s, frame)) {
      seen.add(m.id);
      let mesh = trains.get(m.id);
      if (!mesh) {
        mesh = new THREE.Mesh(trainGeometry, trainMaterial);
        scene.add(mesh);
        trains.set(m.id, mesh);
      }
      mesh.scale.x = m.lengthPx;
      mesh.position.set(m.px - m.lengthPx / 2, 2 + TRAIN_HEIGHT / 2, m.lane * LANE_SPACING);
    }
    for (const [id, mesh] of trains) {
      if (!seen.has(id)) {
        scene.remove(mesh);
        trains.delete(id);
      }
    }
    renderer.render(scene, camera);
  }

  function dispose(): void {
    renderer.dispose();
    renderer.domElement.remove();
  }

  setCamera('angled');
  resize();
  return { render, setCamera, resize, dispose };
}
