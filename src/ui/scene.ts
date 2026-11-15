import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Snapshot, TrainView } from '../engine/engine';
import type { PlatformId } from '../shared/types';
import { SENSOR_RANGE, TRAIN_LENGTH } from '../shared/constants';
import { isPlatform } from '../shared/map';
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
  DEVICE_SITES,
  sensorSite,
  type DeviceKey,
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
import { LINK_STYLE, linkReach, type Link, type LinkEnd } from './links';
import { SIGHT_HALF_ANGLE, SIGHT_STYLE, sightCone } from './sight';

/** Where a camera is and what it looks at, in scene units. */
export interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
}

/** Which of the scene's own drawings are on, from the Show menu. */
export interface Drawn {
  sight: boolean;
  tint: boolean;
  zone: boolean;
}

export interface SceneView {
  /**
   * Draws one snapshot and a line for each link (see links.ts). `drawn.sight` adds each train's
   * sensor cone (see sight.ts), and `drawn.tint` colours each platform track by its sensor's
   * reading, and `drawn.zone` shows the junction zone's patch. The view only reads them.
   */
  render(s: Snapshot, links?: Link[], drawn?: Drawn): void;
  setCamera(mode: CameraMode): void;
  /** Calls back whenever the viewer moves this camera, with where it now is. */
  onCameraMove(handler: (pose: CameraPose) => void): void;
  /** Puts the camera where another view's camera is, without calling back. */
  setPose(pose: CameraPose): void;
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
/** Where a link line meets each device: its lamp, in scene units above the ground (world.ts). */
const DEVICE_TOP: Record<Exclude<DeviceKey, 'sensors'>, number> = { centre: 3.5, platformKeeper: 1.6, junctionKeeper: 1.6 };
/** Height of a platform sensor box's lamp, where its radio lines start (world.ts). */
const SENSOR_LAMP_Y = 1.2;
/** Height of a cable on the ground, just clear of it. */
const CABLE_Y = 0.06;
/** How fast the dot on a link line travels from sender to receiver, in trips per real second. */
const PULSE_RATE = 0.9;
/** How many straight pieces make up one link arc. */
const ARC_STEPS = 32;
/** How many straight pieces make up the rim of a sensor cone. */
const SIGHT_ARC_STEPS = 12;

/** One car of a drawn train, placed on its own so a train bends through the points. */
interface Car {
  holder: THREE.Object3D;
  /** Metres from the train's front to the middle of this car. */
  behind: number;
  /** The car's turn about the vertical before it follows the track: the model runs along z. */
  baseTurn: number;
}

/** A material in two shades: as it is, and dimmed for a stopped train. Every train shares both. */
interface Shades {
  lit: THREE.Material;
  dim: THREE.Material;
}

function shadesOf(material: THREE.Material): Shades {
  const dim = material.clone();
  if ('color' in dim && dim.color instanceof THREE.Color) dim.color.multiplyScalar(bodyDim(true));
  return { lit: material, dim };
}

/** One piece of a car, ready to copy: a single geometry for each material the car uses. */
interface CarPiece {
  geometry: THREE.BufferGeometry;
  shades: Shades;
}

/**
 * Bakes one kit car into as few meshes as it can: one per material, already moved so the car's
 * centre is at the origin and its wheels at y 0. A car of three meshes then costs one draw call
 * for each train, not three, on screen and again in the shadow pass.
 */
function bakeCar(car: THREE.Object3D, shadesFor: (m: THREE.Material) => Shades): CarPiece[] {
  car.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(car);
  const centre = box.getCenter(new THREE.Vector3());
  const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>();
  car.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    geometry.translate(-centre.x, -box.min.y, -centre.z);
    const list = byMaterial.get(mesh.material) ?? [];
    list.push(geometry);
    byMaterial.set(mesh.material, list);
  });
  const pieces: CarPiece[] = [];
  for (const [material, geometries] of byMaterial) {
    const merged = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries);
    // Meshes that cannot be merged stay as they are.
    for (const geometry of merged ? [merged] : geometries) pieces.push({ geometry, shades: shadesFor(material) });
    if (merged && geometries.length > 1) for (const g of geometries) g.dispose();
  }
  return pieces;
}

/** One drawn train: a group carrying its cars, its mode marker and a STOPPED tag. */
interface DrawnTrain {
  group: THREE.Group;
  /** A box before the models load or if they fail, else the three cars of the kit's unit. */
  body: THREE.Object3D;
  cars: Car[];
  /** The body's meshes, each with the shared material it shows when moving and when stopped. */
  bodyMeshes: Array<{ mesh: THREE.Mesh; shades: Shades }>;
  /** Whether the body is shown dimmed now, so a frame only swaps materials when this changes. */
  dimmed: boolean | null;
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
  // The lights, the ground and the scenery never move, so work out where each one sits once
  // instead of on every frame. Trains are added later and still move.
  scene.traverse((o) => {
    o.updateMatrix();
    o.matrixAutoUpdate = false;
  });

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
  const trainGeometry = new THREE.BoxGeometry(1, TRAIN_HEIGHT, TRAIN_DEPTH);
  const boxShades = shadesOf(new THREE.MeshStandardMaterial({ color: TRAIN_BODY }));
  const textureFor = markerTextures();
  const stoppedTag = stoppedTexture();
  const trains = new Map<number, DrawnTrain>();
  const trainLength = TRAIN_LENGTH * (frame.width / (frame.xMax - frame.xMin));

  // The models load once, in the background. Until then, or if any fails, trains are boxes.
  let kit: KitParts<THREE.Object3D> | null = null;
  /** Each kit car baked once (bakeCar), nose first. Every train copies these. */
  let carPieces: CarPiece[][] = [];
  const kitShades = new Map<THREE.Material, Shades>();
  const shadesFor = (m: THREE.Material): Shades => {
    let s = kitShades.get(m);
    if (!s) {
      s = shadesOf(m);
      kitShades.set(m, s);
    }
    return s;
  };
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
    carPieces = kit.cars.map((car) => bakeCar(car, shadesFor));
    world.useKitRails(kit.rail);
    // Rebuild every train from the models on the next render.
    for (const t of trains.values()) disposeTrain(t);
    trains.clear();
  });

  /** One unit from the kit, nose towards +x, its centre at the origin, wheels at y 0. */
  function modelBody(): { body: THREE.Object3D; meshes: DrawnTrain['bodyMeshes']; cars: Car[] } {
    const parts = kit!;
    const { scale, centres } = consistLayout(parts.carSizes.map((s) => s.length), trainLength, CAR_GAP);
    const body = new THREE.Group();
    const meshes: DrawnTrain['bodyMeshes'] = [];
    const cars: Car[] = [];
    carPieces.forEach((pieces, i) => {
      const holder = new THREE.Group();
      // Every train shares the baked geometry and the two shades of each material.
      for (const piece of pieces) {
        const mesh = new THREE.Mesh(piece.geometry, piece.shades.lit);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        holder.add(mesh);
        meshes.push({ mesh, shades: piece.shades });
      }
      holder.scale.setScalar(scale);
      body.add(holder);
      // The model runs along +z; a quarter turn points it along +x, the direction of travel.
      cars.push({ holder, behind: (trainLength / 2 - centres[i]) / UNITS_PER_METRE, baseTurn: Math.PI / 2 });
    });
    return { body, meshes, cars };
  }

  function makeTrain(id: number): DrawnTrain {
    const group = new THREE.Group();
    group.userData.trainId = id;
    const model = kit !== null;
    let body: THREE.Object3D;
    let bodyMeshes: DrawnTrain['bodyMeshes'];
    let cars: Car[];
    if (model) {
      ({ body, meshes: bodyMeshes, cars } = modelBody());
      body.position.y = world.railTop();
    } else {
      const box = new THREE.Mesh(trainGeometry, boxShades.lit);
      box.scale.x = trainLength;
      box.position.y = TRAIN_HEIGHT / 2;
      body = new THREE.Group();
      body.add(box);
      body.position.y = world.railTop();
      bodyMeshes = [{ mesh: box, shades: boxShades }];
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
    return { group, body, cars, bodyMeshes, dimmed: null, marker, tag, model };
  }

  /** Frees what one train owns. The body's geometry and materials are shared, so they stay. */
  function disposeTrain(t: DrawnTrain): void {
    scene.remove(t.group);
    disposeAll([t.marker.material as THREE.SpriteMaterial, t.tag.material as THREE.SpriteMaterial]);
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

  let moveHandler: ((pose: CameraPose) => void) | null = null;
  let applyingPose = false;
  controls.addEventListener('change', () => {
    if (applyingPose || !moveHandler) return;
    moveHandler({ position: camera.position.toArray(), target: controls.target.toArray() });
  });
  function setPose(pose: CameraPose): void {
    applyingPose = true;
    fitted = false;
    camera.position.set(...pose.position);
    controls.target.set(...pose.target);
    controls.update();
    applyingPose = false;
    setFog();
  }

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
    return { node, at: new THREE.Vector3(toScreenX(a.x, frame), a.kind === 'track' ? 0.2 : 0, a.z), shown: '' };
  });
  const labelPoint = new THREE.Vector3();
  function placeLabels(): void {
    const w = container.clientWidth;
    const h = container.clientHeight;
    for (const l of labels) {
      const p = labelPoint.copy(l.at).project(camera);
      const visible = Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 && p.z < 1;
      let where = 'none';
      if (visible) {
        const { left, top } = ndcToCss(p, w, h);
        // Whole pixels, so a camera at rest writes nothing and the page is not laid out again.
        where = `${Math.round(left)},${Math.round(top)}`;
      }
      if (where === l.shown) continue;
      l.shown = where;
      l.node.style.display = visible ? '' : 'none';
      if (!visible) continue;
      const [left, top] = where.split(',');
      l.node.style.left = `${left}px`;
      l.node.style.top = `${top}px`;
    }
  }

  // The link lines are drawn on a flat canvas over the 3D one, under the labels, so they can be
  // thick, curved and animated. A WebGL line is always one pixel wide.
  const linkCanvas = document.createElement('canvas');
  linkCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;';
  container.insertBefore(linkCanvas, labelLayer);
  const linkPen = linkCanvas.getContext('2d');

  /** A train's end of a line: where the line meets it, and how much of the line to show (linkReach). */
  interface Anchor {
    at: THREE.Vector3;
    reach: number;
  }

  /** Where a line meets one end, in scene units, or null for a train that is not drawn. */
  function linkPoint(end: LinkEnd, anchors: Map<number, Anchor>): Anchor | null {
    if ('train' in end) return anchors.get(end.train) ?? null;
    if ('sensor' in end) {
      const box = sensorSite(end.sensor);
      return { at: new THREE.Vector3(toScreenX(box.x, frame), SENSOR_LAMP_Y, box.z), reach: 1 };
    }
    const site = DEVICE_SITES[end.device];
    return { at: new THREE.Vector3(toScreenX(site.x, frame), DEVICE_TOP[end.device], site.z), reach: 1 };
  }

  /**
   * The arc as a run of canvas points. The arc is built in the scene, rising over the middle,
   * and each point is projected on its own. A point the camera cannot see (behind it, too
   * close or past the far plane) breaks the run, so a train sliding out of view never flings
   * the line across the sky.
   */
  function arcRuns(
    a: THREE.Vector3,
    b: THREE.Vector3,
    w: number,
    h: number,
    rise = Math.min(9, 1.5 + a.distanceTo(b) * 0.2),
  ): Array<Array<{ left: number; top: number }>> {
    const mid = a.clone().add(b).multiplyScalar(0.5);
    mid.y += rise;
    // The control point that makes the curve pass through the raised middle.
    const c = mid.multiplyScalar(2).sub(a.clone().add(b).multiplyScalar(0.5));
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= ARC_STEPS; i++) {
      const u = i / ARC_STEPS;
      points.push(
        new THREE.Vector3()
          .addScaledVector(a, (1 - u) * (1 - u))
          .addScaledVector(c, 2 * (1 - u) * u)
          .addScaledVector(b, u * u),
      );
    }
    return projectRuns(points, w, h);
  }

  /** Projects scene points to the canvas, breaking the run at any point the camera cannot see. */
  function projectRuns(points: THREE.Vector3[], w: number, h: number): Array<Array<{ left: number; top: number }>> {
    const runs: Array<Array<{ left: number; top: number }>> = [];
    let run: Array<{ left: number; top: number }> = [];
    for (const point of points) {
      const p = point.clone().project(camera);
      if (p.z < -1 || p.z > 1) {
        if (run.length > 1) runs.push(run);
        run = [];
        continue;
      }
      run.push(ndcToCss(p, w, h));
    }
    if (run.length > 1) runs.push(run);
    return runs;
  }

  /**
   * Each link is an arc from its sender up and over to its receiver, with a dot running along
   * it the way the message goes. A link fades as its message gets older. A note sits above its
   * train.
   */
  /** Clears the overlay canvas, sized to the container, and returns its pen and size in CSS pixels. */
  function clearOverlay(): { g: CanvasRenderingContext2D; w: number; h: number } | null {
    if (!linkPen) return null;
    const w = container.clientWidth;
    const h = container.clientHeight;
    const ratio = Math.min(window.devicePixelRatio, 2);
    const pw = Math.max(1, Math.round(w * ratio));
    const ph = Math.max(1, Math.round(h * ratio));
    if (linkCanvas.width !== pw || linkCanvas.height !== ph) {
      linkCanvas.width = pw;
      linkCanvas.height = ph;
    }
    linkPen.setTransform(ratio, 0, 0, ratio, 0, 0);
    linkPen.clearRect(0, 0, w, h);
    return { g: linkPen, w, h };
  }

  /**
   * A cone on the ground ahead of each train for its own front sensor: it opens from the
   * train's nose in the direction the track runs there, out to SENSOR_RANGE, and fades towards
   * its rim. Pale blue while the sensor sees nothing. Red when it sees a train or a busy
   * junction zone, with a bar across the track where that is.
   */
  function drawSight(views: TrainView[]): void {
    if (!linkPen) return;
    const g = linkPen;
    const w = container.clientWidth;
    const h = container.clientHeight;
    const y = world.railTop() + 0.15;
    const radius = SENSOR_RANGE * UNITS_PER_METRE;
    for (const v of views) {
      const reach = linkReach(v.x, frame);
      if (reach <= 0 || !trains.has(v.id)) continue;
      const cone = sightCone(v, lastPlatform.get(v.id) ?? null);
      const { z, slope } = pathAt(cone.frontX, cone.route);
      const apex = new THREE.Vector3(toScreenX(cone.frontX, frame), y, z);
      // The way the track runs at the nose, in scene units: x per metre is UNITS_PER_METRE.
      const heading = Math.atan2(slope, UNITS_PER_METRE);
      const fan: THREE.Vector3[] = [apex];
      for (let i = 0; i <= SIGHT_ARC_STEPS; i++) {
        const angle = heading - SIGHT_HALF_ANGLE + (2 * SIGHT_HALF_ANGLE * i) / SIGHT_ARC_STEPS;
        fan.push(new THREE.Vector3(apex.x + Math.cos(angle) * radius, y, apex.z + Math.sin(angle) * radius));
      }
      const projected = fan.map((p) => p.clone().project(camera));
      // Leave out a cone the camera cannot see all of, so it never stretches across the view.
      if (projected.some((p) => p.z < -1 || p.z > 1)) continue;
      const pts = projected.map((p) => ndcToCss(p, w, h));
      const tip = pts[0];
      const rim = pts[1 + Math.floor(SIGHT_ARC_STEPS / 2)];
      const css = cone.obstacleX === null ? SIGHT_STYLE.clear : SIGHT_STYLE.blocked;

      const fill = g.createRadialGradient(tip.left, tip.top, 0, tip.left, tip.top, Math.max(1, Math.hypot(rim.left - tip.left, rim.top - tip.top)));
      fill.addColorStop(0, `${css}66`);
      fill.addColorStop(1, `${css}08`);
      g.globalAlpha = reach;
      g.fillStyle = fill;
      g.beginPath();
      g.moveTo(tip.left, tip.top);
      for (const p of pts.slice(1)) g.lineTo(p.left, p.top);
      g.closePath();
      g.fill();
      // The rim, where the sensor's reach ends.
      g.strokeStyle = css;
      g.globalAlpha = reach * 0.45;
      g.lineWidth = 1.5;
      g.setLineDash([4, 4]);
      g.beginPath();
      g.moveTo(pts[1].left, pts[1].top);
      for (const p of pts.slice(2)) g.lineTo(p.left, p.top);
      g.stroke();
      g.setLineDash([]);

      // A bar across the track where the sensor found something.
      if (cone.obstacleX !== null) {
        const at = pathAt(cone.obstacleX, cone.route);
        const across = (1.4 * UNITS_PER_METRE) / Math.hypot(UNITS_PER_METRE, at.slope);
        const along = (1.4 * at.slope) / Math.hypot(UNITS_PER_METRE, at.slope);
        const mid = new THREE.Vector3(toScreenX(cone.obstacleX, frame), y, at.z);
        const ends = [mid.clone().add(new THREE.Vector3(along, 0, -across)), mid.clone().add(new THREE.Vector3(-along, 0, across))].map((p) =>
          p.project(camera),
        );
        if (ends.every((p) => p.z >= -1 && p.z <= 1)) {
          const [a, b] = ends.map((p) => ndcToCss(p, w, h));
          g.globalAlpha = reach;
          g.lineWidth = 4;
          g.lineCap = 'round';
          g.beginPath();
          g.moveTo(a.left, a.top);
          g.lineTo(b.left, b.top);
          g.stroke();
        }
      }
      g.globalAlpha = 1;
    }
  }

  function drawLinks(links: Link[], anchors: Map<number, Anchor>): void {
    if (!linkPen) return;
    const g = linkPen;
    const w = container.clientWidth;
    const h = container.clientHeight;
    const seconds = performance.now() / 1000;
    const notes: Array<{ text: string; left: number; top: number }> = [];

    links.forEach((link, i) => {
      const a = linkPoint(link.from, anchors);
      const b = linkPoint(link.to, anchors);
      if (!a || !b) return;
      const reach = Math.min(a.reach, b.reach);
      if (reach <= 0) return;
      const style = LINK_STYLE[link.kind];
      // A cable lies on the ground; a radio message arcs through the air.
      const runs = style.ground
        ? arcRuns(new THREE.Vector3(a.at.x, CABLE_Y, a.at.z), new THREE.Vector3(b.at.x, CABLE_Y, b.at.z), w, h, 0)
        : arcRuns(a.at, b.at, w, h);
      if (runs.length === 0) return;
      const alpha = (0.25 + 0.75 * link.strength) * reach;

      const curve = () => {
        g.beginPath();
        for (const run of runs) {
          g.moveTo(run[0].left, run[0].top);
          for (const q of run.slice(1)) g.lineTo(q.left, q.top);
        }
      };
      g.strokeStyle = style.css;
      g.lineCap = 'round';
      // A soft glow under the line, so it reads over the track and the trains.
      g.setLineDash([]);
      g.globalAlpha = alpha * 0.22;
      g.lineWidth = 8;
      curve();
      g.stroke();
      g.globalAlpha = alpha;
      g.lineWidth = 2.5;
      if (style.dashed) {
        g.setLineDash([7, 6]);
        g.lineDashOffset = -seconds * 30;
      }
      curve();
      g.stroke();
      g.setLineDash([]);

      // The dot, starting from the sender. Each line has its own phase so they do not pulse together.
      const points = runs.flat();
      const along = ((seconds * PULSE_RATE + i * 0.37) % 1) * (points.length - 1);
      const p0 = points[Math.floor(along)];
      const p1 = points[Math.min(points.length - 1, Math.floor(along) + 1)];
      const f = along - Math.floor(along);
      // A cable that is switched off carries nothing, so it has no dot.
      if (link.strength > 0) {
        g.fillStyle = style.css;
        g.beginPath();
        g.arc(p0.left + (p1.left - p0.left) * f, p0.top + (p1.top - p0.top) * f, style.ground ? 2.5 : 3.5, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
      // A cable just ends at the keeper's hut, with no ring.
      if (style.ground) return;

      // A ring where the message lands, if the camera can see that end.
      const end = b.at.clone().project(camera);
      if (end.z < -1 || end.z > 1) return;
      const e = ndcToCss(end, w, h);
      g.globalAlpha = alpha;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(e.left, e.top, 4.5, 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = 1;
      if (link.note && 'train' in link.to) notes.push({ text: link.note, left: e.left, top: e.top - 44 });
    });

    g.font = '600 12px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const n of notes) {
      const width = g.measureText(n.text).width + 14;
      g.fillStyle = 'rgba(11,15,20,0.85)';
      g.beginPath();
      g.roundRect(n.left - width / 2, n.top - 11, width, 22, 8);
      g.fill();
      g.fillStyle = '#ffd2a0';
      g.fillText(n.text, n.left, n.top);
    }
  }

  // The platform each train was last seen in. A train on EXIT has left it behind, but its rear
  // cars still bend out of it through the points.
  const lastPlatform = new Map<number, PlatformId>();
  function observe(s: Snapshot): void {
    for (const t of s.trains) if (isPlatform(t.pos.track)) lastPlatform.set(t.id, t.pos.track);
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

  function render(s: Snapshot, links: Link[] = [], drawn: Drawn = { sight: false, tint: false, zone: false }): void {
    const sight = drawn.sight;
    observe(s);
    world.setDevices(s.switches);
    world.setJunctionZone(junctionBusy(s), drawn.zone);
    world.setSensors(s.sensors.platformOccupied, s.switches.sensors, drawn.tint);
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
      if (t.dimmed !== stopped) {
        t.dimmed = stopped;
        for (const { mesh, shades } of t.bodyMeshes) mesh.material = stopped ? shades.dim : shades.lit;
      }
      const markerMaterial = t.marker.material as THREE.SpriteMaterial;
      markerMaterial.map = textureFor(spec);
      markerMaterial.opacity = spec.opacity;
      t.tag.visible = spec.stopped;
      const v = views.get(m.id)!;
      const middle = placeCars(t, v.x, routeOf(v.pos.track, lastPlatform.get(m.id) ?? null));
      t.marker.position.set(middle.x, t.marker.position.y, middle.z);
      t.tag.position.set(middle.x, t.tag.position.y, middle.z);
    }
    for (const [id, t] of trains) {
      if (!seen.has(id)) {
        disposeTrain(t);
        trains.delete(id);
        lastPlatform.delete(id);
      }
    }
    controls.update();
    setFog();
    renderer.render(scene, camera);
    const anchors = new Map<number, Anchor>();
    for (const v of s.trains) {
      const t = trains.get(v.id);
      if (t) anchors.set(v.id, { at: t.marker.position, reach: linkReach(v.x, frame) });
    }
    clearOverlay();
    if (sight) drawSight(s.trains);
    drawLinks(links, anchors);
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
    disposeAll([trainGeometry, boxShades.lit, boxShades.dim, ...[...kitShades.values()].map((s) => s.dim)]);
    for (const pieces of carPieces) disposeAll(pieces.map((p) => p.geometry));
    renderer.dispose();
    renderer.domElement.remove();
    linkCanvas.remove();
    labelLayer.remove();
  }

  setCamera(DEFAULT_CAMERA);
  resize();
  return { render, observe, setCamera, onCameraMove: (h) => (moveHandler = h), setPose, onPick, onDoublePick, trainScreenPoints, resize, dispose };
}
