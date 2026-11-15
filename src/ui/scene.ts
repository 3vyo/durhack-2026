import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Snapshot } from '../engine/engine';
import type { EntryId, PlatformId } from '../shared/types';
import { TRAIN_LENGTH } from '../shared/constants';
import { isEntryTrack, isPlatform } from '../shared/map';
import {
  DEFAULT_CAMERA,
  LANE_SPACING,
  cameraPreset,
  laneOf,
  stageGrowth,
  UNITS_PER_METRE,
  labelAnchors,
  ndcToCss,
  pathAt,
  routeOf,
  toScreenX,
  type Route,
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
  /** Calls back with the id of a train that was double-clicked. */
  onDoublePick(handler: (id: number) => void): void;
  /** Keeps track of where trains are without drawing, for a view that is not on show. */
  observe(s: Snapshot): void;
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
const MARKER_SIZE = 0.042;
const MARKER_LIFT_BOX = 2.4; // scene units above the rail, over a box train
const MARKER_LIFT_MODEL = 2.2; // just over the roof of a model train, which is 1.93 high
const CAR_GAP = 0.12; // model units between the cars of one unit

/** One car of a drawn train, placed on its own so a train bends through the points. */
interface Car {
  holder: THREE.Object3D;
  /** Metres from the train's front to the middle of this car. */
  behind: number;
  /** The car's turn about the vertical before it follows the track: the model runs along z. */
  baseTurn: number;
}

/** One drawn train: a group carrying its cars, its mode marker and a STOPPED tag. */
interface DrawnTrain {
  group: THREE.Group;
  /** A box before the models load or if they fail, else the three cars of the kit's unit. */
  body: THREE.Object3D;
  cars: Car[];
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
  // The middle of the stage: the middle of the frame, in EXIT's lane, which runs down the
  // middle of the lanes the layout in use has.
  const centre = new THREE.Vector3(frame.width / 2, 0, laneOf('EXIT') * LANE_SPACING);
  // A layout wider or deeper than the default needs that much more ground and shadow.
  const growth = stageGrowth(frame);
  scene.add(new THREE.HemisphereLight(ENVIRONMENT.hemisphere.sky, ENVIRONMENT.hemisphere.ground, ENVIRONMENT.hemisphere.intensity));
  const sun = new THREE.DirectionalLight(ENVIRONMENT.sun.color, ENVIRONMENT.sun.intensity);
  sun.position.set(centre.x + 30, 60, centre.z + 35);
  sun.target.position.copy(centre);
  if (quality.shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    // Cover the whole stage, about 144 by 30 units in the default layout, centred on the frame.
    // A wider or deeper layout gets a shadow area that much bigger.
    Object.assign(sun.shadow.camera, {
      left: -80 * growth,
      right: 80 * growth,
      top: 40 * growth,
      bottom: -40 * growth,
      near: 1,
      far: 200,
    });
    sun.shadow.radius = 3;
    sun.shadow.bias = -0.0004;
  }
  scene.add(sun, sun.target);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(frame.width * 4, frame.width * 3 * growth),
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
  function modelBody(): { body: THREE.Object3D; materials: THREE.MeshStandardMaterial[]; cars: Car[] } {
    const parts = kit!;
    const { scale, centres } = consistLayout(parts.carSizes.map((s) => s.length), trainLength, CAR_GAP);
    const body = new THREE.Group();
    const materials: THREE.MeshStandardMaterial[] = [];
    const cars: Car[] = [];
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
      holder.scale.setScalar(scale);
      body.add(holder);
      // The model runs along +z; a quarter turn points it along +x, the direction of travel.
      cars.push({ holder, behind: (trainLength / 2 - centres[i]) / UNITS_PER_METRE, baseTurn: Math.PI / 2 });
    });
    return { body, materials, cars };
  }

  function makeTrain(id: number): DrawnTrain {
    const group = new THREE.Group();
    group.userData.trainId = id;
    const model = kit !== null;
    let body: THREE.Object3D;
    let bodyMaterials: THREE.MeshStandardMaterial[];
    let cars: Car[];
    if (model) {
      ({ body, materials: bodyMaterials, cars } = modelBody());
      body.position.y = world.railTop();
    } else {
      const material = new THREE.MeshStandardMaterial({ color: TRAIN_BODY });
      material.userData.base = TRAIN_BODY;
      const box = new THREE.Mesh(trainGeometry, material);
      box.scale.x = trainLength;
      box.position.y = TRAIN_HEIGHT / 2;
      body = new THREE.Group();
      body.add(box);
      body.position.y = world.railTop();
      bodyMaterials = [material];
      cars = [{ holder: box, behind: TRAIN_LENGTH / 2, baseTurn: 0 }];
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
    return { group, body, cars, bodyMaterials, marker, tag, model };
  }

  function disposeTrain(t: DrawnTrain): void {
    scene.remove(t.group);
    disposeAll([...t.bodyMaterials, t.marker.material as THREE.SpriteMaterial, t.tag.material as THREE.SpriteMaterial]);
  }

  // Drag to turn the camera, right-drag (or shift-drag) to slide it, scroll to zoom. The
  // camera button puts it back to the angled or overhead view.
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.screenSpacePanning = false; // slide over the ground, not up into the sky
  controls.maxPolarAngle = (84 * Math.PI) / 180; // never under the ground
  controls.minDistance = 6;
  controls.maxDistance = 400;
  // Until someone moves the camera, a resize refits the view to the new shape.
  let fitted = true;
  controls.addEventListener('start', () => {
    fitted = false;
  });

  function setFog(): void {
    // Haze the far edges, whatever the view: fog from just beyond what the camera looks at.
    const distance = camera.position.distanceTo(controls.target);
    fog.near = distance * ENVIRONMENT.fog.near;
    fog.far = distance * ENVIRONMENT.fog.far;
  }

  let cameraMode: CameraMode = DEFAULT_CAMERA;
  function setCamera(mode: CameraMode): void {
    cameraMode = mode;
    fitted = true;
    const { position, lookAt } = cameraPreset(mode, frame, camera.aspect);
    // Straight down has no "up", so lean a hair towards +z: the top of the picture is then -z.
    camera.position.set(position[0], position[1], position[2] + (mode === 'overhead' ? 0.01 : 0));
    camera.up.set(0, 1, 0);
    controls.target.set(...lookAt);
    controls.update();
    setFog();
  }

  function resize(): void {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // The camera backs off just enough to fit the frame at this shape of canvas, unless
    // someone has moved it.
    if (fitted) setCamera(cameraMode);
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

  // The platform each train was last seen in. A train on EXIT has left it behind, but its rear
  // cars still bend out of it through the points.
  const lastPlatform = new Map<number, PlatformId>();
  // The entry line each train was last seen on. A train sent over a cross link has its front in
  // the next line's platform while its rear cars are still on this line.
  const lastEntry = new Map<number, EntryId>();
  function observe(s: Snapshot): void {
    for (const t of s.trains) {
      if (isPlatform(t.pos.track)) lastPlatform.set(t.id, t.pos.track);
      else if (isEntryTrack(t.pos.track)) lastEntry.set(t.id, t.pos.track);
    }
  }

  /** Puts each car where the track is at its own x, turned to follow it. */
  function placeCars(t: DrawnTrain, frontX: number, route: Route): THREE.Vector3 {
    let middle = new THREE.Vector3();
    t.cars.forEach((car, i) => {
      const x = frontX - car.behind;
      const { z, slope } = pathAt(x, route);
      car.holder.position.set(toScreenX(x, frame), car.holder.position.y, z);
      car.holder.rotation.y = car.baseTurn - Math.atan2(slope, UNITS_PER_METRE);
      if (i === Math.floor(t.cars.length / 2)) middle = new THREE.Vector3(toScreenX(x, frame), 0, z);
    });
    return middle;
  }

  function render(s: Snapshot): void {
    observe(s);
    world.setDevices(s.switches);
    world.setJunctionBusy(junctionBusy(s));
    const views = new Map(s.trains.map((v) => [v.id, v]));

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
      const v = views.get(m.id)!;
      const middle = placeCars(t, v.x, routeOf(v.pos.track, lastPlatform.get(m.id) ?? null, lastEntry.get(m.id) ?? null));
      t.marker.position.set(middle.x, t.marker.position.y, middle.z);
      t.tag.position.set(middle.x, t.tag.position.y, middle.z);
    }
    for (const [id, t] of trains) {
      if (!seen.has(id)) {
        disposeTrain(t);
        trains.delete(id);
        lastPlatform.delete(id);
        lastEntry.delete(id);
      }
    }
    controls.update();
    setFog();
    renderer.render(scene, camera);
    placeLabels();
  }

  const raycaster = new THREE.Raycaster();
  /** The train under a point on the canvas, or null. */
  function trainAt(clientX: number, clientY: number): number | null {
    const rect = renderer.domElement.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -(((clientY - rect.top) / rect.height) * 2 - 1);
    raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
    const bodies = [...trains.values()].map((t) => t.body);
    const hit = raycaster.intersectObjects(bodies, true)[0];
    return hit ? trainIdOf(hit.object) : null;
  }

  // A drag moves the camera; only a press and release in about the same place is a click.
  let downAt: { x: number; y: number } | null = null;
  renderer.domElement.addEventListener('pointerdown', (e) => {
    downAt = { x: e.clientX, y: e.clientY };
  });
  const wasDrag = (e: MouseEvent) => downAt !== null && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5;

  function onPick(handler: (id: number | null) => void): void {
    renderer.domElement.addEventListener('click', (e) => {
      if (wasDrag(e)) return;
      handler(trainAt(e.clientX, e.clientY));
    });
  }

  function onDoublePick(handler: (id: number) => void): void {
    renderer.domElement.addEventListener('dblclick', (e) => {
      const id = trainAt(e.clientX, e.clientY);
      if (id !== null) handler(id);
    });
  }

  function trainScreenPoints(): Array<{ id: number; x: number; y: number }> {
    const rect = renderer.domElement.getBoundingClientRect();
    const points: Array<{ id: number; x: number; y: number }> = [];
    for (const [id, t] of trains) {
      const middle = t.cars[Math.floor(t.cars.length / 2)].holder;
      const p = middle.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 1, 0)).project(camera);
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
    controls.dispose();
    for (const t of trains.values()) disposeTrain(t);
    trains.clear();
    renderer.dispose();
    renderer.domElement.remove();
    labelLayer.remove();
  }

  setCamera(DEFAULT_CAMERA);
  resize();
  return { render, observe, setCamera, onPick, onDoublePick, trainScreenPoints, resize, dispose };
}
