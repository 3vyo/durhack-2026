import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Snapshot } from '../engine/engine';
import { TRAIN_LENGTH } from '../shared/constants';
import { TRACK_LENGTH, TRACK_START } from '../shared/map';
import type { TrackId } from '../shared/types';
import {
  LANE_SPACING,
  cameraPreset,
  isStopped,
  laneOf,
  markersFor,
  toScreenX,
  type CameraMode,
  type Frame,
} from './layout';
import { RAIL_PIECE, TRAIN_UNIT, assetUrl } from './assets';
import { consistLayout, disposeAll, trainIdOf } from './consist';
import { loadKit, type KitParts, type Size } from './kit';
import { bodyDim, drawShape, markerSpec, type MarkerSpec } from './markers';
import { SURFACE } from './palette';

export interface SceneView {
  /** Draws one snapshot. The view only reads it. */
  render(s: Snapshot): void;
  setCamera(mode: CameraMode): void;
  /** Calls back with the id of the train under a click, or null for a click on empty space. */
  onPick(handler: (id: number | null) => void): void;
  /**
   * Where each drawn train's middle is on the canvas, in CSS pixels from its top left corner.
   * For the demo check, which clicks a real train. Trains off the canvas are left out.
   */
  trainScreenPoints(): Array<{ id: number; x: number; y: number }>;
  resize(): void;
  dispose(): void;
}

// Sizes in scene units, 0.08 per metre (see UNITS_PER_METRE in layout.ts).
const TRAIN_HEIGHT = 1;
const TRAIN_DEPTH = 1.4;
const TRACK_DEPTH = 2.2;
const TRACK_HEIGHT = 0.4;
const TRAIN_BODY = 0xc9d1dc; // a light grey body; the marker above it carries the mode colour
const DEVICE_ON = 0x7be07b;
const DEVICE_OFF = 0x7a2f2f; // dull red: clearly off, and still visible against the background
/** Marker height on screen, as a share of the canvas height. It does not shrink with distance. */
const MARKER_SIZE = 0.055;
const MARKER_LIFT_BOX = 2.4; // scene units above the rail, over a box train
const MARKER_LIFT_MODEL = 2.2; // just over the roof of a model train, which is 1.93 high
const CAR_GAP = 0.12; // model units between the cars of one unit

const TRACK_COLOR: Record<TrackId, number> = {
  A: 0x4a5a70,
  B: 0x4a5a70,
  P1: 0x7088a6,
  P2: 0x7088a6,
  P3: 0x7088a6,
  P4: 0x7088a6,
  EXIT: 0x4a5a70,
};

type DeviceKey = 'centre' | 'platformKeeper' | 'junctionKeeper' | 'sensors';

/** Where each device sits, in metres along the track and scene z. They go dark when switched off. */
const DEVICES: Array<{ key: DeviceKey; x: number; z: number }> = [
  { key: 'centre', x: 5500, z: -9 },
  { key: 'platformKeeper', x: 5200, z: -4 },
  { key: 'junctionKeeper', x: 6300, z: -4 },
  { key: 'sensors', x: 5800, z: -4 },
];

/** One drawn train: a group carrying its body, its mode marker and a STOPPED tag. */
interface DrawnTrain {
  group: THREE.Group;
  /** A box before the models load or if they fail, else the three cars of the kit's unit. */
  body: THREE.Object3D;
  /** The body's own materials, cloned per train so dimming one train leaves the others alone. */
  bodyMaterials: THREE.MeshStandardMaterial[];
  marker: THREE.Sprite;
  tag: THREE.Sprite;
  /** True if the body is the kit model, false for the box. */
  model: boolean;
}

/** The size of an object along the kit's axes: models run along z. */
function measure(o: THREE.Object3D): Size {
  const size = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());
  return { length: size.z, width: size.x, height: size.y };
}

/** One canvas texture per shape and colour, shared by every marker that needs it. */
function markerTextures(): (spec: MarkerSpec) => THREE.CanvasTexture {
  const cache = new Map<string, THREE.CanvasTexture>();
  return (spec) => {
    const key = `${spec.shape}${spec.css}`;
    let texture = cache.get(key);
    if (!texture) {
      const canvas = Object.assign(document.createElement('canvas'), { width: 128, height: 128 });
      drawShape(canvas.getContext('2d')!, spec.shape, 64, 64, 44, spec.css, '#0b0f14', 10);
      texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      cache.set(key, texture);
    }
    return texture;
  };
}

function stoppedTexture(): THREE.CanvasTexture {
  const canvas = Object.assign(document.createElement('canvas'), { width: 256, height: 64 });
  const g = canvas.getContext('2d')!;
  g.fillStyle = 'rgba(11,15,20,0.85)';
  g.beginPath();
  g.roundRect(8, 10, 240, 44, 12);
  g.fill();
  g.fillStyle = '#ffb4c8';
  g.font = '700 30px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('STOPPED', 128, 33);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Builds the whole three.js scene once: flat strips for tracks and platforms, a train body per
 * train with its mode's shape marker above it, boxes for the devices that go dark when switched
 * off, and a camera that can switch between an angled and an overhead view. Labels, controls
 * and metrics are plain HTML outside the scene.
 */
export function createScene(container: HTMLElement, frame: Frame): SceneView {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SURFACE.scene);
  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const sun = new THREE.DirectionalLight(0xffffff, 0.9);
  sun.position.set(frame.width / 2, 60, 40);
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
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.4, 2.4), material);
    mesh.position.set(toScreenX(d.x, frame), 0.7, d.z);
    scene.add(mesh);
    devices.set(d.key, material);
  }

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
  const trainGeometry = new THREE.BoxGeometry(1, TRAIN_HEIGHT, TRAIN_DEPTH);
  const textureFor = markerTextures();
  const stoppedTag = stoppedTexture();
  const trains = new Map<number, DrawnTrain>();
  const trainLength = TRAIN_LENGTH * (frame.width / (frame.xMax - frame.xMin));

  // The models load once, in the background. Until then, or if any fails, trains are boxes.
  let kit: KitParts<THREE.Object3D> | null = null;
  const loader = new GLTFLoader();
  const base = import.meta.env.BASE_URL;
  void loadKit(
    async (url) => (await loader.loadAsync(url)).scene,
    measure,
    { cars: TRAIN_UNIT.map((n) => assetUrl(n, base)), rail: assetUrl(RAIL_PIECE, base) },
    (e) => console.warn('The train models did not load, so trains are drawn as boxes.', e),
  ).then((loaded) => {
    kit = loaded;
    if (!kit) return;
    // Rebuild every train from the models on the next render.
    for (const t of trains.values()) disposeTrain(t);
    trains.clear();
  });

  /** One unit from the kit, nose towards +x, its centre at the origin, wheels at y 0. */
  function modelBody(): { body: THREE.Object3D; materials: THREE.MeshStandardMaterial[] } {
    const parts = kit!;
    const { scale, centres } = consistLayout(parts.carSizes.map((s) => s.length), trainLength, CAR_GAP);
    const body = new THREE.Group();
    const materials: THREE.MeshStandardMaterial[] = [];
    parts.cars.forEach((car, i) => {
      const copy = car.clone(true);
      const box = new THREE.Box3().setFromObject(car);
      const centre = box.getCenter(new THREE.Vector3());
      copy.position.set(-centre.x, -box.min.y, -centre.z);
      // Share the geometry, clone the material, so each train dims on its own.
      copy.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const material = (mesh.material as THREE.MeshStandardMaterial).clone();
        material.userData.base = material.color.getHex();
        mesh.material = material;
        materials.push(material);
      });
      const holder = new THREE.Group();
      holder.add(copy);
      holder.rotation.y = Math.PI / 2; // the model runs along +z; this points it along +x
      holder.scale.setScalar(scale);
      holder.position.x = centres[i];
      body.add(holder);
    });
    return { body, materials };
  }

  function makeTrain(id: number): DrawnTrain {
    const group = new THREE.Group();
    group.userData.trainId = id;
    const model = kit !== null;
    let body: THREE.Object3D;
    let bodyMaterials: THREE.MeshStandardMaterial[];
    if (model) {
      ({ body, materials: bodyMaterials } = modelBody());
      body.position.y = TRACK_HEIGHT;
    } else {
      const material = new THREE.MeshStandardMaterial({ color: TRAIN_BODY });
      material.userData.base = TRAIN_BODY;
      body = new THREE.Mesh(trainGeometry, material);
      body.position.y = TRACK_HEIGHT + TRAIN_HEIGHT / 2;
      bodyMaterials = [material];
    }
    const marker = new THREE.Sprite(new THREE.SpriteMaterial({ sizeAttenuation: false, depthTest: false, transparent: true }));
    marker.scale.set(MARKER_SIZE, MARKER_SIZE, 1);
    // Draw the marker just above its train on screen, not over it, in both camera views.
    marker.center.set(0.5, -0.15);
    marker.renderOrder = 2;
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: stoppedTag, sizeAttenuation: false, depthTest: false, transparent: true }));
    tag.scale.set(MARKER_SIZE * 2.2, MARKER_SIZE * 0.55, 1);
    tag.center.set(0.5, 1.6);
    tag.renderOrder = 2;
    const lift = model ? MARKER_LIFT_MODEL : MARKER_LIFT_BOX;
    marker.position.y = lift;
    tag.position.y = lift;
    group.add(body, marker, tag);
    scene.add(group);
    return { group, body, bodyMaterials, marker, tag, model };
  }

  function disposeTrain(t: DrawnTrain): void {
    scene.remove(t.group);
    disposeAll([...t.bodyMaterials, t.marker.material as THREE.SpriteMaterial, t.tag.material as THREE.SpriteMaterial]);
  }

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
      let t = trains.get(m.id);
      if (!t) {
        t = makeTrain(m.id);
        trains.set(m.id, t);
      }
      const stopped = isStopped(m.speed);
      const spec = markerSpec(m.mode, stopped);
      const dim = bodyDim(stopped);
      for (const material of t.bodyMaterials) material.color.setHex(material.userData.base as number).multiplyScalar(dim);
      const markerMaterial = t.marker.material as THREE.SpriteMaterial;
      markerMaterial.map = textureFor(spec);
      markerMaterial.opacity = spec.opacity;
      t.tag.visible = spec.stopped;
      if (!t.model) t.body.scale.x = m.lengthPx;
      t.group.position.set(m.px - m.lengthPx / 2, 0, m.lane * LANE_SPACING);
    }
    for (const [id, t] of trains) {
      if (!seen.has(id)) {
        disposeTrain(t);
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
      const bodies = [...trains.values()].map((t) => t.body);
      const hit = raycaster.intersectObjects(bodies, true)[0];
      handler(hit ? trainIdOf(hit.object) : null);
    });
  }

  function trainScreenPoints(): Array<{ id: number; x: number; y: number }> {
    const rect = renderer.domElement.getBoundingClientRect();
    const points: Array<{ id: number; x: number; y: number }> = [];
    for (const [id, t] of trains) {
      const p = t.group.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 1, 0)).project(camera);
      if (Math.abs(p.x) > 1 || Math.abs(p.y) > 1 || p.z > 1) continue;
      points.push({ id, x: ((p.x + 1) / 2) * rect.width, y: ((1 - p.y) / 2) * rect.height });
    }
    return points;
  }

  // The page around the scene changes height as the scoreboard fills in, so the canvas has to
  // follow its container and not just the window. Without this the bottom of each scene is
  // clipped and the camera's target drifts off centre.
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => resize());
  observer?.observe(container);

  function dispose(): void {
    observer?.disconnect();
    for (const t of trains.values()) disposeTrain(t);
    trains.clear();
    renderer.dispose();
    renderer.domElement.remove();
  }

  setCamera('angled');
  resize();
  return { render, setCamera, onPick, trainScreenPoints, resize, dispose };
}
