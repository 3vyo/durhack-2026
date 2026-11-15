import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Snapshot } from '../engine/engine';
import { TRAIN_LENGTH } from '../shared/constants';
import {
  DEFAULT_CAMERA,
  LANE_SPACING,
  cameraPreset,
  labelAnchors,
  ndcToCss,
  toScreenX,
  isStopped,
  junctionBusy,
  markersFor,
  type CameraMode,
  type Frame,
} from './layout';
import { RAIL_PIECE, TRAIN_UNIT, assetUrl } from './assets';
import { consistLayout, disposeAll, trainIdOf } from './consist';
import { loadKit, type KitParts, type Size } from './kit';
import { bodyDim, drawShape, markerSpec, type MarkerSpec } from './markers';
import { ENVIRONMENT, qualityPreset, type QualityPreset } from './environment';
import { buildWorld } from './world';

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
const TRAIN_BODY = 0xc9d1dc; // a light grey body; the marker above it carries the mode colour
/** Marker height on screen, as a share of the canvas height. It does not shrink with distance. */
const MARKER_SIZE = 0.055;
const MARKER_LIFT_BOX = 2.4; // scene units above the rail, over a box train
const MARKER_LIFT_MODEL = 2.2; // just over the roof of a model train, which is 1.93 high
const CAR_GAP = 0.12; // model units between the cars of one unit

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

/** A vertical gradient for the sky behind the scene. */
function skyTexture(): THREE.CanvasTexture {
  const canvas = Object.assign(document.createElement('canvas'), { width: 2, height: 256 });
  const g = canvas.getContext('2d')!;
  const gradient = g.createLinearGradient(0, 0, 0, 256);
  ENVIRONMENT.sky.forEach((colour, i) => gradient.addColorStop(i / (ENVIRONMENT.sky.length - 1), colour));
  g.fillStyle = gradient;
  g.fillRect(0, 0, 2, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
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
 * Builds the whole three.js scene once: the scenery from world.ts, a train per train with its
 * mode's shape marker above it, and a camera that can switch between an angled and an overhead
 * view. Labels, controls and metrics are plain HTML outside the scene.
 */
export function createScene(
  container: HTMLElement,
  frame: Frame,
  quality: QualityPreset = qualityPreset('high'),
): SceneView {
  const renderer = new THREE.WebGLRenderer({ antialias: quality.antialias });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatioCap));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = ENVIRONMENT.exposure;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = quality.shadows;
  // three 0.187 has no PCFSoftShadowMap any more. PCF with a shadow radius is close enough.
  renderer.shadowMap.type = THREE.PCFShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = skyTexture();
  const fog = new THREE.Fog(ENVIRONMENT.fog.color, 100, 300);
  scene.fog = fog;
  const centre = new THREE.Vector3(frame.width / 2, 0, 2.5 * LANE_SPACING);
  scene.add(new THREE.HemisphereLight(ENVIRONMENT.hemisphere.sky, ENVIRONMENT.hemisphere.ground, ENVIRONMENT.hemisphere.intensity));
  const sun = new THREE.DirectionalLight(ENVIRONMENT.sun.color, ENVIRONMENT.sun.intensity);
  sun.position.set(centre.x + 30, 60, centre.z + 35);
  sun.target.position.copy(centre);
  if (quality.shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    // Cover the whole stage, about 144 by 30 units, centred on the frame.
    Object.assign(sun.shadow.camera, { left: -80, right: 80, top: 40, bottom: -40, near: 1, far: 200 });
    sun.shadow.radius = 3;
    sun.shadow.bias = -0.0004;
  }
  scene.add(sun, sun.target);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(frame.width * 4, frame.width * 3),
    new THREE.MeshStandardMaterial({ color: ENVIRONMENT.ground, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(centre.x, -0.01, centre.z);
  ground.receiveShadow = true;
  scene.add(ground);

  const world = buildWorld(scene, frame, quality.trees);

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
    world.useKitRails(kit.rail);
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
        mesh.castShadow = true;
        mesh.receiveShadow = true;
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
      body.position.y = world.railTop();
    } else {
      const material = new THREE.MeshStandardMaterial({ color: TRAIN_BODY });
      material.userData.base = TRAIN_BODY;
      body = new THREE.Mesh(trainGeometry, material);
      body.position.y = world.railTop() + TRAIN_HEIGHT / 2;
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

  let cameraMode: CameraMode = DEFAULT_CAMERA;
  function setCamera(mode: CameraMode): void {
    cameraMode = mode;
    const { position, lookAt } = cameraPreset(mode, frame, camera.aspect);
    camera.position.set(...position);
    // Looking straight down makes "up" ambiguous, so point the top of the picture at -z.
    camera.up.set(0, mode === 'overhead' ? 0 : 1, mode === 'overhead' ? -1 : 0);
    camera.lookAt(...lookAt);
    // Haze the far edges, whichever view: fog from just beyond what the camera looks at.
    const distance = camera.position.distanceTo(new THREE.Vector3(...lookAt));
    fog.near = distance * ENVIRONMENT.fog.near;
    fog.far = distance * ENVIRONMENT.fog.far;
  }

  function resize(): void {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // The camera backs off just enough to fit the frame at this shape of canvas.
    setCamera(cameraMode);
  }

  // Labels for the tracks and devices are HTML over the canvas, so they stay sharp and readable.
  const labelLayer = document.createElement('div');
  labelLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:1;';
  container.appendChild(labelLayer);
  const labels = labelAnchors(frame).map((a) => {
    const node = document.createElement('div');
    node.textContent = a.text;
    node.style.cssText =
      a.kind === 'track'
        ? 'position:absolute;transform:translate(-50%,-50%);padding:1px 7px;border-radius:9px;font:700 12px system-ui,sans-serif;color:#e6edf3;background:rgba(11,15,20,0.72);'
        : 'position:absolute;transform:translate(-50%,-100%);padding:1px 6px;border-radius:6px;font:600 11px system-ui,sans-serif;color:#c9d4e0;background:rgba(11,15,20,0.6);white-space:nowrap;';
    labelLayer.appendChild(node);
    return { node, at: new THREE.Vector3(toScreenX(a.x, frame), a.kind === 'track' ? 0.2 : 0, a.z) };
  });
  function placeLabels(): void {
    const w = container.clientWidth;
    const h = container.clientHeight;
    for (const l of labels) {
      const p = l.at.clone().project(camera);
      const visible = Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 && p.z < 1;
      l.node.style.display = visible ? '' : 'none';
      if (!visible) continue;
      const { left, top } = ndcToCss(p, w, h);
      l.node.style.left = `${left}px`;
      l.node.style.top = `${top}px`;
    }
  }

  function render(s: Snapshot): void {
    world.setDevices(s.switches);
    world.setJunctionBusy(junctionBusy(s));

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
    placeLabels();
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
    labelLayer.remove();
  }

  setCamera(DEFAULT_CAMERA);
  resize();
  return { render, setCamera, onPick, trainScreenPoints, resize, dispose };
}
