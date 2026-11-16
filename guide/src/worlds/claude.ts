import { Application, Assets, Container, DisplacementFilter, Filter, GlProgram, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import type { WebGLRenderer } from 'pixi.js';
import type { World, WorldOpts } from '../stage';
import hires from '../../scripts/art-hires.json';

type SceneName = 'haiku' | 'sonnet' | 'opus' | 'fable' | 'mythos';
type Point = { x: number; y: number };
type Camera = Point & { zoom: number; aim: number; across: number };
type Scene = { root: Container; draw(t: number, level: number): void };
type Region = Point & { zoom: number; plate?: string; scale: number; focus: Point };
// Asset sources are shared by Pixi's cache; wait for the previous world's unloads.
let assetCleanup: Promise<unknown> = Promise.resolve();
const PAPER = 0xefe5cf;
const TAU = Math.PI * 2;
const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const ease = (v: number) => { const p = clamp(v); return p * p * p * (p * (p * 6 - 15) + 10); };
const mix = (a: number, b: number, p: number) => a + (b - a) * p;
const series = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
const names: SceneName[] = ['haiku', 'sonnet', 'opus', 'fable', 'mythos'];
// Review knobs: seconds, source-art pixels, or viewport fractions as indicated.
// Mobile halves decorative populations and shader strength, not effort meaning.
const JOURNEY = {
  wideZoom: 1.65, zoomExcursion: 0.48, plateOverscan: 1.12,
  dissolveNoise: 0.24, dissolveCells: 7, loadFadeSeconds: 0.8,
  duskStart: 0.30, duskPower: 3, earlyDusk: 0.06, nightDarkness: 0.86, nightPullback: 0.35,
};
const ATMOSPHERE = {
  strength: 0.65, haze: 0.035, hazeCells: 3, drift: 0.018,
  hazeParallax: 0.055, shaftParallax: 0.025, shafts: 0.028,
  vignette: 0.085, grain: 0.022, warmth: 0.035,
  swallowCarryEnd: 0.82, butterflyArrival: 2.35,
  stars: 64, fireflies: 16, swallows: 6, seamButterflies: 4,
};
const FROG_MOTION = {
  idleSeconds: 6.5, idleVariation: 5, scheduleLength: 8, stagger: 3.17,
  crouchSeconds: 0.38, flightSeconds: 0.78, flightVariation: 0.16,
  settleSeconds: 0.85, poseBlendSeconds: 0.10,
  jumpHeight: 0.14, widthOnPad: 0.60, crouchSquash: 0.20,
  flightStretch: 0.15, landingSquash: 0.22, rotation: 0.42,
  breath: 0.018, bob: 0.02, shuffle: 0.025,
  padRock: 0.11, rippleSeconds: 1.6, croakSeconds: 0.80,
  phoneDipPixels: 3, desktopDipPixels: 7, ripplePixels: 1.4,
};
const BUTTERFLY_MOTION = {
  companionWidth: 0.085, companionArtWidth: 84, depthSize: 0.65,
  drinkSeconds: 1.2, fanSeconds: 2.2, baskSeconds: 0.4,
  closeSeconds: 0.3, restSeconds: 0.4, takeoffSeconds: 0.45,
  flightSeconds: 3.4, landSeconds: 0.65, flutterHeight: 0.19,
  bob: 0.012, beatRate: 16, glideSeconds: 1.4, beatSquash: 0.18,
  bodyLine: 0.72, feetLine: 0.96, perchBlend: 0.32,
  chaseRadius: 0.035, chaseSeconds: 8, companions: 14,
};
const WRITING = {
  strokeSeconds: 0.82, strokeVariation: 0.54,
  pauseSeconds: 0.32, pauseVariation: 0.65, thinkSeconds: 1.3,
  dipSeconds: 1.55, dipEvery: 7, finishFadeSeconds: 4.5,
  slowScroll: 0.075, settleSeconds: 0.45, cueGapSeconds: 1.1,
  maxFrameGap: 0.30, sleeveSway: 0.7, liftPixels: 3,
  pageGlow: 0.025, pageDrift: 5, arrivalStrokePart: 0.10, continuationRate: 0.18,
};
// Clear-area dimensions are CSS pixels; motion distances below are screen fractions.
const COMPOSITION = { subjectWidth: 0.80, subjectHeight: 0.75, pondHeight: 0.66,
  mobileTop: 60, mobileBottom: 250, mobileRight: 60, desktopTop: 80, desktopBottom: 0, desktopRight: 80 };
const HANDOFF = { windowCover: 2, windowSkyEnd: 0.94, windowSkyFade: 0.18, feather: 8,
  pagePush: 3.2, bloomSoftness: 0.10, bloomNoise: 0.045, bloomVertices: 64 };
const POSE = { minimumScale: 0.025, edgeWindow: 0.18 };
const SWALLOW_MOTION = { bob: 0.045, drift: 0.12, wingEdge: 0.045, squash: 0.06 };
// A pose changes only at its narrowest silhouette; alpha belongs to populations, never poses.
const edgeFlip = (progress: number) => mix(POSE.minimumScale, 1, ease(Math.abs(progress - 0.5) / POSE.edgeWindow));
function choosePose(poses: Sprite[], weights: number[]) {
  let selected = 0;
  for (let i = 1; i < weights.length; i++) if (weights[i] > weights[selected]) selected = i;
  const runnerUp = Math.max(0, ...weights.filter((_, i) => i !== selected));
  poses.forEach((pose, i) => { pose.visible = i === selected; pose.alpha = 1; });
  return mix(POSE.minimumScale, 1, ease((weights[selected] - runnerUp) / POSE.edgeWindow));
}
const DEPTH = { cloud: 0.018, swallow: 0.035, pad: 0.008, grass: 0.018, firefly: 0.022 };
const PARTICLES = { skySwallows: 40, landscapeSwallows: 6, landscapeRipples: 6, landscapeButterflies: 4,
  waterRipples: 4, waterShimmers: 8, wingHighlights: 8, clouds: 4 };
const PERCH_POINTS = [{ x: 947, y: 450 }, { x: 1080, y: 420 }, { x: 1160, y: 465 }];
const HERO_PERCH_POINTS = PERCH_POINTS.slice(1); // Two nearby flower heads keep the whole flight inside the clear area.
const MEADOW_FOCUS = { x: 1120, y: 442.5 };
const perchFiles = ['a', 'b', 'c', 'd', 'e'].flatMap(id => series(`meadow/perch_${id}_`, 3));
const leapFiles = series('valley/frog_leap_', 3);
const isScene = (id: string): id is SceneName => names.includes(id as SceneName);
const sample = (values: number[], level: number) => {
  const u = clamp(level - 1, 0, values.length - 1);
  return mix(values[Math.floor(u)], values[Math.ceil(u)], ease(u % 1));
};
// Coordinates measured in the actual 1672 × 941 establishing plate. Close-ups
// share these landmarks, rather than becoming independent screen-sized scenes.
const regions: Record<SceneName, Region> = {
  haiku: { x: 500, y: 235, zoom: 2.8, scale: 1, focus: { x: 0, y: 0 } },
  sonnet: { x: 1123, y: 326, zoom: 25, plate: 'valley/plate_tower', scale: 0.17, focus: { x: 505, y: 940 } },
  opus: { x: 470, y: 805, zoom: 4, plate: 'valley/plate_pond', scale: 0.44, focus: { x: 850, y: 550 } },
  fable: { x: 1320, y: 730, zoom: 3.2, plate: 'valley/plate_meadow', scale: 0.44, focus: { x: 1020, y: 310 } },
  mythos: { x: 1320, y: 730, zoom: 3.2, scale: 0.44, focus: { x: 1020, y: 310 } },
};
const files: Record<SceneName, string[]> = {
  haiku: ['valley/plate_wide', ...series('sky/cloud_', 3), 'sky/swallow_body', 'sky/swallow_wing_near', 'sky/swallow_wing_far'],
  sonnet: ['valley/plate_tower', 'valley/plate_tower_still', 'valley/wizard_arm', 'valley/wizard_quill', 'room/desk', 'room/candle', 'room/inkwell', ...series('room/quill_', 5), 'room/wax_seal'],
  opus: ['valley/plate_pond', ...series('valley/lily_pad_side_', 3), 'valley/frog_croak', 'valley/frog_front', 'valley/frog_back',
    ...leapFiles, ...series('pond/pebble_', 8), 'pond/lily_bud', 'pond/lily_open', 'pond/frog_sit', 'pond/frog_hop', 'pond/reeds', 'pond/dragonfly'],
  fable: ['valley/plate_meadow', ...series('meadow/butterfly_', 5), ...series('meadow/small_', 4), ...series('meadow/flyer_', 3),
    ...series('meadow/flyer_down_', 3), ...perchFiles, 'meadow/grass'],
  mythos: ['valley/chrysalis', 'meadow/butterfly_5'],
};

const optionalArt = new Set(['valley/plate_tower_still', 'valley/wizard_arm', 'valley/wizard_quill',
  'valley/frog_front', 'valley/frog_back', ...series('meadow/flyer_', 3),
  ...leapFiles, ...series('meadow/flyer_down_', 3), ...perchFiles]);

export function create(): World {
  let app: Application;
  let opts: WorldOpts;
  let observer: ResizeObserver | undefined;
  let dead = false;
  let initialized = false;
  let width = 1, height = 1, base = 1;
  let landscapeMix = 0;
  const clear = { top: 60, bottom: 250, right: 60, width: 1, height: 1, x: 0.5, y: 0.5 };
  let clearObserver: MutationObserver | undefined;
  let stageElement: HTMLElement;
  const focusX = () => clear.x / width;
  const focusY = () => clear.y / height;
  let fallbackTexture: Texture;
  let wide: Sprite;
  let skyBackdrop: { sprite: Sprite; root: Container };
  let ambient: Scene | undefined;
  let travellers: Scene | undefined;
  let landscapeCompanions: (() => void) | undefined;
  let dusk = 0;
  let lastT = 0;
  let journeyValue = 0, previousValue = 0, previousLevel = 0, previousFrameT = 0, slowSince = 0;
  let readerSlow = false, lastScratchAt = -Infinity;
  let currentCamera: Camera;
  let towerRig = false;
  let audibleScene: SceneName | undefined;
  const soundQueue: string[] = [];
  const cueState = new Map<string, { token: number; t: number }>();
  const effects: Filter[] = [];
  const sceneLayers = new Map<SceneName, Container>();
  const bloomFilters = new Map<SceneName, Filter>();
  const fallbackWeights = new Map<SceneName, number>();
  let bloomProgram: GlProgram | undefined, sharedGrade: Filter | undefined;
  let aurora: { sprite: Sprite; filter: Filter } | undefined;
  // Compare adjacent visible frames only: entering a scene or resuming motion
  // must not replay all the cues missed while away or paused.
  function cue(key: string, token: number, sound: string, scene: SceneName, t: number, began = false) {
    const previous = cueState.get(key);
    if (t > 0 && audibleScene === scene && token >= 0 && soundQueue.length < 8
      && (sound !== 'scratch' || readerSlow && t - lastScratchAt >= WRITING.cueGapSeconds)
      && (began || previous && t > previous.t && t - previous.t < WRITING.maxFrameGap && token !== previous.token)) {
      soundQueue.push(sound);
      if (sound === 'scratch') lastScratchAt = t;
    }
    cueState.set(key, { token, t });
  }
  // Keep one reading composition through arrival, efforts, and departure.
  // Effort changes the quill and ink, rather than changing the camera anchor.
  let deskPush = 0;
  const readyAt = new Map<SceneName, number>();
  const stage = new Container();
  const tint = new Graphics();
  const moonlight = new Graphics();
  const stars = new Graphics();
  const fireflies = new Graphics();
  const nightWindow = new Graphics();
  const towerLife = new Graphics();
  const inkOpening = new Graphics();
  let windowOpening: Sprite;
  let openingCanvas: HTMLCanvasElement, openingTexture: Texture;
  let inkBloomLayer: Container | undefined;
  towerLife.zIndex = 2.5;
  towerLife.blendMode = 'add';
  const scenes = new Map<SceneName, Scene>();
  const plates = new Map<SceneName, Sprite>();
  const backdrops = new Map<string, { sprite: Sprite; root: Container }>();
  const pending = new Map<SceneName, Promise<void>>();
  const textures = new Map<string, Texture>();
  const loaded = new Set<string>();
  const slices: Texture[] = [];
  const generated: Texture[] = [];
  const remembered = new Map<SceneName, number>();
  const coverageErrors = new Set<string>();
  let towerMask: { sprite: Sprite; texture: Texture; canvas: HTMLCanvasElement; amount: number } | undefined;
  const url = (key: string, scale = 1) => `/assets/claude/${key}${scale > 1 ? `.${scale}x` : ''}.webp`;
  let sharpArt = false;
  const tex = (key: string) => textures.get(key) ?? fallbackTexture;

  // Ink grows radially from the page in viewport space. Noise is stationary,
  // so reverse scrubbing retraces the same edge without random pops.
  const filterVertex = `#version 300 es
    precision highp float;
    in vec2 aPosition; out vec2 vTextureCoord; out vec2 vUv;
    uniform vec4 uInputSize; uniform vec4 uOutputFrame; uniform vec4 uOutputTexture;
    void main() {
      vec2 p = aPosition * uOutputFrame.zw + uOutputFrame.xy;
      p.x = p.x * (2.0 / uOutputTexture.x) - 1.0;
      p.y = p.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
      gl_Position = vec4(p, 0.0, 1.0);
      vTextureCoord = aPosition * uOutputFrame.zw * uInputSize.zw;
      vUv = aPosition;
    }`;
  const noiseGLSL = `
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
      return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),
        mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
    }`;
  function linkedProgram(name: string, fragment: string) {
    const program = GlProgram.from({ name, vertex: filterVertex, fragment });
    const renderer = app.renderer as WebGLRenderer;
    const compiled = renderer.shader._getProgramData(program);
    if (!renderer.gl.getProgramParameter(compiled.program, renderer.gl.LINK_STATUS)) throw new Error(`${name} did not link`);
    return program;
  }
  function preparePaperLight() {
    try {
      bloomProgram = linkedProgram('claude-ink-journey', `#version 300 es
        precision highp float;
        in vec2 vTextureCoord; in vec2 vUv; out vec4 finalColor;
        uniform sampler2D uTexture;
        uniform float uProgress; uniform float uIncoming; uniform vec2 uOrigin; uniform float uAspect;
        uniform float uSoftness; uniform float uNoise; uniform float uCells;
        ${noiseGLSL}
        void main() {
          float grain = noise(vUv*uCells)*0.7 + noise(vUv*uCells*2.13+7.0)*0.3;
          vec2 metric = vec2(uAspect, 1.0);
          float reach = length(max(uOrigin, 1.0-uOrigin)*metric);
          float field = clamp(length((vUv-uOrigin)*metric)/max(reach,0.001) + (grain-0.5)*uNoise,0.01,0.99);
          float edge = mix(-uSoftness,1.0+uSoftness,uProgress);
          float reveal = 1.0-smoothstep(edge-uSoftness,edge+uSoftness,field);
          finalColor = texture(uTexture,vTextureCoord)*mix(1.0-reveal,reveal,uIncoming);
        }`);
    } catch (error) {
      bloomProgram = undefined;
      console.warn('[Claude] Ink bloom unavailable; using overlapping alpha fades', error);
    }
    if (opts.mobile) return; // Skip the full-resolution, multi-noise grade on phones.
    try {
      const program = linkedProgram('claude-shared-paper-light', `#version 300 es
        precision highp float;
        in vec2 vTextureCoord; in vec2 vUv; out vec4 finalColor;
        uniform sampler2D uTexture;
        uniform float uTime; uniform float uDusk; uniform float uStrength;
        uniform vec2 uCamera; uniform vec2 uViewport;
        uniform float uHaze; uniform float uCells; uniform float uDrift;
        uniform float uHazeParallax; uniform float uShaftParallax;
        uniform float uShafts; uniform float uVignette; uniform float uGrain; uniform float uWarmth;
        ${noiseGLSL}
        void main() {
          vec4 plate = texture(uTexture,vTextureCoord);
          vec3 color = plate.rgb/max(plate.a,0.0001);
          vec2 hazeUV = vUv*vec2(uViewport.x/uViewport.y,1.0)*uCells
            + uCamera*uHazeParallax + vec2(uTime*uDrift,-uTime*uDrift*0.3);
          float haze = noise(hazeUV)*0.7 + noise(hazeUV*2.03+9.0)*0.3;
          float band = exp(-pow((vUv.y-0.53)*3.0,2.0));
          vec3 mist = mix(vec3(0.94,0.89,0.77),vec3(0.41,0.48,0.55),uDusk);
          color = mix(color,mist,haze*band*uHaze*uStrength);
          float shaftX = vUv.x+vUv.y*0.32+uCamera.x*uShaftParallax;
          float shafts = pow(0.5+0.5*sin(shaftX*15.0+noise(hazeUV)*0.6),8.0);
          color += vec3(1.0,0.83,0.52)*shafts*(1.0-vUv.y)*uShafts*(1.0-uDusk)*uStrength;
          color *= mix(vec3(1.0+uWarmth*uStrength,1.0,1.0-uWarmth*uStrength),vec3(0.94,0.97,1.02),uDusk*uStrength);
          float vignette = smoothstep(0.18,0.74,length((vUv-0.5)*vec2(0.85,1.0)));
          color *= 1.0-vignette*uVignette*uStrength;
          float paper = hash(floor(vUv*uViewport))-0.5;
          color += paper*uGrain*uStrength;
          finalColor = vec4(clamp(color,0.0,1.0)*plate.a,plate.a);
        }`);
      // A filter draws the scene into its own texture; at resolution 1 retina screens showed everything at half sharpness.
      sharedGrade = new Filter({ glProgram: program, resolution: app.renderer.resolution, resources: { paperUniforms: {
        uTime: { value: 0, type: 'f32' }, uDusk: { value: 0, type: 'f32' },
        uStrength: { value: ATMOSPHERE.strength * (opts.mobile ? 0.5 : 1), type: 'f32' },
        uCamera: { value: new Float32Array(2), type: 'vec2<f32>' },
        uViewport: { value: new Float32Array([width, height]), type: 'vec2<f32>' },
        ...Object.fromEntries(Object.entries({ uHaze: ATMOSPHERE.haze, uCells: ATMOSPHERE.hazeCells,
          uDrift: ATMOSPHERE.drift, uHazeParallax: ATMOSPHERE.hazeParallax, uShaftParallax: ATMOSPHERE.shaftParallax,
          uShafts: ATMOSPHERE.shafts, uVignette: ATMOSPHERE.vignette, uGrain: ATMOSPHERE.grain, uWarmth: ATMOSPHERE.warmth })
          .map(([key, value]) => [key, { value, type: 'f32' }])),
      } } });
      effects.push(sharedGrade); app.stage.filters = [sharedGrade];
    } catch (error) { console.warn('[Claude] Shared paper light unavailable; retaining the painted grade', error); }
  }
  function addSceneLayer(name: SceneName) {
    const layer = new Container(); layer.sortableChildren = true;
    layer.zIndex = names.indexOf(name) + 2; layer.visible = false;
    layer.filterArea = new Rectangle(0, 0, width, height);
    stage.addChild(layer); sceneLayers.set(name, layer);
    if (bloomProgram && !opts.mobile) {
      try {
        const filter = new Filter({ glProgram: bloomProgram, resolution: opts.mobile ? 0.5 : app.renderer.resolution, resources: { bloomUniforms: {
          uProgress: { value: 0, type: 'f32' }, uIncoming: { value: 1, type: 'f32' },
          uOrigin: { value: new Float32Array([0.5, 0.5]), type: 'vec2<f32>' },
          uAspect: { value: width / height, type: 'f32' },
          uSoftness: { value: HANDOFF.bloomSoftness, type: 'f32' },
          uNoise: { value: JOURNEY.dissolveNoise * (opts.mobile ? 0.5 : 1), type: 'f32' },
          uCells: { value: JOURNEY.dissolveCells, type: 'f32' },
        } } });
        bloomFilters.set(name, filter); effects.push(filter);
      } catch (error) {
        bloomProgram = undefined; bloomFilters.clear();
        for (const existing of sceneLayers.values()) existing.filters = [];
        console.warn('[Claude] Ink bloom setup failed; using alpha fades', error);
      }
    }
    return layer;
  }

  function sprite(parent: Container, key: string, x: number, y: number, w: number): Sprite {
    const s = new Sprite(tex(key));
    s.anchor.set(0.5);
    s.position.set(x, y);
    s.scale.set(w / Math.max(1, s.texture.width));
    parent.addChild(s);
    return s;
  }
  function localRoot(name: SceneName): Container {
    const r = regions[name];
    const root = new Container();
    root.position.set(r.x, r.y);
    root.scale.set(r.scale);
    return root;
  }
  // Responsive staging in close-up coordinates; every subject stays in the
  // clear upper part of a portrait stage, independently of the plate's crop.
  function view(root: Container) {
    const factor = stage.scale.x * root.scale.x;
    return {
      left: (-stage.x / stage.scale.x - root.x) / root.scale.x,
      right: ((width - stage.x) / stage.scale.x - root.x) / root.scale.x,
      top: (-stage.y / stage.scale.y - root.y) / root.scale.y,
      bottom: ((height - stage.y) / stage.scale.y - root.y) / root.scale.y,
      factor,
    };
  }
  function fitPlate(name: SceneName, plate: Sprite) {
    const r = regions[name];
    const tw = plate.texture.width, th = plate.texture.height;
    const focus = name === 'sonnet' && towerRig ? TOWER_COMPOSITION_FOCUS
      : name === 'opus' ? { x: 850, y: 590 }
      : name === 'fable' ? MEADOW_FOCUS : r.focus;
    const x = clear.x, y = clear.y;
    const cover = Math.max(width / tw, height / th, x / focus.x, (width - x) / (tw - focus.x),
      y / focus.y, (height - y) / (th - focus.y));
    const subjectPixels = name === 'sonnet' ? Math.min(clear.width * COMPOSITION.subjectWidth / 330,
      clear.height * COMPOSITION.subjectHeight / 500) : 0;
    const pixels = Math.max(cover, subjectPixels) * JOURNEY.plateOverscan;
    const left = x - focus.x * pixels, top = y - focus.y * pixels;
    const scale = pixels / stage.scale.x;
    plate.scale.set(scale);
    plate.position.set((left + tw * pixels / 2 - stage.x) / stage.scale.x,
      (top + th * pixels / 2 - stage.y) / stage.scale.y);
    const scene = scenes.get(name);
    if (scene) {
      scene.root.position.set(plate.x + (r.focus.x - tw / 2) * scale,
        plate.y + (r.focus.y - th / 2) * scale);
      scene.root.scale.set(scale);
    }
    if (name === 'sonnet' && towerMask) {
      if (towerMask.amount !== landscapeMix) {
        const context = towerMask.canvas.getContext('2d')!;
        const image = context.createImageData(256, 1);
        for (let i = 0; i < 256; i++) {
          const edge = ease(i / 255 / 0.16) * ease((1 - i / 255) / 0.16);
          image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = 255;
          // Always reach zero at the physical edge. Even an intermediate
          // aspect ratio must never expose a partly opaque rectangular cut.
          image.data[i * 4 + 3] = Math.round(255 * edge);
        }
        context.putImageData(image, 0, 0); towerMask.texture.source.update();
        towerMask.amount = landscapeMix;
      }
      towerMask.sprite.position.copyFrom(plate.position);
      towerMask.sprite.scale.set(tw * scale / 256, th * scale);
    }
  }
  function placeSubject(root: Container) {
    root.position.set((width * focusX() - stage.x) / stage.scale.x, (height * focusY() - stage.y) / stage.scale.y);
  }
  function fitBackdrop(plate: Sprite, root: Container) {
    const bounds = view(root);
    // Use the actual parent transform, not the nominal camera/region scale.
    plate.scale.set(Math.max(width / plate.texture.width, height / plate.texture.height) * 1.004 / bounds.factor);
    plate.position.set((bounds.left + bounds.right) / 2, (bounds.top + bounds.bottom) / 2);
  }
  function assertPlateCoverage() {
    if (!import.meta.env.DEV) return;
    const candidates: [string, Sprite][] = [...plates].map(([name, plate]) =>
      [name, name === 'sonnet' ? wide : plate]);
    for (const [name, backdrop] of backdrops) {
      if (backdrop.root.visible && backdrop.root.alpha >= 1 - 1e-6) candidates.push([name, backdrop.sprite]);
    }
    for (const [name, plate] of candidates) {
      if (!plate.visible || plate.alpha < 1 - 1e-6) continue;
      // Ask Pixi for final global bounds, including the camera parent.
      const bounds = plate.getBounds();
      if (bounds.minX <= 0.01 && bounds.minY <= 0.01 && bounds.maxX >= width - 0.01 && bounds.maxY >= height - 0.01) continue;
      const key = `${name}:${width}x${height}`;
      if (coverageErrors.has(key)) continue;
      coverageErrors.add(key);
      console.error('[Claude] Opaque close-up does not cover the full stage', { name, width, height, bounds });
    }
  }
  function animateTower(t: number, deskAlpha: number) {
    towerLife.clear();
    const plate = plates.get('sonnet');
    if (!plate?.visible) return;
    const point = (x: number, y: number) => ({
      x: plate.x + (x - plate.texture.width / 2) * plate.scale.x,
      y: plate.y + (y - plate.texture.height / 2) * plate.scale.y,
    });
    const candle = point(390, 1040);
    const window = point(505, 1065);
    const tip = point(454 + Math.sin(t * 2.2) * 4, 1146 + Math.sin(t * 4.4) * 1.5);
    const scale = plate.scale.x;
    const flicker = 0.93 + Math.sin(t * 9) * 0.035 + Math.sin(t * 13.7) * 0.025;
    towerLife.alpha = plate.alpha * (towerRig ? 1 : 1 - deskAlpha);
    for (let i = 6; i > 0; i--) {
      towerLife.ellipse(candle.x, candle.y, i * 9 * scale, i * 13 * scale)
        .fill({ color: 0xffc566, alpha: 0.022 * flicker });
    }
    towerLife.ellipse(window.x, window.y, 120 * scale, 175 * scale)
      .fill({ color: 0xffcf83, alpha: 0.025 + Math.sin(t * 1.1) * 0.004 });
    towerLife.ellipse(candle.x, candle.y, 3.3 * scale, 9 * scale * flicker)
      .fill({ color: 0xffe3a0, alpha: 0.65 * flicker });
    const page = point(TOWER_PAGE_RECT.x + TOWER_PAGE_RECT.width / 2 + Math.sin(t * 0.33) * WRITING.pageDrift,
      TOWER_PAGE_RECT.y + TOWER_PAGE_RECT.height / 2);
    for (let i = 4; i > 0; i--) towerLife.ellipse(page.x, page.y, i * 15 * scale, i * 6 * scale)
      .fill({ color: 0xffd994, alpha: WRITING.pageGlow * flicker / 4 });
    if (!towerRig) towerLife.circle(tip.x, tip.y, 2.2 * scale).fill({ color: 0xffefbe, alpha: 0.78 });
  }
  function swallow(parent: Container, size: number, phase: number) {
    const rig = new Container();
    parent.addChild(rig);
    const far = sprite(rig, 'sky/swallow_wing_far', 15, -8, 38);
    far.anchor.set(0.5, 1);
    const body = sprite(rig, 'sky/swallow_body', 0, 0, 150);
    const near = sprite(rig, 'sky/swallow_wing_near', 10, -9, 43);
    near.anchor.set(0.5, 1);
    // The wing art has its leading edge on the left, but the body faces right: mirror both wings.
    near.scale.x *= -1; far.scale.x *= -1;
    rig.scale.set(size / 150);
    const rate = 5.8 + ((phase * 13.37) % 1) * 4.2;
    const glidePeriod = 6 + ((phase * 3.71) % 1) * 4;
    const glideLength = 1 + ((phase * 7.13) % 1);
    const nearScale = near.scale.y;
    const farScale = far.scale.y;
    return { rig, animate(t: number) {
      const flap = (offset: number) => {
        if (t === 0) return 1;
        const cycle = (t + phase * 2.3) % glidePeriod;
        const glide = ease(cycle / 0.18) * (1 - ease((cycle - 0.18 - glideLength) / 0.2));
        const wave = Math.cos(t * rate + phase * 2.1 + offset);
        // Cross the edge-on pose quickly, with a minimum readable wing silhouette.
        const opening = Math.tanh(wave * 2.1);
        return mix(opening < 0 ? Math.min(-SWALLOW_MOTION.wingEdge, opening * 0.6)
          : Math.max(SWALLOW_MOTION.wingEdge, opening), 1, glide);
      };
      near.scale.y = nearScale * flap(0);
      far.scale.y = farScale * flap(0.18);
      const edge = t === 0 ? 1 : 1 - SWALLOW_MOTION.squash * (1 - Math.abs(flap(0)));
      body.scale.y = body.scale.x * edge;
      body.rotation = t === 0 ? 0 : 0.025 * Math.sin(t * 3 + phase);
    } };
  }

  function butterfly(parent: Container, key: string, size: number, phase: number) {
    const texture = tex(key);
    const half = texture.width / 2;
    // Share the source; destroying these subtextures must never destroy that source.
    const leftTexture = new Texture({ source: texture.source, frame: new Rectangle(0, 0, half, texture.height) });
    const rightTexture = new Texture({ source: texture.source, frame: new Rectangle(half, 0, half, texture.height) });
    slices.push(leftTexture, rightTexture);
    const rig = new Container();
    parent.addChild(rig);
    const left = new Sprite(leftTexture);
    const right = new Sprite(rightTexture);
    left.anchor.set(1, 0.5);
    right.anchor.set(0, 0.5);
    rig.addChild(left, right);
    rig.scale.set(size / Math.max(1, texture.width));
    return { rig, width: texture.width, height: texture.height, animate(t: number, minimumOpening = 0.15) {
      // Both halves close together, rather than shearing opposite sides of the body.
      const flap = t === 0 ? 1 : mix(minimumOpening, 1, (1 + Math.cos(t * 5.2 + phase)) / 2);
      left.scale.x = right.scale.x = flap;
    } };
  }

  function flyer(parent: Container, index: number, size: number) {
    const key = `meadow/flyer_${index % 3 + 1}`;
    if (!textures.has(key)) return butterfly(parent, `meadow/small_${index % 4 + 1}`, size, index);
    const rig = new Container(); parent.addChild(rig);
    const wings = sprite(rig, key, 0, 0, tex(key).width);
    // The illustrated body sits near the lower third; squash around that line.
    wings.anchor.set(0.5, BUTTERFLY_MOTION.bodyLine);
    rig.scale.set(size / wings.texture.width);
    const up = wings.texture;
    const down = textures.get(`meadow/flyer_down_${index % 3 + 1}`);
    return { rig, width: wings.texture.width, height: wings.texture.height, animate(t: number, resting = 0) {
      const cycle = (t + index * 1.73) % (6.5 + index % 4);
      const glide = t === 0 ? 1 : ease(cycle / 0.2) * (1 - ease((cycle - BUTTERFLY_MOTION.glideSeconds) / 0.2));
      const beat = Math.cos(t * (BUTTERFLY_MOTION.beatRate + index % 5) + index * 2.4);
      const flap = down ? BUTTERFLY_MOTION.beatSquash + (1 - BUTTERFLY_MOTION.beatSquash) * Math.abs(beat)
        : 0.35 + 0.65 * (0.5 + 0.5 * beat);
      wings.texture = down && beat < 0 && glide < 0.5 && resting < 0.5 ? down : up;
      // Width stays fixed when the two independent cut-outs have different crops.
      wings.scale.x = up.width / wings.texture.width;
      const settled = 0.6 + Math.sin(t * 1.5 + index) * 0.25;
      wings.scale.y = up.width / wings.texture.width * (t === 0 ? 1 : mix(mix(flap, 0.92, glide), settled, resting));
    } };
  }

  // The source feet sit on the bottom of each crop. Three normalized frames
  // swap through an edge-on silhouette, preserving the contact point.
  function perchedButterfly(parent: Container, index: number, size: number) {
    const keys = series(`meadow/perch_${'abcde'[index]}_`, 3);
    if (!keys.every(key => textures.has(key))) return;
    const rig = new Container(); parent.addChild(rig);
    const poses = keys.map((key, i) => {
      const pose = sprite(rig, key, 0, 0, size * tex(key).width / tex(keys[2]).width);
      pose.anchor.set(0.5, BUTTERFLY_MOTION.feetLine); pose.alpha = i === 2 ? 1 : 0;
      return pose;
    });
    return { rig, animate(opening: number) {
      const amount = clamp(opening) * 2;
      const edge = choosePose(poses, poses.map((_, i) => ease(1 - Math.abs(amount - i))));
      // Squash the pose, not the parent: callers set that parent scale for size/facing.
      poses.forEach(pose => { pose.scale.x = pose.scale.y * edge; });
    } };
  }

  // Disconnected groups and asymmetric cubic loops suggest handwriting without spelling words.
  const strokes: Point[][][] = Array.from({ length: 9 }, (_, line) => {
    let seed = 137 + line * 977;
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    let x = -172;
    const groups: Point[][] = [];
    const groupCount = 4 + line % 2;
    const gap = 11;
    const groupWidth = (340 - gap * (groupCount - 1)) / groupCount;
    const baseline = (at: number) => 40 + line * 25 + Math.sin(at * 0.025 + line) * 1.8 + at * 0.004;
    for (let group = 0; group < groupCount; group++) {
      const points: Point[] = [{ x, y: baseline(x) }];
      const curve = (c1: Point, c2: Point, end: Point) => {
        const start = points[points.length - 1];
        for (let step = 1; step <= 18; step++) {
          const t = step / 18;
          const q = 1 - t;
          points.push({ x: q ** 3 * start.x + 3 * q * q * t * c1.x + 3 * q * t * t * c2.x + t ** 3 * end.x,
            y: q ** 3 * start.y + 3 * q * q * t * c1.y + 3 * q * t * t * c2.y + t ** 3 * end.y });
        }
      };
      const gestures = 4 + Math.floor(random() * 3);
      const weights = Array.from({ length: gestures }, () => 0.65 + random() * 0.7);
      const total = weights.reduce((sum, w) => sum + w, 0);
      for (let i = 0; i < gestures; i++) {
        const w = groupWidth * weights[i] / total;
        const y = baseline(x);
        const kind = random();
        const h = 6 + random() * 10;
        if (kind < 0.65) {
          const direction = kind < 0.18 ? 0.6 : -1;
          curve({ x: x + w * 0.2, y: y - 2 }, { x: x + w * 0.55, y: y + direction * h * 0.4 },
            { x: x + w * 0.5, y: y + direction * h * 0.45 });
          curve({ x: x + w * 0.95 + 4, y: y + direction * h * 1.3 },
            { x: x + w * 0.02 + 4, y: y + direction * h * 1.2 },
            { x: x + w * 0.38, y: y + direction * h * 0.25 });
          curve({ x: x + w * 0.24, y: y + 4 }, { x: x + w * 0.8, y: baseline(x + w) + 2 },
            { x: x + w, y: baseline(x + w) });
        } else {
          curve({ x: x + w * 0.65 + 3, y: y - h }, { x: x + w * 0.15, y: y + 7 },
            { x: x + w, y: baseline(x + w) });
        }
        x += w;
      }
      groups.push(points);
      x += gap;
    }
    return groups;
  });

  function sky(): Scene {
    const root = localRoot('haiku');
    const birds = Array.from({ length: PARTICLES.skySwallows * (opts.mobile ? 0.5 : 1) }, (_, i) => swallow(root, 50, i * 0.72));
    return { root, draw(t, level) {
      const w = clear.width * COMPOSITION.subjectWidth / view(root).factor;
      const flock = ease(level - 3);
      const swirl = ease(level - 4);
      const count = sample([1, 3, 6, 12, birds.length], level);
      const flightLeft = -w / 2, flightRight = w / 2;
      birds.forEach((b, i) => {
        b.rig.alpha = ease(count - i);
        b.rig.visible = b.rig.alpha > 0;
        if (!b.rig.visible) return;
        const side = i % 2 ? -1 : 1;
        const row = Math.ceil(i / 2);
        const a = i * 2.399 + t * 0.28;
        const radius = (0.12 + Math.sqrt(i / birds.length) * 0.32) * w;
        const vX = -row * w * 0.07 + w * 0.16;
        const vY = side * row * w * 0.085;
        const loopX = Math.cos(a) * radius;
        const loopY = Math.sin(a * (1 - swirl * 0.08)) * radius * 0.54;
        const size = mix(i === 0 ? w : w * 0.24, w * 0.075, ease((level - 1) / 4)) * (i === 0 ? 1 : 0.82 + (i * 0.618034 % 1) * 0.36);
        const solo = 1 - ease(level - 1);
        const flightX = Math.sin(t * 0.32) * w * SWALLOW_MOTION.drift * (1 - flock);
        const flightY = Math.sin(t * 0.64) * w * SWALLOW_MOTION.bob * (1 - flock);
        b.rig.position.set(flightX + mix(vX * (1 - solo), loopX, flock) + Math.sin(t * 0.55 + i) * size * 0.025,
          flightY + mix(vY, loopY, flock) + Math.sin(t * 0.9 + i) * size * 0.025);
        const room = Math.max(w * SWALLOW_MOTION.drift, (flightRight - flightLeft - size) / 2);
        b.rig.x = (flightLeft + flightRight) / 2 + Math.tanh(b.rig.x / Math.max(1, w * 0.35)) * room;
        b.rig.scale.set(size / 150);
        b.rig.rotation = Math.sin(a + i * 0.71) * (0.06 + i % 4 * 0.025) + Math.sin(t * 0.43 + i * 1.91) * 0.045;
        b.animate(t);
      });
    } };
  }

  const strokeLengths = strokes.map(groups => groups.reduce((sum, points) => sum + points.length - 1, 0));

  function writer() {
    let elapsed = 0, previousT = 0;
    const startedStrokes = new Set<number>();
    const schedule: { start: number; end: number; dip: boolean; line: number; group: number; before: number; after: number }[] = [];
    let seconds = 0;
    strokes.forEach((groups, line) => {
      let length = 0;
      groups.forEach((points, group) => {
        const index = schedule.length;
        const duration = WRITING.strokeSeconds + (Math.sin(index * 7.13) * 0.5 + 0.5) * WRITING.strokeVariation;
        const before = length / strokeLengths[line]; length += points.length - 1;
        const dip = index > 0 && index % WRITING.dipEvery === 0;
        const pause = dip ? WRITING.dipSeconds : WRITING.pauseSeconds
          + (Math.sin(index * 3.71) * 0.5 + 0.5) * WRITING.pauseVariation
          + (index % 3 === 2 ? WRITING.thinkSeconds : 0);
        schedule.push({ start: seconds + pause, end: seconds + pause + duration, dip, line, group,
          before, after: length / strokeLengths[line] });
        seconds += pause + duration;
      });
    });
    return (t: number, amount: number) => {
      const lastLine = Math.max(0, Math.ceil(amount) - 1);
      const endPart = clamp(amount - lastLine);
      const target = schedule.find(event => event.line === lastLine && event.after >= endPart) ?? schedule[schedule.length - 1];
      // Each effort arrives with its own lines already inked. Ambient writing
      // finishes the final word slowly instead of replaying Low's empty page.
      const minimum = mix(target.start, target.end, WRITING.arrivalStrokePart);
      elapsed = clamp(elapsed, minimum, target.end);
      const dt = t - previousT;
      if (t > 0 && previousT > 0 && dt > 0 && dt < WRITING.maxFrameGap && readerSlow && elapsed < target.end) elapsed = Math.min(target.end, elapsed + dt * WRITING.continuationRate);
      previousT = t;
      if (t === 0) return { line: lastLine, part: endPart, dipping: false, dip: 0, lifted: false, complete: 1 };
      const index = schedule.findIndex(event => elapsed < event.end);
      const event = schedule[index < 0 ? schedule.length - 1 : index];
      const pauseStart = index > 0 ? schedule[index - 1].end : 0;
      const drawing = elapsed >= event.start && elapsed < event.end && event.line <= lastLine;
      const part = mix(event.before, event.after, clamp((elapsed - event.start) / (event.end - event.start)));
      const advancing = drawing && Math.floor((Math.min(part, clamp(amount - event.line)) - event.before) * strokeLengths[event.line]) > 0;
      const token = advancing ? index : -1;
      if (token >= 0 && !startedStrokes.has(token)) {
        cue('quill-stroke', token, 'scratch', 'sonnet', t, true);
        startedStrokes.add(token);
      }
      const dipping = event.dip && elapsed < event.start;
      const dip = dipping ? Math.sin(Math.PI * ease((elapsed - pauseStart) / Math.max(0.001, event.start - pauseStart))) : 0;
      return { line: Math.min(lastLine, event.line), part: event.line > lastLine ? endPart : Math.min(part, clamp(amount - event.line)),
        dipping, dip, lifted: !drawing, complete: ease((elapsed - target.end + WRITING.finishFadeSeconds) / WRITING.finishFadeSeconds) };
    };
  }

  // tuned by eye against the art: all points are in tower plate pixels.
  // The near shoulder. The arm always points from here to the nib, and its distance to the page sets the arm's size.
  const TOWER_ARM_PIVOT = { x: 594, y: 1097 };
  // The sleeve dissolves into the robe between these plate columns, wherever the arm has slid to.
  const TOWER_SLEEVE_FADE = { from: 556, to: 592 };
  const TOWER_ARM_WIDTH = 136;
  const TOWER_ARM_SLEEVE = { x: 0.88, y: 0.16 };
  const TOWER_ARM_NIB = { x: 0.12, y: 0.90 };
  const TOWER_PAGE_RECT = { x: 412, y: 1158, width: 108, height: 40 };
  const TOWER_INKWELL_POINT = { x: 426, y: 1140 }; // as far toward the inkwell as the sleeve still reaches the robe
  const TOWER_COMPOSITION_FOCUS = { x: 505, y: 1000 };
  // Inner stone edge: pointed crown at (515, 744), spring near y=994,
  // and the curved sill near y=1254. The old bounds cut across the wizard.
  const TOWER_WINDOW = { x: 508, y: 999, width: 326, height: 510 };
  const TOWER_QUILL = { lineWidth: 5.2, sealWidth: 22 };
  const TOWER_READING_PUSH = 0.65;
  const TOWER_QUILL_TINTS = [0xe5e1d7, 0xc8dce5, 0x467da4, 0xd8b65c, 0xffd77b];

  function tower(): Scene {
    const root = localRoot('sonnet');
    const writing = new Container();
    writing.position.set(-regions.sonnet.focus.x, -regions.sonnet.focus.y);
    root.addChild(writing);
    const ink = new Graphics(), finishedInk = new Graphics(), decorations = new Graphics();
    writing.addChild(finishedInk, ink, decorations);
    ink.position.set(TOWER_PAGE_RECT.x + TOWER_PAGE_RECT.width / 2, TOWER_PAGE_RECT.y);
    ink.scale.set(TOWER_PAGE_RECT.width / 350, TOWER_PAGE_RECT.height / 290);
    for (const layer of [finishedInk, decorations]) {
      layer.position.copyFrom(ink.position); layer.scale.copyFrom(ink.scale);
    }
    // Finished lines are cached geometry. Only the current stroke changes on
    // the ambient clock; mobile samples fewer vertices of the same cursive.
    function traceLine(graphics: Graphics, line: number, part: number): Point {
      let remaining = Math.floor(part * strokeLengths[line]);
      let tip = strokes[line][0][0];
      for (const points of strokes[line]) {
        if (remaining <= 0) break;
        const end = Math.min(points.length - 1, remaining);
        graphics.moveTo(points[0].x, points[0].y);
        for (let j = opts.mobile ? 3 : 2; j < end; j += opts.mobile ? 3 : 2) graphics.lineTo(points[j].x, points[j].y);
        graphics.lineTo(points[end].x, points[end].y); tip = points[end];
        remaining -= points.length - 1;
      }
      return tip;
    }
    const arm = sprite(writing, 'valley/wizard_arm', TOWER_ARM_PIVOT.x, TOWER_ARM_PIVOT.y, TOWER_ARM_WIDTH);
    const ARM_FOLLOW = 7;
    const fadeCanvas = document.createElement('canvas'); fadeCanvas.width = 256; fadeCanvas.height = 1;
    const fadeContext = fadeCanvas.getContext('2d')!, fadeGradient = fadeContext.createLinearGradient(0, 0, 256, 0);
    fadeGradient.addColorStop(0, '#fff'); fadeGradient.addColorStop(0.875, '#fff'); fadeGradient.addColorStop(1, 'rgba(255,255,255,0)');
    fadeContext.fillStyle = fadeGradient; fadeContext.fillRect(0, 0, 256, 1);
    const fadeTexture = Texture.from(fadeCanvas, true); generated.push(fadeTexture);
    const sleeveFade = new Sprite(fadeTexture); writing.addChild(sleeveFade);
    sleeveFade.width = (TOWER_SLEEVE_FADE.to - TOWER_SLEEVE_FADE.from) * 8; sleeveFade.height = 500;
    sleeveFade.position.set(TOWER_SLEEVE_FADE.to - sleeveFade.width, TOWER_ARM_PIVOT.y - 250);
    arm.setMask({ mask: sleeveFade, channel: 'alpha' });
    let handX = TOWER_PAGE_RECT.x + TOWER_PAGE_RECT.width / 2, handY = TOWER_PAGE_RECT.y + TOWER_PAGE_RECT.height / 2, armAt = 0;
    arm.anchor.set(TOWER_ARM_SLEEVE.x, TOWER_ARM_SLEEVE.y);
    // The painted feather alone, on the arm's own canvas, so the level tint follows the hand exactly.
    const quillColor = new Sprite(tex('valley/wizard_quill')); quillColor.anchor.copyFrom(arm.anchor); arm.addChild(quillColor);
    const nib = new Graphics(); nib.blendMode = 'add'; writing.addChild(nib);
    const seal = sprite(writing, 'room/wax_seal', TOWER_PAGE_RECT.x + TOWER_PAGE_RECT.width * 0.91,
      TOWER_PAGE_RECT.y + TOWER_PAGE_RECT.height * 0.91, TOWER_QUILL.sealWidth);
    const writingClock = writer();
    let finishedLine = -1, finishedGold = -1, decoratedLevel = -1;
    return { root, draw(t, level) {
      const amount = sample([1, 3, 5, 7, 9], level);
      const gold = ease(level - 4), underline = ease(level - 2), flourish = ease(level - 3);
      const state = writingClock(t, amount);
      const writingLine = state.line;
      const color = (Math.round(mix(0x39, 0xb1, gold)) << 16)
        | (Math.round(mix(0x37, 0x8a, gold)) << 8) | Math.round(mix(0x44, 0x32, gold));
      if (finishedLine !== writingLine || finishedGold !== gold) {
        finishedInk.clear();
        for (let line = 0; line < writingLine; line++) traceLine(finishedInk, line, 1);
        finishedInk.stroke({ color, width: TOWER_QUILL.lineWidth, alpha: 0.95 });
        finishedLine = writingLine; finishedGold = gold;
      }
      ink.clear();
      const tip = traceLine(ink, writingLine, state.part);
      ink.stroke({ color, width: TOWER_QUILL.lineWidth, alpha: 0.95 });
      const completed = 1; // Effort decoration is present on arrival, including static plates.
      if (decoratedLevel !== level) {
        decorations.clear();
        if (underline > 0) decorations.moveTo(-175, 155).bezierCurveTo(-70, 163, 85, 146, 173, 158)
          .stroke({ color, width: TOWER_QUILL.lineWidth * 0.7, alpha: underline });
        if (flourish > 0) decorations.moveTo(-170, 277).bezierCurveTo(-225, 248, -100, 255, -125, 279)
          .bezierCurveTo(-65, 294, 125, 261, 170, 278).stroke({ color, width: TOWER_QUILL.lineWidth * 0.7, alpha: flourish });
        decoratedLevel = level;
      }
      decorations.alpha = completed;
      const targetX = mix(ink.x + tip.x * ink.scale.x, TOWER_INKWELL_POINT.x, state.dip);
      const targetY = mix(ink.y + tip.y * ink.scale.y - (state.lifted ? WRITING.liftPixels : 0), TOWER_INKWELL_POINT.y, state.dip);
      // The arm keeps its drawn size and swings from the shoulder; the spare sleeve slides under the fade above.
      // Gliding the whole arm with the hand lifted the sleeve end over the wizard's face on every ink dip.
      const follow = t === 0 || armAt === 0 || t < armAt || t - armAt > WRITING.maxFrameGap ? 1 : 1 - Math.exp(-(t - armAt) * ARM_FOLLOW);
      armAt = t;
      handX += (targetX - handX) * follow; handY += (targetY - handY) * follow;
      const dx = (TOWER_ARM_NIB.x - TOWER_ARM_SLEEVE.x) * arm.texture.width;
      const dy = (TOWER_ARM_NIB.y - TOWER_ARM_SLEEVE.y) * arm.texture.height;
      const artAngle = Math.atan2(dy, dx);
      const restX = TOWER_PAGE_RECT.x + TOWER_PAGE_RECT.width / 2, restY = TOWER_PAGE_RECT.y + TOWER_PAGE_RECT.height / 2;
      // Sized once so the sleeve sits on the shoulder pivot when the hand rests mid-page.
      const nominalScale = Math.hypot(restX - TOWER_ARM_PIVOT.x, restY - TOWER_ARM_PIVOT.y) / Math.max(1, Math.hypot(dx, dy));
      const restAngle = Math.atan2(restY - TOWER_ARM_PIVOT.y, restX - TOWER_ARM_PIVOT.x);
      const reach = Math.atan2(handY - TOWER_ARM_PIVOT.y, handX - TOWER_ARM_PIVOT.x) - restAngle;
      const wrist = t === 0 ? 0 : Math.sin(t * 5.3) * 0.006 * (state.lifted ? 0 : 1);
      arm.rotation = restAngle - artAngle + reach + wrist;
      arm.scale.set(nominalScale);
      const length = Math.hypot(dx, dy) * nominalScale, angle = arm.rotation + artAngle;
      arm.x = handX - Math.cos(angle) * length + (t === 0 ? 0 : Math.sin(t * 0.7) * WRITING.sleeveSway);
      arm.y = handY - Math.sin(angle) * length;
      const quillTint = TOWER_QUILL_TINTS[Math.round(clamp(level - 1, 0, 4))];
      quillColor.tint = quillTint;
      nib.clear().circle(handX, handY, 0.8).fill({ color: quillTint, alpha: 0.8 });
      seal.alpha = gold * completed;
    } };
  }

  function room(): Scene {
    const root = localRoot('sonnet');
    const background = sprite(root, 'room/desk', 0, 0, 1100);
    backdrops.set('desk', { sprite: background, root });
    const writing = new Container();
    root.addChild(writing);
    const shadow = new Graphics().roundRect(-243, -152, 480, 306, 10).fill({ color: 0x352516, alpha: 0.18 });
    const paper = new Graphics().roundRect(-238, -155, 470, 302, 9).fill(0xfff7df);
    const ink = new Graphics();
    writing.addChild(shadow, paper, ink);
    // Retain the sampled cursive rig, translated onto the centered sheet.
    ink.y = -150;
    const candle = sprite(writing, 'room/candle', -320, -70, 95);
    const glow = new Graphics();
    for (let i = 8; i > 0; i--) glow.ellipse(0, 0, i * 13, i * 16).fill({ color: 0xffc45c, alpha: 0.015 });
    glow.position.set(candle.x, candle.y - candle.height * 0.46);
    glow.blendMode = 'add';
    const flame = new Graphics().ellipse(0, 0, 4, 11).fill(0xffe7a0);
    flame.position.copyFrom(glow.position);
    writing.addChild(glow, flame);
    const inkwell = sprite(writing, 'room/inkwell', -290, 92, 65);
    // One tiny shared alpha mask fades only the lower-right sleeve cut,
    // leaving the feather and fingertips opaque. It follows each hand's UVs.
    const sleeve = document.createElement('canvas'); sleeve.width = sleeve.height = 128;
    const context = sleeve.getContext('2d')!;
    const pixels = context.createImageData(128, 128);
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      const index = (y * 128 + x) * 4;
      pixels.data[index] = pixels.data[index + 1] = pixels.data[index + 2] = 255;
      const rightFade = ease((x / 127 - 0.64) / 0.36) * ease((y / 127 - 0.50) / 0.18);
      const bottomFade = ease((y / 127 - 0.78) / 0.22) * ease((x / 127 - 0.53) / 0.12);
      pixels.data[index + 3] = Math.round(255 * (1 - rightFade) * (1 - bottomFade));
    }
    context.putImageData(pixels, 0, 0);
    const sleeveTexture = Texture.from(sleeve, true); generated.push(sleeveTexture);
    const quills = series('room/quill_', 5).map(key => {
      const q = sprite(writing, key, 0, 0, 190);
      q.anchor.set(0.035, 0.965);
      const mask = new Sprite(sleeveTexture);
      mask.anchor.copyFrom(q.anchor);
      writing.addChild(mask);
      q.setMask({ mask, channel: 'alpha' });
      return { q, mask };
    });
    const seal = sprite(writing, 'room/wax_seal', 172, 100, 59);
    const writingClock = writer();
    let previousAmount = -1, previousGold = -1, previousUnderline = -1;
    let tip = strokes[0][0][0];
    return { root, draw(t, level) {
      const factor = view(root).factor;
      // Paper and the hand span ~620 source units; keep their combined silhouette left of the rail.
      const unit = Math.min(clear.width * COMPOSITION.subjectWidth / (factor * 620),
        clear.height * COMPOSITION.subjectHeight / (factor * 430));
      writing.x = 0; writing.scale.set(unit);
      candle.x = mix(-255, -320, landscapeMix);
      candle.y = mix(-70, -125, landscapeMix);
      inkwell.x = mix(-265, -290, landscapeMix);
      inkwell.y = mix(92, -90, landscapeMix);
      glow.position.set(candle.x, candle.y - candle.height * 0.46);
      flame.position.copyFrom(glow.position);
      fitBackdrop(background, root);
      const amount = sample([1, 3, 5, 7, 9], level);
      const state = writingClock(t, amount);
      const drawnAmount = state.line + state.part;
      const gold = ease(level - 4);
      const underline = ease(level - 2);
      if (drawnAmount !== previousAmount || gold !== previousGold || underline !== previousUnderline) {
        const color = (Math.round(mix(0x39, 0xb1, gold)) << 16)
          | (Math.round(mix(0x37, 0x8a, gold)) << 8) | Math.round(mix(0x44, 0x32, gold));
        ink.clear();
        strokes.forEach((groups, line) => {
          const part = clamp(drawnAmount - line);
          if (!part) return;
          let remaining = Math.max(1, Math.floor(part * groups.reduce((sum, points) => sum + points.length - 1, 0)));
          for (const points of groups) {
            if (remaining <= 0) break;
            const end = Math.min(points.length - 1, remaining);
            ink.moveTo(points[0].x, points[0].y);
            for (let j = 1; j <= end; j++) ink.lineTo(points[j].x, points[j].y);
            tip = points[end];
            remaining -= points.length - 1;
          }
        });
        ink.stroke({ color, width: TOWER_QUILL.lineWidth, alpha: 0.95 });
        if (underline > 0) ink.moveTo(-175, 155).bezierCurveTo(-70, 163, 85, 146, 173, 158)
          .stroke({ color, width: TOWER_QUILL.lineWidth * 0.7, alpha: underline });
        const flourish = ease(level - 3);
        if (flourish > 0) ink.moveTo(-170, 277).bezierCurveTo(-225, 248, -100, 255, -125, 279)
          .bezierCurveTo(-65, 294, 125, 261, 170, 278).stroke({ color, width: TOWER_QUILL.lineWidth * 0.7, alpha: flourish });
        previousAmount = drawnAmount; previousGold = gold; previousUnderline = underline;
      }
      quills.forEach(({ q, mask }, i) => {
        q.alpha = 1;
        q.visible = i === Math.round(level - 1);
        q.position.set(mix(tip.x, inkwell.x, state.dip),
          mix(tip.y - 150 - (state.lifted ? WRITING.liftPixels : 0), inkwell.y, state.dip));
        q.rotation = Math.sin(t * 2.2) * 0.012;
        mask.position.copyFrom(q.position);
        mask.rotation = q.rotation;
        mask.scale.set(q.width / sleeve.width, q.height / sleeve.height);
      });
      seal.alpha = gold;
      // A brief hover above the paper precedes an eased, overshoot-free stamp.
      seal.y = 100 - 20 * (1 - ease(clamp((level - 4 - 0.12) / 0.88)));
      seal.scale.set(59 / seal.texture.width * mix(1.12, 1, gold));
      flame.scale.set(1 + Math.sin(t * 9) * 0.035, 1 + Math.sin(t * 7) * 0.04);
      flame.alpha = 0.88 + Math.sin(t * 11) * 0.07;
      glow.alpha = 0.82 + Math.sin(t * 1.4) * 0.10;
    } };
  }

  function frogClock(index: number) {
    const schedule = Array.from({ length: FROG_MOTION.scheduleLength }, (_, cycle) => {
      const irregular = (Math.sin((cycle + 1) * 7.13 + index * 3.71) + 1) / 2;
      const idle = FROG_MOTION.idleSeconds + irregular * FROG_MOTION.idleVariation;
      const flight = FROG_MOTION.flightSeconds + irregular * FROG_MOTION.flightVariation;
      return { idle, flight, seconds: idle + FROG_MOTION.crouchSeconds + flight + FROG_MOTION.settleSeconds };
    });
    const period = schedule.reduce((sum, event) => sum + event.seconds, 0);
    return (t: number) => {
      const clock = t + index * FROG_MOTION.stagger;
      let seconds = clock % period, cycle = 0;
      while (seconds >= schedule[cycle].seconds && cycle < schedule.length - 1) seconds -= schedule[cycle++].seconds;
      const event = schedule[cycle];
      const crouch = seconds - event.idle;
      const flight = crouch - FROG_MOTION.crouchSeconds;
      const landing = flight - event.flight;
      const serial = Math.floor(clock / period) * schedule.length + cycle;
      return { seconds, idle: event.idle, crouch, flight, landing, duration: event.flight, serial,
        from: cycle % 2, to: 1 - cycle % 2 };
    };
  }

  function pond(): Scene {
    const root = localRoot('opus');
    // A second copy of just the water sits above the undisturbed plate. Mask
    // AFTER filtering, so displacement cannot drag bank/reeds into the water.
    // Conservative plate-space shoreline, deliberately inside the painted bank.
    const POND_WATER_OUTLINE = [425, 450, 1060, 450, 1510, 478, 1530, 575,
      1390, 710, 1200, 765, 960, 805, 720, 824, 565, 790, 490, 700, 395, 660];
    const waterClip = new Container(), waterLayer = new Container();
    root.addChild(waterClip); waterClip.addChild(waterLayer);
    const water = sprite(waterLayer, 'valley/plate_pond',
      tex('valley/plate_pond').width / 2 - regions.opus.focus.x,
      tex('valley/plate_pond').height / 2 - regions.opus.focus.y, tex('valley/plate_pond').width);
    const waterMask = new Graphics().poly(POND_WATER_OUTLINE).fill(0xffffff);
    waterMask.position.set(-regions.opus.focus.x, -regions.opus.focus.y);
    root.addChild(waterMask); waterClip.mask = waterMask;
    const noiseCanvas = document.createElement('canvas');
    const noiseSize = opts.mobile ? 64 : 128;
    noiseCanvas.width = noiseCanvas.height = noiseSize;
    const context = noiseCanvas.getContext('2d')!;
    const noisePixels = context.createImageData(noiseSize, noiseSize);
    for (let y = 0; y < noiseSize; y++) for (let x = 0; x < noiseSize; x++) {
      const u = x / noiseSize * TAU, v = y / noiseSize * TAU;
      const at = (y * noiseSize + x) * 4;
      // Periodic harmonics tile without seams; smooth noise avoids boiling grain.
      noisePixels.data[at] = 128 + 40 * Math.sin(u * 3 + Math.sin(v * 2)) + 22 * Math.cos(v * 5 - u * 2);
      noisePixels.data[at + 1] = 128 + 43 * Math.cos(v * 3 + Math.sin(u * 2)) + 20 * Math.sin(u * 5 + v * 2);
      noisePixels.data[at + 2] = 128; noisePixels.data[at + 3] = 255;
    }
    context.putImageData(noisePixels, 0, 0);
    const noiseTexture = Texture.from(noiseCanvas, true); generated.push(noiseTexture);
    noiseTexture.source.style.addressMode = 'repeat';
    const noise = new Sprite(noiseTexture); noise.scale.set(3, 0.8); root.addChild(noise);
    const displacement = new DisplacementFilter({ sprite: noise, scale: 0, resolution: opts.mobile ? 0.5 : app.renderer.resolution, padding: 4 });
    effects.push(displacement);
    if (!opts.mobile) waterLayer.filters = [displacement]; // Phone uses geometric rings and shimmer only.
    const shimmer = new Graphics(), ripple = new Graphics();
    root.addChild(shimmer, ripple);
    const pads = Array.from({ length: 11 }, (_, i) => sprite(root, `valley/lily_pad_side_${i % 3 + 1}`, 0, 0, 90));
    const flowers = Array.from({ length: 10 }, () => sprite(root, 'pond/lily_open', 0, 0, 60));
    const bud = sprite(root, 'pond/lily_bud', 0, 0, 48);
    const pebbles = series('pond/pebble_', 8).map(key => sprite(root, key, 0, 0, 45));
    const reeds = sprite(root, 'pond/reeds', 0, 0, 100); reeds.anchor.set(0.5, 1);
    const frogs = Array.from({ length: 5 }, (_, i) => {
      const rig = new Container(); root.addChild(rig);
      const poseKey = i % 3 === 1 ? 'valley/frog_front' : i % 3 === 2 ? 'valley/frog_back' : 'pond/frog_sit';
      const pose = sprite(rig, textures.has(poseKey) ? poseKey : 'pond/frog_sit', 0, 0, 72);
      const sit = sprite(rig, 'pond/frog_sit', 0, 0, 72);
      const croak = sprite(rig, 'valley/frog_croak', 0, 0, 72);
      const hop = sprite(rig, textures.has(leapFiles[1]) ? leapFiles[1] : 'pond/frog_hop', 0, 0, textures.has(leapFiles[1]) ? 148 : 86); // the stretched frame is twice as long as the body
      const crouch = sprite(rig, textures.has(leapFiles[0]) ? leapFiles[0] : 'pond/frog_sit', 0, 0, 72);
      const land = sprite(rig, textures.has(leapFiles[2]) ? leapFiles[2] : 'pond/frog_sit', 0, 0, 72);
      [pose, sit, croak, hop, crouch, land].forEach(s => s.anchor.set(0.5, 1));
      return { rig, pose, sit, croak, hop, crouch, land, clock: frogClock(i) };
    });
    const dragonfly = sprite(root, 'pond/dragonfly', 0, 0, 62);
    // Five disjoint home/landing pairs. Normalized to the responsive water
    // bounds; widths are limited by BOTH row spacing and column spacing.
    const PAD_ACROSS = [0.52, 0.14, 0.22, 0.47, 0.80, 0.88, 0.10, 0.30, 0.86, 0.74, 0.50];
    const PAD_DEPTH = [0.86, 0.78, 0.05, 0.12, 0.36, 0.03, 0.52, 0.30, 0.90, 0.62, 0.42];
    // Put each flower on the side away from the horizontal landing approach.
    const PAD_FLOWER_SIDE = [-1, -1, -1, 1, -1, -1, -1, -1, -1, -1, -1];
    const landingAge = new Float32Array(11);
    const landingStrength = new Float32Array(11);
    return { root, draw(t, level) {
      const bounds = view(root);
      const left = bounds.left + (clear.x - clear.width * COMPOSITION.subjectWidth / 2) / bounds.factor;
      const right = bounds.left + (clear.x + clear.width * COMPOSITION.subjectWidth / 2) / bounds.factor;
      const w = right - left;
      const farY = bounds.top + (clear.y - clear.height * COMPOSITION.pondHeight / 2) / bounds.factor;
      const nearY = bounds.top + (clear.y + clear.height * COMPOSITION.pondHeight / 2) / bounds.factor;
      const depth = Math.max(40, nearY - farY);
      const padCount = sample([1, 3, 5, 7, 11], level);
      const flowerCount = sample([0, 0, 2, 4, 10], level);
      const frogCount = sample([1, 1, 2, 3, 5], level);
      const states = frogs.map(f => f.clock(t));
      noise.position.set(t * 3.2, t * 1.3);
      displacement.scale.set(t === 0 ? 0 : opts.mobile ? 2.4 : 4.8, t === 0 ? 0 : opts.mobile ? 1.1 : 2.2);
      displacement.enabled = t !== 0;
      water.visible = t !== 0 && !opts.mobile;
      landingAge.fill(-1);
      landingStrength.fill(0);
      for (let i = 0; i < frogs.length; i++) {
        if (t === 0) continue;
        const state = states[i];
        const visibility = ease(padCount - i * 2 - 1) * ease(frogCount - i);
        const record = (pad: number, age: number) => {
          if (age >= 0 && age < FROG_MOTION.rippleSeconds && visibility > 0) {
            landingAge[pad] = age;
            landingStrength[pad] = visibility;
          }
        };
        record(i * 2 + state.from, state.flight); // The pad reacts as the feet leave it.
        if (state.landing >= 0) record(i * 2 + state.to, state.landing);
        else record(i * 2 + state.from, state.seconds + FROG_MOTION.settleSeconds);
      }
      pads.forEach((p, i) => {
        const row = PAD_DEPTH[i];
        const size = Math.min(w * 0.25, depth * 0.22) * (0.88 + row * 0.12);
        const age = landingAge[i];
        const bob = age < 0 ? 0 : Math.cos(age * 16) * Math.exp(-age * 5)
          * (opts.mobile ? FROG_MOTION.phoneDipPixels : FROG_MOTION.desktopDipPixels) / bounds.factor * landingStrength[i];
        p.alpha = ease(padCount - i);
        p.position.set(mix(left, right, PAD_ACROSS[i]) + Math.tanh((currentCamera.x - regions.opus.x) / 500) * w * DEPTH.pad * row,
          mix(farY, nearY, row) + bob + (t === 0 ? 0 : Math.sin(t * 0.7 + i) * size * FROG_MOTION.bob));
        p.scale.set(size / p.texture.width);
        p.rotation = t === 0 ? 0 : Math.sin(t * 0.4 + i) * 0.008
          + (age < 0 ? 0 : Math.sin(age * 13) * Math.exp(-age * 4) * FROG_MOTION.padRock * landingStrength[i]);
      });
      flowers.forEach((f, i) => {
        const p = pads[(i + 1) % pads.length], size = p.width * 0.27;
        f.alpha = ease(flowerCount - i) * p.alpha;
        f.position.set(p.x + PAD_FLOWER_SIDE[(i + 1) % pads.length] * p.width * 0.36, p.y - size * 0.28);
        f.scale.set(size / f.texture.width);
      });
      bud.alpha = ease(level - 1) * (1 - ease(level - 2));
      bud.position.set(pads[1].x - pads[1].width * 0.36, pads[1].y - pads[1].width * 0.1);
      bud.scale.set(pads[1].width * 0.27 / bud.texture.width);
      pebbles.forEach((p, i) => {
        p.position.set(mix(bounds.left, bounds.right, i / 7), 300 + Math.sin(i) * 25);
        p.scale.set(w * (0.065 + i % 3 * 0.009) / p.texture.width);
      });
      reeds.position.set(bounds.left - w * 0.03, 340); reeds.scale.set(w * 0.19 / reeds.texture.width);
      ripple.clear();
      frogs.forEach((f, i) => {
        const state = states[i];
        const homePad = pads[i * 2], otherPad = pads[i * 2 + 1];
        // Fade travel in with the second pad; a fractional effort never flips
        // a frog from one bank to another at a hard availability threshold.
        const hopStrength = t === 0 ? 0 : ease(padCount - i * 2 - 1);
        const pad = pads[i * 2 + state.from], destination = pads[i * 2 + state.to];
        const u = clamp(state.flight / state.duration);
        const fromX = pad.x - PAD_FLOWER_SIDE[i * 2 + state.from] * pad.width * 0.12;
        const toX = destination.x - PAD_FLOWER_SIDE[i * 2 + state.to] * destination.width * 0.12;
        const heightOfJump = Math.min(depth, w) * FROG_MOTION.jumpHeight;
        const airborne = state.flight >= 0 && state.landing < 0;
        const settling = state.landing >= 0;
        const croakAt = state.idle * (0.25 + (i * 0.173 % 0.25));
        const croakAge = state.seconds - croakAt;
        const croaking = t > 0 && croakAge >= 0 && croakAge < FROG_MOTION.croakSeconds;
        const pulse = croaking ? Math.sin(Math.PI * croakAge / FROG_MOTION.croakSeconds) ** 2 : 0;
        const frogWidth = mix(homePad.width, mix(pad.width, destination.width, u), hopStrength) * FROG_MOTION.widthOnPad;
        const turn = t === 0 ? 0 : ease((state.seconds - state.idle * 0.58) / FROG_MOTION.crouchSeconds)
          * (1 - ease((state.seconds - state.idle * 0.77) / FROG_MOTION.crouchSeconds));
        f.rig.alpha = ease(frogCount - i); f.rig.visible = f.rig.alpha > 0;
        f.rig.position.set(mix(homePad.x - PAD_FLOWER_SIDE[i * 2] * homePad.width * 0.12,
          mix(fromX, toX, u), hopStrength) + turn * Math.sin(state.seconds * 5 + i) * frogWidth * FROG_MOTION.shuffle,
          mix(homePad.y, mix(pad.y, destination.y, u) - 4 * heightOfJump * u * (1 - u), hopStrength));
        const targetFacing = toX >= fromX ? 1 : -1;
        const shuffleTurn = ease((state.crouch + FROG_MOTION.crouchSeconds) / FROG_MOTION.crouchSeconds);
        const facing = mix(i % 2 ? -1 : 1, mix(-targetFacing, targetFacing, shuffleTurn), hopStrength);
        const crouching = ease(state.crouch / FROG_MOTION.crouchSeconds) * (1 - ease(state.flight / FROG_MOTION.poseBlendSeconds));
        const flightPose = ease(state.flight / FROG_MOTION.poseBlendSeconds)
          * (1 - ease((state.flight - state.duration + FROG_MOTION.poseBlendSeconds) / FROG_MOTION.poseBlendSeconds));
        const landingPose = ease((state.flight - state.duration + FROG_MOTION.poseBlendSeconds) / FROG_MOTION.poseBlendSeconds)
          * (1 - ease(state.landing / FROG_MOTION.settleSeconds));
        const squash = crouching * FROG_MOTION.crouchSquash + (settling
          ? Math.sin(Math.PI * clamp(state.landing / FROG_MOTION.settleSeconds)) * FROG_MOTION.landingSquash : 0);
        const stretch = airborne ? Math.sin(Math.PI * u) * FROG_MOTION.flightStretch : 0;
        const breath = t === 0 ? 0 : Math.sin(t * (1.9 + i * 0.11) + i) * FROG_MOTION.breath;
        f.rig.scale.set(facing * frogWidth / 72 * (1 + stretch + squash * hopStrength * 0.2),
          frogWidth / 72 * (1 + breath + (stretch - squash) * hopStrength));
        const velocityAngle = Math.atan2(destination.y - pad.y - 4 * heightOfJump * (1 - 2 * u), Math.max(1, Math.abs(toX - fromX)));
        f.rig.rotation = airborne ? clamp(velocityAngle, -FROG_MOTION.rotation, FROG_MOTION.rotation)
          * facing * Math.sin(Math.PI * u) * hopStrength : 0;
        const activePose = clamp(crouching + flightPose + landingPose) * hopStrength;
        const idlePose = (1 - activePose) * (1 - pulse);
        const poseEdge = choosePose([f.pose, f.sit, f.croak, f.crouch, f.hop, f.land],
          [idlePose * (1 - turn), idlePose * turn, pulse * (1 - activePose),
            crouching * hopStrength, flightPose * hopStrength, landingPose * hopStrength]);
        f.rig.scale.x *= poseEdge;
        cue(`frog-croak-${i}`, f.rig.visible && croaking ? state.serial : -1, 'croak', 'opus', t);
        cue(`frog-land-${i}`, f.rig.visible && hopStrength > 0 && settling ? state.serial : -1, 'plop', 'opus', t);
        if (f.rig.visible && (croaking || level > 4 || t === 0)) {
          for (let ring = 0; ring < (PARTICLES.waterRipples * (opts.mobile ? 0.5 : 1)); ring++) {
            const p = t === 0 ? 0.25 + ring * 0.23 : (t * 0.38 + ring * 0.31 + i * 0.17) % 1;
            ripple.ellipse(f.rig.x, f.rig.y + 3, frogWidth * (0.35 + ease(p) * 0.9), frogWidth * (0.09 + ease(p) * 0.22))
              .stroke({ color: 0xf2e5ba, width: opts.mobile ? 0.8 : 1.1, alpha: Math.sin(p * Math.PI) * 0.33 * f.rig.alpha });
          }
        }
      });
      for (let i = 0; i < pads.length; i++) {
        const age = landingAge[i];
        if (age < 0) continue;
        const p = age / FROG_MOTION.rippleSeconds;
        ripple.ellipse(pads[i].x, pads[i].y, pads[i].width * (0.48 + p * 0.8), pads[i].width * (0.14 + p * 0.2))
          .stroke({ color: 0xfff4d6, width: FROG_MOTION.ripplePixels / bounds.factor,
            alpha: (1 - ease(p)) * 0.85 * landingStrength[i] });
      }
      shimmer.clear();
      for (let i = 0; i < (PARTICLES.waterShimmers * (opts.mobile ? 0.5 : 1)); i++) {
        const y = mix(farY, nearY, i / (PARTICLES.waterShimmers * (opts.mobile ? 0.5 : 1)));
        shimmer.ellipse((left + right) / 2 + Math.sin(t * 0.28 + i * 1.7) * w * 0.012 + Math.sin(i * 4) * w * 0.22, y, w * 0.18, 0.6)
          .fill({ color: 0xf7edc7, alpha: (opts.mobile ? 0.045 : 0.075) * (0.75 + Math.sin(t * 0.6 + i) * 0.25) });
      }
      dragonfly.alpha = ease(level - 3);
      dragonfly.position.set((left + right) / 2 + w * 0.22 + Math.sin(t * 1.1) * w * 0.008, farY - depth * 0.12 + Math.cos(t * 1.3) * w * 0.004);
      dragonfly.scale.set(w * 0.12 / dragonfly.texture.width); dragonfly.rotation = Math.sin(t * 2) * 0.025;
    } };
  }
  function meadow(): Scene {
    const root = localRoot('fable');
    const grass = sprite(root, 'meadow/grass', 0, 0, 900); grass.anchor.set(0.5, 1);
    const heroes = series('meadow/butterfly_', 5).map((key, i) => ({
      flying: butterfly(root, key, 1, i), perched: perchedButterfly(root, i, 1),
    }));
    const companions = Array.from({ length: opts.mobile ? BUTTERFLY_MOTION.companions / 2 : BUTTERFLY_MOTION.companions }, (_, i) => ({
      flying: flyer(root, i, 1), perched: perchedButterfly(root, i % 5, 1),
    }));
    const highlights = new Graphics(); highlights.blendMode = 'add'; root.addChild(highlights);
    const drinkEnd = BUTTERFLY_MOTION.drinkSeconds;
    const baskEnd = drinkEnd + BUTTERFLY_MOTION.baskSeconds;
    const closeEnd = baskEnd + BUTTERFLY_MOTION.closeSeconds;
    const restEnd = closeEnd + BUTTERFLY_MOTION.restSeconds;
    const airSeconds = BUTTERFLY_MOTION.takeoffSeconds + BUTTERFLY_MOTION.flightSeconds + BUTTERFLY_MOTION.landSeconds;
    const period = restEnd + airSeconds;
    return { root, draw(t, level) {
      const bounds = view(root);
      const unit = width / bounds.factor;
      const flowerSpan = Math.abs(HERO_PERCH_POINTS[1].x - HERO_PERCH_POINTS[0].x) * bounds.factor;
      const heroWidth = Math.max(clear.width * 0.40, Math.min(clear.width * COMPOSITION.subjectWidth - flowerSpan,
        clear.height * COMPOSITION.subjectHeight)) / bounds.factor;
      // Registered to source-art flower heads, so feet remain planted through
      // both camera travel and changing aspect ratios. No screen-space clamp
      // may move a resting butterfly off its flower.
      const flowers = HERO_PERCH_POINTS.map(point => ({ x: point.x - regions.fable.focus.x, y: point.y - regions.fable.focus.y }));
      const cycle = t === 0 ? 0 : Math.floor(t / period);
      const phase = t === 0 ? 0 : t % period;
      const from = flowers[cycle % flowers.length], to = flowers[(cycle + 1) % flowers.length];
      const airAge = phase - restEnd;
      const u = ease(airAge / airSeconds), envelope = Math.sin(Math.PI * u);
      const x = mix(from.x, to.x, u) + Math.sin(t * 3.7) * unit * BUTTERFLY_MOTION.bob * envelope;
      const y = mix(from.y, to.y, u) - envelope * height / bounds.factor * BUTTERFLY_MOTION.flutterHeight
        + Math.sin(t * 5.3) * unit * BUTTERFLY_MOTION.bob * envelope;
      const airborne = ease(airAge / BUTTERFLY_MOTION.perchBlend)
        * (1 - ease((airAge - airSeconds + BUTTERFLY_MOTION.perchBlend) / BUTTERFLY_MOTION.perchBlend));
      const fan = (1 - Math.cos(phase * TAU / BUTTERFLY_MOTION.fanSeconds)) / 2;
      const open = t === 0 ? 0.5 : phase < drinkEnd ? mix(fan, 1, ease((phase - drinkEnd + BUTTERFLY_MOTION.landSeconds) / BUTTERFLY_MOTION.landSeconds))
        : phase < baskEnd ? 1 : phase < closeEnd ? 1 - ease((phase - baskEnd) / BUTTERFLY_MOTION.closeSeconds)
        : phase < restEnd ? 0 : (1 - Math.cos(airAge * BUTTERFLY_MOTION.beatRate)) / 2
          * (1 - ease((airAge - airSeconds + BUTTERFLY_MOTION.landSeconds) / BUTTERFLY_MOTION.landSeconds));
      // Side-view feet own the perch; the flight silhouette owns the whole
      // airborne arc. Swap only while the shared silhouette is edge-on.
      const flightPose = airborne >= 0.5;
      const poseEdge = edgeFlip(airborne);
      const colorEdge = edgeFlip((level - 1) % 1);
      const heroIndex = Math.round(clamp(level - 1, 0, heroes.length - 1));
      heroes.forEach(({ flying, perched }, i) => {
        const selected = i === heroIndex;
        flying.rig.alpha = 1;
        flying.rig.visible = selected && (!perched || flightPose);
        flying.rig.position.set(x, y - heroWidth * 0.12);
        flying.rig.scale.set(heroWidth / flying.width * poseEdge * colorEdge, heroWidth / flying.width);
        flying.rig.rotation = Math.sin(t * 2.1) * 0.08 * airborne;
        flying.animate(t, 0.35);
        if (perched) {
          perched.rig.alpha = 1; perched.rig.visible = selected && !flightPose;
          perched.rig.position.set(x, y);
          // Keep the feet at one point as independent wing crops change size.
          perched.rig.scale.set(heroWidth * poseEdge * colorEdge, heroWidth);
          perched.rig.rotation = Math.sin(t * 2.1) * 0.06 * airborne;
          perched.animate(open);
        }
      });
      const count = sample([0, 2, 4, 8, BUTTERFLY_MOTION.companions], level) * (opts.mobile ? 0.5 : 1);
      companions.forEach(({ flying: b, perched }, i) => {
        const alpha = ease(count - i);
        const depth = 0.15 + (i * 0.618034 % 1) * 0.82;
        const size = Math.min(unit * BUTTERFLY_MOTION.companionWidth, BUTTERFLY_MOTION.companionArtWidth)
          * mix(BUTTERFLY_MOTION.depthSize, 1.3, depth);
        const a = t * (0.25 + depth * 0.12) + i * 2.399;
        const center = mix(bounds.left + unit * 0.16, bounds.left + unit * 0.82, i * 0.381966 % 1);
        const chase = ease(Math.sin(t / BUTTERFLY_MOTION.chaseSeconds + Math.floor(i / 2))) * (i < 4 ? 1 : 0);
        const pairedAngle = t * 1.3 + (i % 2) * Math.PI;
        const pair = Math.floor(i / 2);
        const pairX = mix(bounds.left + unit * 0.16, bounds.left + unit * 0.82, pair * 0.381966 % 1)
          + Math.sin(t * 0.31 + pair) * unit * 0.13;
        const pairY = bounds.top + height * (0.25 + pair * 0.09) / bounds.factor + Math.sin(t * 0.5 + pair) * unit * 0.035;
        const flightX = mix(center + Math.sin(a) * unit * 0.13, pairX, chase)
          + Math.cos(pairedAngle) * unit * BUTTERFLY_MOTION.chaseRadius * chase;
        const flightY = mix(bounds.top + height * (0.20 + depth * 0.29) / bounds.factor
          + Math.sin(a * 2.3) * unit * 0.035 + Math.sin(t * 4.1 + i) * unit * BUTTERFLY_MOTION.bob
          , pairY, chase)
          + Math.sin(pairedAngle) * unit * BUTTERFLY_MOTION.chaseRadius * chase;
        const restPhase = t === 0 ? 0 : (t + i * 3.71) % (period + i % 3 * 3);
        const rest = i % 3 === 0 ? ease((restPhase - drinkEnd) / BUTTERFLY_MOTION.landSeconds)
          * (1 - ease((restPhase - restEnd) / BUTTERFLY_MOTION.takeoffSeconds)) : 0;
        const flower = flowers[(Math.floor(i / 3) + 1) % flowers.length];
        const px = mix(flightX, flower.x, rest), py = mix(flightY, flower.y, rest);
        // Turning through the narrow edge-on pose is continuous, including on
        // reverse scrubs. A landed side-view always faces the art's right.
        const facing = mix(Math.tanh(Math.cos(a) * 6), 1, rest);
        b.rig.alpha = alpha; b.rig.visible = alpha > 0 && (!perched || rest < 0.5);
        b.rig.position.set(px, py); b.rig.scale.set(facing * size / b.width * edgeFlip(rest), size / b.width);
        b.rig.rotation = Math.sin(a * 2) * 0.10 * (1 - rest); b.animate(t, rest);
        if (perched) {
          perched.rig.alpha = alpha; perched.rig.visible = alpha > 0 && rest >= 0.5;
          perched.rig.position.set(px, py); perched.rig.scale.set(size * edgeFlip(rest), size);
          perched.animate((1 - Math.cos(t * TAU / BUTTERFLY_MOTION.fanSeconds + i)) * 0.25);
        }
      });
      grass.position.set((bounds.left + bounds.right) / 2 + Math.tanh((currentCamera.x - regions.fable.x) / 500) * unit * DEPTH.grass,
        bounds.bottom + 4 / bounds.factor);
      grass.scale.set((bounds.right - bounds.left) * 1.15 / grass.texture.width);
      grass.skew.x = Math.sin(t * 0.35) * 0.009;
      highlights.clear();
      const sheen = ease(level - 3), gold = ease(level - 4);
      if (sheen > 0) {
        for (let i = 0; i < (PARTICLES.wingHighlights * (opts.mobile ? 0.5 : 1)); i++) {
          const a = i * TAU / 8;
          highlights.circle(x + Math.cos(a) * heroWidth * 0.3, y - heroWidth * (0.15 + Math.sin(a) * 0.10), heroWidth * 0.012)
            .fill({ color: gold > 0 ? 0xffe7a2 : 0xc3eaff, alpha: sheen * (0.12 + 0.08 * Math.sin(t * 0.7 + i)) * open });
        }
      }
    } };
  }

  function butterflyAurora(parent: Container) {
    if (!textures.has('meadow/butterfly_5')) return;
    let filter: Filter | undefined;
    let light: Sprite | undefined;
    try {
      // mount explicitly selects WebGL, so only the GLSL program is needed.
      const program = GlProgram.from({ name: 'claude-butterfly-aurora',
        vertex: `#version 300 es
          precision highp float;
          in vec2 aPosition;
          out vec2 vTextureCoord; out vec2 vUv;
          uniform vec4 uInputSize; uniform vec4 uOutputFrame; uniform vec4 uOutputTexture;
          void main() {
            vec2 p = aPosition * uOutputFrame.zw + uOutputFrame.xy;
            p.x = p.x * (2.0 / uOutputTexture.x) - 1.0;
            p.y = p.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
            gl_Position = vec4(p, 0.0, 1.0);
            vTextureCoord = aPosition * uOutputFrame.zw * uInputSize.zw;
            vUv = aPosition;
          }`,
        fragment: `#version 300 es
          precision highp float;
          in vec2 vTextureCoord; in vec2 vUv; out vec4 finalColor;
          uniform sampler2D uTexture; uniform vec4 uInputSize;
          uniform float uTime; uniform float uLevel; uniform float uMobile;
          float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
          float noise(vec2 p) {
            vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
            return mix(mix(hash(i), hash(i+vec2(1,0)),f.x),
              mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
          }
          void main() {
            vec2 uv = vUv;
            vec2 feather = uInputSize.zw * 11.0;
            float mask = texture(uTexture, vTextureCoord).a * 0.4;
            mask += texture(uTexture, vTextureCoord + vec2(feather.x,0)).a * 0.15;
            mask += texture(uTexture, vTextureCoord - vec2(feather.x,0)).a * 0.15;
            mask += texture(uTexture, vTextureCoord + vec2(0,feather.y)).a * 0.15;
            mask += texture(uTexture, vTextureCoord - vec2(0,feather.y)).a * 0.15;
            float inner = 1.0-smoothstep(0.07,0.30,abs(uv.x-0.5));
            float lower = smoothstep(0.30,0.62,uv.y);
            float forewings = 1.0-smoothstep(0.42,0.74,uv.y);
            float redteam = smoothstep(0.0,1.0,uLevel);
            float specialized = smoothstep(1.0,2.0,uLevel);
            float lit = mix(inner*mix(0.15,1.0,lower), max(inner,forewings),redteam);
            lit = mix(lit,1.0,specialized);
            vec2 p = vec2(uv.x*19.0 + uTime*0.055,
              uv.y*mix(2.5,5.0,specialized)-uTime*0.13);
            float n = noise(p)*0.65 + noise(p*2.13+7.0)*0.25;
            if (uMobile < 0.5) n += noise(p*4.17+19.0)*0.10;
            float curtain = pow(0.5+0.5*sin(uv.x*64.0+n*9.0+uTime*0.32),1.6);
            float rays = mix(0.48,1.0,curtain)*(0.5+n*0.6);
            float heightFade = smoothstep(0.0,0.16,uv.y)*(1.0-smoothstep(0.82,1.0,uv.y));
            vec3 green = vec3(0.23,0.83,0.48), gold = vec3(1.0,0.89,0.53);
            vec3 color = mix(green,gold,clamp(uv.y*0.95+n*0.35-0.1,0.0,1.0));
            color = mix(color,vec3(0.18,0.70,0.61),curtain*0.17);
            float pulse = 0.925+sin(uTime*0.8)*0.075;
            float alpha = mask*lit*rays*heightFade*mix(0.23,0.88,uLevel/2.0)*pulse*mix(1.0,0.5,uMobile);
            finalColor = vec4(color*alpha,alpha);
          }`,
      });
      // Pixi logs some link failures without throwing. Inspect its cached GL
      // program once, inside this guard, before attaching the effect.
      const renderer = app.renderer as WebGLRenderer;
      const compiled = renderer.shader._getProgramData(program);
      if (!renderer.gl.getProgramParameter(compiled.program, renderer.gl.LINK_STATUS)) throw new Error('Aurora shader did not link');
      filter = new Filter({ glProgram: program, resolution: opts.mobile ? 0.5 : 1,
        clipToViewport: false, blendMode: 'add', resources: { auroraUniforms: {
          uTime: { value: 0, type: 'f32' }, uLevel: { value: 0, type: 'f32' },
          uMobile: { value: opts.mobile ? 1 : 0, type: 'f32' },
        } } });
      light = sprite(parent, 'meadow/butterfly_5', 0, 0, 400);
      light.filters = [filter]; light.visible = false;
      effects.push(filter); aurora = { sprite: light, filter };
    } catch (error) {
      light?.destroy(); filter?.destroy();
      console.warn('[Claude] Aurora unavailable; retaining the night plate', error);
    }
  }

  // Screen fractions and valley plate pixels to review alongside the real art.
  const NIGHT_AURORA = { x: 0.5, y: 0.27, phoneWidth: 0.80, desktopWidth: 0.60, height: 0.27, fullHeight: 0.32, breath: 0.025 };
  const NIGHT_REFLECTION = { x: 650, y: 790 };
  const NIGHT_CHRYSALIS_SIZE = { phone: 0.38, desktop: 0.65, finalPhone: 0.26, finalDesktop: 0.38 };
  function night(): Scene {
    // Screen-space foreground, above the night grade: the camera can pull
    // away to the distant valley without shrinking or darkening the hero.
    const root = new Container();
    butterflyAurora(root);
    const reflection = new Graphics(); reflection.blendMode = 'add'; root.addChild(reflection);
    const glow = new Graphics();
    const source = tex('valley/chrysalis');
    const cocoon = textures.has('valley/chrysalis')
      ? new Texture({ source: source.source, frame: new Rectangle(432, 120, 176, 380) }) : source;
    if (cocoon !== source) slices.push(cocoon);
    const chrysalis = new Sprite(cocoon);
    chrysalis.anchor.set(0.5);
    const thread = new Graphics();
    const wing = new Graphics();
    glow.blendMode = wing.blendMode = 'add';
    root.addChild(glow, thread, chrysalis, wing);
    return { root, draw(t, level) {
      const active = level >= 0;
      const strength = clamp(level, 0, 2);
      const specialized = ease(strength - 1);
      if (aurora) {
        const light = aurora.sprite;
        light.visible = active;
        light.position.set(width * NIGHT_AURORA.x - root.x, height * NIGHT_AURORA.y - root.y);
        const breath = t === 0 ? 1 : 1 + Math.sin(t * 0.8) * NIGHT_AURORA.breath * specialized;
        light.width = width * mix(NIGHT_AURORA.phoneWidth, NIGHT_AURORA.desktopWidth, landscapeMix) * breath;
        light.height = height * mix(NIGHT_AURORA.height, NIGHT_AURORA.fullHeight, specialized) * breath;
        const uniforms = aurora.filter.resources.auroraUniforms.uniforms;
        uniforms.uTime = t; uniforms.uLevel = strength;
      }
      const size = Math.min(clear.width * COMPOSITION.subjectWidth * cocoon.height / cocoon.width,
        clear.height * COMPOSITION.subjectHeight) * mix(1, 0.82, specialized);
      const breadth = size * cocoon.width / cocoon.height;
      chrysalis.scale.set(size / cocoon.height);
      const pulse = 0.925 + Math.sin(t * 0.8) * 0.075;
      reflection.clear();
      if (specialized > 0) {
        const pondX = stage.x + NIGHT_REFLECTION.x * stage.scale.x - root.x;
        const pondY = stage.y + NIGHT_REFLECTION.y * stage.scale.y - root.y;
        for (let i = 7; i > 0; i--) reflection.ellipse(pondX, pondY, width * 0.026 * i, height * 0.0035 * i)
          .fill({ color: 0xa5e4a2, alpha: specialized * pulse * 0.009 });
      }
      glow.clear();
      // Nested additive ellipses form a soft radial falloff, 2.5 times the
      // cocoon's dimensions. No blur filter or extra render target is needed.
      for (let i = 20; i > 0; i--) {
        const radius = i / 20;
        glow.ellipse(0, 0, breadth * 1.25 * radius, size * 1.25 * radius)
          .fill({ color: 0xffbd52, alpha: (0.012 + (1 - radius) * 0.025) * pulse });
      }
      // A warm pool reaches the flowers immediately beneath the cocoon.
      for (let i = 8; i > 0; i--) glow.ellipse(0, size * 0.42, size * 0.10 * i, size * 0.035 * i)
        .fill({ color: 0xffcb76, alpha: 0.012 * pulse });
      thread.clear().moveTo(breadth * 0.15, -height * 0.32)
        .bezierCurveTo(breadth * 0.10, -size * 0.7, breadth * 0.04, -size * 0.6, 0, -size * 0.48)
        .stroke({ color: 0xc5b482, width: 1.4, alpha: 0.72 });
      wing.clear();
      for (const side of [-1, 1]) wing.ellipse(side * breadth * 0.13, size * 0.08, breadth * 0.17, size * 0.20)
        .fill({ color: 0xffefb6, alpha: (0.08 + Math.sin(t * 0.8) * 0.025) * pulse });
    } };
  }

  function landscape(): Scene {
    const root = new Container();
    const clouds = series('sky/cloud_', 3).map((key, i) => sprite(root, key, [350, 880, 1260][i], [120, 180, 310][i], [380, 280, 410][i]));
    clouds.forEach(c => { c.alpha = 0.24; });
    const birds = Array.from({ length: PARTICLES.landscapeSwallows * (opts.mobile ? 0.5 : 1) }, (_, i) => swallow(root, 12 + i % 2 * 3, i));
    const ripple = new Graphics();
    const windowGlow = new Graphics();
    for (let i = 6; i > 0; i--) windowGlow.ellipse(1123, 338, i * 3.2, i * 4.5).fill({ color: 0xffc668, alpha: 0.016 });
    windowGlow.blendMode = 'add';
    root.addChild(ripple, windowGlow);
    const small: ReturnType<typeof flyer>[] = [];
    const addCompanions = () => {
      if (small.length || !textures.has('meadow/small_1')) return;
      for (let i = 0; i < (PARTICLES.landscapeButterflies * (opts.mobile ? 0.5 : 1)); i++) small.push(flyer(root, i, 12));
    };
    landscapeCompanions = addCompanions;
    return { root, draw(t) {
      const cameraX = (width * 0.5 - stage.x) / stage.scale.x - 836;
      const cameraY = (height * 0.5 - stage.y) / stage.scale.y - 470.5;
      clouds.forEach((c, i) => {
        // Two restrained parallax depths, in addition to the slow cloud drift.
        const depth = i % 2 === 0 ? 0.008 : 0.02;
        c.x = [350, 880, 1260][i] + Math.sin(t * (0.035 + i * 0.012) + i) * c.width * 0.025 + Math.tanh(cameraX / 500) * c.width * depth;
        c.y = [120, 180, 310][i] + Math.cos(t * 0.027 + i) * c.height * 0.015 + Math.tanh(cameraY / 350) * c.height * depth;
      });
      birds.forEach((b, i) => {
        const a = t * 0.065 + i * 1.8;
        const skyView = view(root);
        const skyShot = ease((3 - stage.scale.x / base) / 0.5) * (1 - ease((skyView.top - 300) / 50));
        const birdWidth = width * (i === 0 ? 0.12 : 0.075) / skyView.factor;
        const nearX = clamp((skyView.left + skyView.right) / 2 + Math.sin(a) * (skyView.right - skyView.left) * 0.38,
          skyView.left + birdWidth * 0.55, skyView.left + width * 0.82 / skyView.factor - birdWidth * 0.55);
        const nearY = i === 0 ? skyView.top + height * 0.14 / skyView.factor
          : skyView.top + (0.18 + (i % 3) * 0.12) * Math.min(skyView.bottom - skyView.top, 340) + Math.sin(a * 1.4 + i) * 6;
        b.rig.position.set(mix(660 + Math.sin(a) * 460, nearX, skyShot),
          mix(205 + Math.sin(a * 1.4 + i) * 70, nearY, skyShot));
        b.rig.scale.set(mix(12 + i % 2 * 3, birdWidth, skyShot) / 150);
        b.rig.rotation = Math.cos(a) * 0.04;
        b.animate(t);
      });
      windowGlow.alpha = 0.75 + Math.sin(t * 2.9) * 0.035;
      ripple.clear();
      for (let i = 0; i < (PARTICLES.landscapeRipples * (opts.mobile ? 0.5 : 1)); i++) {
        const p = t === 0 ? 0.2 + i * 0.13 : (t * 0.11 + i * 0.23) % 1;
        ripple.ellipse(360 + i * 58, 794 + Math.sin(i) * 20, 6 + ease(p) * 24, 2 + ease(p) * 5)
          .stroke({ color: 0xf3e6c5, width: 0.8, alpha: Math.sin(p * Math.PI) * 0.23 });
      }
      small.forEach((b, i) => {
        b.rig.position.set(1290 + Math.sin(t * 0.20 + i * 2) * 65, 698 + Math.sin(t * 0.34 + i) * 16);
        b.rig.scale.x = Math.abs(b.rig.scale.x) * (Math.cos(t * 0.20 + i * 2) < 0 ? -1 : 1);
        b.animate(t);
      });
    } };
  }

  function travellingLife(): Scene {
    const root = new Container();
    const birds = Array.from({ length: opts.mobile ? ATMOSPHERE.swallows / 2 : ATMOSPHERE.swallows }, (_, i) => swallow(root, 1, i * 1.71));
    const clouds = Array.from({ length: PARTICLES.clouds * (opts.mobile ? 0.5 : 1) }, (_, i) => sprite(root, `sky/cloud_${i % 3 + 1}`, 0, 0, 1));
    const butterflies: ReturnType<typeof flyer>[] = [];
    return { root, draw(t) {
      const cameraX = (currentCamera.x - regions.haiku.x) / 1672;
      const cameraY = (currentCamera.y - regions.haiku.y) / 941;
      const carry = 1 - ease(journeyValue / ATMOSPHERE.swallowCarryEnd);
      clouds.forEach((cloud, i) => {
        cloud.alpha = carry * 0.12;
        cloud.position.set(width * (0.2 + i * 0.34 + Math.sin(t * 0.035 + i) * 0.05 - cameraX * DEPTH.cloud),
          height * (0.08 + i * 0.065 - cameraY * DEPTH.cloud));
        cloud.scale.set(width * 0.65 / cloud.texture.width);
      });
      birds.forEach((bird, i) => {
        const distance = ease(journeyValue / ATMOSPHERE.swallowCarryEnd);
        const size = width * mix(0.055, 0.020, distance) * (1 + i % 2 * 0.15);
        bird.rig.alpha = carry;
        bird.rig.position.set(width * (0.15 + i * 0.12 + Math.sin(t * 0.18 + i) * 0.06 - cameraX * DEPTH.swallow),
          height * (mix(0.17, 0.07, distance) + i % 3 * 0.027 + Math.sin(t * 0.30 + i) * 0.012 - cameraY * DEPTH.swallow));
        bird.rig.scale.set(size / 150); bird.rig.rotation = Math.sin(t * 0.23 + i) * 0.06;
        bird.animate(t);
      });
      if (!butterflies.length && textures.has('meadow/small_1')) {
        for (let i = 0; i < (opts.mobile ? ATMOSPHERE.seamButterflies / 2 : ATMOSPHERE.seamButterflies); i++) butterflies.push(flyer(root, i, 1));
      }
      const arrival = ease((journeyValue - ATMOSPHERE.butterflyArrival) / (3 - ATMOSPHERE.butterflyArrival))
        * (1 - ease(journeyValue - 3)) * (scenes.has('fable') ? ease((t - (readyAt.get('fable') ?? t)) / JOURNEY.loadFadeSeconds) : 0);
      butterflies.forEach((b, i) => {
        b.rig.alpha = arrival * 0.75;
        b.rig.position.set(width * (0.20 + i * 0.17 + Math.sin(t * 0.33 + i * 2) * 0.07),
          height * (0.33 + Math.sin(t * 0.51 + i) * 0.08 - cameraY * DEPTH.swallow));
        const size = width * BUTTERFLY_MOTION.companionWidth * BUTTERFLY_MOTION.depthSize;
        b.rig.scale.set(Math.tanh(Math.cos(t * 0.33 + i * 2) * 6) * size / b.width, size / b.width); b.animate(t);
      });
    } };
  }

  async function ensure(name: SceneName): Promise<void> {
    const existing = pending.get(name);
    if (existing) return existing;
    const job = (async () => {
      await assetCleanup;
      if (dead) return;
      await Promise.all(files[name].map(async key => {
        // Desktop takes the upscaled copy (scripts/upscale-art.sh) where one exists. Telling Pixi its resolution keeps
        // every size in the code the same; mipmaps keep it calm when the camera pulls far back.
        // Not named "@2x": Cloudflare answers any path containing "@" with a redirect.
        const scale = sharpArt ? (hires as Record<string, number>)[key] ?? 1 : 1;
        let path = url(key, scale);
        try {
          let texture = scale > 1
            ? await Assets.load<Texture>({ src: path, data: { resolution: scale, autoGenerateMipmaps: true } }).catch(() => undefined) : undefined;
          // One dropped request on mobile data used to swap the whole world for the fallback drawing: retry first.
          if (!texture) { path = url(key); texture = await Assets.load<Texture>(path, { strategy: 'retry', retryCount: 3, retryDelay: 1000 }); }
          loaded.add(path);
          if (!dead) textures.set(key, texture);
        } catch (error) {
          if (!optionalArt.has(key)) throw error;
          // Optional replacement art may be deployed after the code.
        }
      }));
      if (dead) return;
      const layer = addSceneLayer(name);
      if (name === 'haiku') {
        if (!textures.has('valley/plate_wide')) throw new Error('Claude valley plate could not load');
        wide = sprite(stage, 'valley/plate_wide', 836, 470.5, 1672);
        wide.zIndex = 0;
        // A sky-only crop of the existing art owns Haiku's complete viewport.
        // The valley map returns during travel, rather than peeking below it.
        const skyTexture = new Texture({ source: wide.texture.source, frame: new Rectangle(0, 0, 940, 350) });
        slices.push(skyTexture);
        const skyRoot = new Container(); skyRoot.zIndex = 0.5;
        const skyPlate = new Sprite(skyTexture); skyPlate.anchor.set(0.5);
        skyRoot.addChild(skyPlate); layer.addChild(skyRoot);
        skyBackdrop = { sprite: skyPlate, root: skyRoot };
        backdrops.set('sky', skyBackdrop);
        ambient = landscape();
        ambient.root.zIndex = 1;
        stage.addChild(ambient.root);
        travellers = travellingLife(); app.stage.addChildAt(travellers.root, 1);
      }
      if (name === 'sonnet') towerRig = textures.has('valley/plate_tower_still') && textures.has('valley/wizard_arm');
      if (name === 'fable') landscapeCompanions?.();
      const r = regions[name];
      if (r.plate && textures.has(r.plate)) {
        const key = name === 'sonnet' && towerRig ? 'valley/plate_tower_still' : r.plate;
        const plate = sprite(layer, key, 0, 0, tex(key).width * r.scale);
        plate.position.set(r.x + (plate.texture.width / 2 - r.focus.x) * r.scale,
          r.y + (plate.texture.height / 2 - r.focus.y) * r.scale);
        plate.zIndex = 0;
        plate.visible = false;
        plates.set(name, plate);
        if (name === 'sonnet') {
          const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 1;
          const texture = Texture.from(canvas, true); generated.push(texture);
          const mask = new Sprite(texture); mask.anchor.set(0.5); layer.addChild(mask);
          plate.setMask({ mask, channel: 'alpha' });
          towerMask = { sprite: mask, texture, canvas, amount: -1 };
        }
      }
      const builders = { haiku: sky, sonnet: towerRig ? tower : room, opus: pond, fable: meadow, mythos: night };
      const scene = builders[name]();
      scene.root.zIndex = 1;
      scene.root.visible = false;
      scenes.set(name, scene);
      readyAt.set(name, lastT);
      if (name === 'mythos') app.stage.addChild(scene.root);
      else layer.addChild(scene.root);
      if (name === 'sonnet') { towerLife.zIndex = 2; layer.addChild(towerLife); }
    })();
    pending.set(name, job);
    return job;
  }

  function home(name: SceneName): Camera {
    const r = regions[name];
    if (name === 'haiku') return skyArrival();
    if (name === 'mythos') return between(home('fable'), nightCamera(), JOURNEY.nightPullback);
    return { x: r.x, y: r.y, zoom: name === 'sonnet' ? mix(5.2, 3, landscapeMix) : r.zoom, aim: focusY(), across: focusX() };
  }
  function skyArrival(): Camera { return { x: 535, y: 285, zoom: mix(1.85, 1.5, landscapeMix), aim: mix(0.44, 0.50, landscapeMix), across: focusX() }; }
  function establishing(): Camera { return { x: mix(1000, 836, landscapeMix), y: 470.5, zoom: 1, aim: 0.5, across: 0.5 }; }
  function nightCamera(): Camera {
    // Minimum extra crop needed to expose the real distant window at x=80%,
    // beyond the foreground cocoon, rather than painting a second tower.
    const zoom = mix(1, Math.max(1, width * 0.80 / (1123 * base)), landscapeMix);
    return { x: mix(establishing().x, 1123 - width * 0.30 / (base * zoom), landscapeMix), y: 470.5, zoom, aim: 0.5, across: 0.5 };
  }
  function between(a: Camera, b: Camera, p: number): Camera {
    const f = ease(p);
    return { x: mix(a.x, b.x, f), y: mix(a.y, b.y, f), zoom: mix(a.zoom, b.zoom, f), aim: mix(a.aim, b.aim, f), across: mix(a.across, b.across, f) };
  }
  function travel(a: Camera, b: Camera, p: number): Camera {
    // One C2 path across the complete interval: no internal anchors, clamps,
    // or held fractions. Log zoom gives outward/inward travel a common speed.
    const f = ease(p), camera = between(a, b, p);
    const logZoom = mix(Math.log(a.zoom), Math.log(b.zoom), f);
    const excursion = Math.max(0, Math.log(Math.sqrt(a.zoom * b.zoom) / JOURNEY.wideZoom));
    camera.zoom = Math.exp(logZoom - Math.sin(Math.PI * f) ** 2 * JOURNEY.zoomExcursion * excursion);
    return camera;
  }
  function setCamera(camera: Camera) {
    currentCamera = camera;
    const scale = base * camera.zoom;
    stage.scale.set(scale);
    stage.position.set(width * camera.across - camera.x * scale, height * camera.aim - camera.y * scale);
    // Softly compress framing near the valley's edges. Unlike a hard clamp,
    // tanh preserves velocity while keeping an opaque map under every bloom.
    const coverAxis = (offset: number, viewport: number, extent: number) => {
      const room = Math.max(0, (extent * scale - viewport) / 2);
      return (viewport - extent * scale) / 2 + room * Math.tanh((offset - (viewport - extent * scale) / 2) / Math.max(0.001, room));
    };
    stage.x = coverAxis(stage.x, width, 1672); stage.y = coverAxis(stage.y, height, 941);
  }
  function readClearArea() {
    const style = getComputedStyle(stageElement);
    const value = (key: string, phone: number, desktop: number, max: number) => {
      const raw = style.getPropertyValue(key).trim();
      const parsed = raw ? Number.parseFloat(raw) : NaN;
      return clamp(Number.isFinite(parsed) ? parsed : opts.mobile ? phone : desktop, 0, max);
    };
    clear.top = value('--clear-top', COMPOSITION.mobileTop, COMPOSITION.desktopTop, height - 1);
    clear.bottom = value('--clear-bottom', COMPOSITION.mobileBottom, COMPOSITION.desktopBottom, height - clear.top - 1);
    clear.right = value('--clear-right', COMPOSITION.mobileRight, COMPOSITION.desktopRight, width - 1);
    clear.width = width - clear.right; clear.height = height - clear.top - clear.bottom;
    clear.x = clear.width / 2; clear.y = clear.top + clear.height / 2;
  }
  function resize(el: HTMLElement) {
    width = Math.max(1, el.clientWidth); height = Math.max(1, el.clientHeight);
    readClearArea();
    landscapeMix = ease((width / height - 0.9) / 0.3);
    base = Math.max(width / 1672, height / 941);
    app.renderer.resize(width, height);
    app.stage.filterArea = new Rectangle(0, 0, width, height);
    tint.clear().rect(0, 0, width, height).fill(0x1b1f2e);
    moonlight.clear().rect(0, 0, width, height).fill(0x719aca);
  }
  function nightSky(t: number, meadowAlpha: number) {
    stars.clear(); fireflies.clear(); nightWindow.clear();
    if (dusk <= 0) return;
    const count = opts.mobile ? ATMOSPHERE.stars / 2 : ATMOSPHERE.stars;
    const project = (x: number, y: number): Point => ({ x: stage.x + x * stage.scale.x, y: stage.y + y * stage.scale.y });
    const meadowPlate = plates.get('fable');
    const meadowHorizon = meadowPlate ? stage.y + (meadowPlate.y + (190 - meadowPlate.texture.height / 2) * meadowPlate.scale.y) * stage.scale.y : 0;
    const skyBottom = clamp(mix(project(0, 340).y, meadowHorizon, meadowAlpha), height * 0.06, height * 0.40);
    for (let i = 0; i < count; i++) {
      const x = ((i * 0.618034 + 0.17) % 1) * width;
      const y = (0.06 + ((i * 0.381966 + 0.11) % 0.88)) * skyBottom;
      const twinkle = 0.85 + Math.sin(t * 0.6 + i) * 0.10;
      stars.circle(x, y, i % 7 === 0 ? 1.65 : 0.95).fill({ color: 0xe3ecff, alpha: ease((dusk - 0.4) / 0.6) * twinkle });
    }
    const flyCount = opts.mobile ? ATMOSPHERE.fireflies / 2 : ATMOSPHERE.fireflies;
    for (let i = 0; i < flyCount; i++) {
      const x = width * (0.10 + i / (flyCount - 1) * 0.80 - (currentCamera.x / 1672) * DEPTH.firefly) + Math.sin(t * 0.24 + i * 2.4) * 4;
      const y = height * (0.23 + (i * 0.271 % 0.28) - (currentCamera.y / 941) * DEPTH.firefly) + Math.sin(t * 0.31 + i) * 3;
      const alpha = ease((journeyValue - 2) / 1.6) * (0.42 + (0.5 + 0.5 * Math.sin(t * 0.8 + i)) ** 3 * 0.42);
      fireflies.circle(x, y, 6).fill({ color: 0xffbd52, alpha: alpha * 0.05 })
        .circle(x, y, 3).fill({ color: 0xffd57b, alpha: alpha * 0.15 })
        .circle(x, y, 1.3).fill({ color: 0xffe3a2, alpha });
    }
    const w = project(1123, 338);
    const zoom = stage.scale.x;
    for (let i = 6; i > 0; i--) nightWindow.ellipse(w.x, w.y, i * 3.2 * zoom, i * 4.5 * zoom)
      .fill({ color: 0xffc36a, alpha: dusk * 0.022 * (0.96 + Math.sin(t * 2.9) * 0.03) });
    nightWindow.ellipse(w.x, w.y, 3.4 * zoom, 8 * zoom).fill({ color: 0xffd27e, alpha: dusk * 0.65 });
  }

  function platePoint(name: SceneName, point: Point): Point {
    const plate = plates.get(name)!;
    return { x: plate.x + (point.x - plate.texture.width / 2) * plate.scale.x,
      y: plate.y + (point.y - plate.texture.height / 2) * plate.scale.y };
  }
  function layerPull(layer: Container, anchor: Point, zoom: number, target: Point) {
    layer.scale.set(zoom);
    layer.position.set(target.x - anchor.x * zoom, target.y - anchor.y * zoom);
  }
  // A padded, viewport-space alpha texture has no physical edge on stage.
  // Eight additive contours feather the opening in CSS pixels, including on
  // renderers without the journey shaders or Canvas2D blur support.
  function paintOpening(draw: (context: CanvasRenderingContext2D, inset: number) => void) {
    const padding = HANDOFF.feather * 2;
    const w = Math.ceil(width + padding * 2), h = Math.ceil(height + padding * 2);
    if (openingCanvas.width !== w || openingCanvas.height !== h) {
      openingCanvas.width = w; openingCanvas.height = h;
    }
    const context = openingCanvas.getContext('2d')!;
    context.resetTransform(); context.clearRect(0, 0, w, h);
    context.translate(padding, padding);
    context.globalCompositeOperation = 'lighter';
    context.fillStyle = 'white'; context.globalAlpha = 1 / HANDOFF.feather;
    for (let i = 0; i < HANDOFF.feather; i++) {
      context.beginPath(); draw(context, i - (HANDOFF.feather - 1) / 2); context.fill();
    }
    openingTexture.source.update();
    windowOpening.position.set((-stage.x - padding) / stage.scale.x, (-stage.y - padding) / stage.scale.y);
    windowOpening.scale.set(w / openingTexture.width / stage.scale.x, h / openingTexture.height / stage.scale.y);
  }
  function pullThroughWindow(progress: number) {
    const layer = sceneLayers.get('sonnet')!, skyLayer = sceneLayers.get('haiku')!;
    const plate = plates.get('sonnet');
    if (!plate) return;
    const center = { x: (clear.x - stage.x) / stage.scale.x, y: (clear.y - stage.y) / stage.scale.y };
    const window = platePoint('sonnet', TOWER_WINDOW);
    const windowWidth = TOWER_WINDOW.width * plate.scale.x;
    const windowHeight = TOWER_WINDOW.height * plate.scale.y;
    const cover = Math.max(2 * Math.max(clear.x, width - clear.x) / (windowWidth * stage.scale.x),
      2 * Math.max(clear.y, height - clear.y) / (windowHeight * stage.scale.y)) * HANDOFF.windowCover;
    const zoom = Math.exp(mix(Math.log(Math.max(1, cover)), 0, progress));
    const target = { x: mix(center.x, window.x, progress), y: mix(center.y, window.y, progress) };
    layerPull(layer, window, zoom, target);
    // The sky remains live inside the arch as the room recedes around it.
    // The painted plate has a bookcase in that opening, so the live sky closes
    // into the original art before arrival rather than covering the books.
    const w = windowWidth * zoom * stage.scale.x, h = windowHeight * zoom * stage.scale.y;
    const left = stage.x + target.x * stage.scale.x - w / 2;
    const top = stage.y + target.y * stage.scale.y - h / 2;
    paintOpening((context, inset) => {
      context.save(); context.translate(left + inset, top + inset); context.scale(w - inset * 2, h - inset * 2);
      // Follow the painted crown, slightly bowed jambs and sill; no straight
      // closing segment can slice across the room during the pullback.
      context.moveTo(0, 1);
      context.bezierCurveTo(-0.005, 0.82, -0.005, 0.63, 0, 0.49);
      context.bezierCurveTo(0, 0.27, 0.22, 0.105, 0.52, 0);
      context.bezierCurveTo(0.80, 0.105, 0.99, 0.27, 1, 0.49);
      context.bezierCurveTo(1.005, 0.64, 1.005, 0.81, 1, 0.98);
      context.bezierCurveTo(0.66, 0.98, 0.34, 1.005, 0, 1);
      context.closePath(); context.restore();
    });
    skyLayer.setMask({ mask: windowOpening, channel: 'alpha' });
    skyLayer.zIndex = layer.zIndex + 0.5;
    skyLayer.alpha *= 1 - ease((progress - HANDOFF.windowSkyEnd + HANDOFF.windowSkyFade) / HANDOFF.windowSkyFade);
    fallbackWeights.set('haiku', skyLayer.alpha);
    const hero = scenes.get('haiku')!.root;
    const shrink = mix(1, Math.min(1, windowWidth * stage.scale.x / clear.width), progress);
    hero.scale.set(hero.scale.x * shrink);
    hero.x = mix(hero.x, target.x, progress); hero.y = mix(hero.y, target.y, progress);
  }
  function bloomFromPage(progress: number) {
    const roomLayer = sceneLayers.get('sonnet')!, pondLayer = sceneLayers.get('opus')!;
    const plate = plates.get('sonnet');
    const center = { x: (clear.x - stage.x) / stage.scale.x, y: (clear.y - stage.y) / stage.scale.y };
    const page = plate ? platePoint('sonnet', { x: TOWER_PAGE_RECT.x + TOWER_PAGE_RECT.width / 2,
      y: TOWER_PAGE_RECT.y + TOWER_PAGE_RECT.height / 2 }) : center;
    const target = { x: mix(page.x, center.x, progress), y: mix(page.y, center.y, progress) };
    layerPull(roomLayer, page, mix(1, HANDOFF.pagePush, progress), target);
    const origin = { x: (stage.x + target.x * stage.scale.x) / width,
      y: (stage.y + target.y * stage.scale.y) / height };
    const reach = Math.hypot(Math.max(origin.x, 1 - origin.x) * width, Math.max(origin.y, 1 - origin.y) * height);
    const radius = reach * progress * (1 + HANDOFF.bloomNoise * 2);
    const vertices = HANDOFF.bloomVertices * (opts.mobile ? 0.5 : 1);
    const points: number[] = [];
    for (let i = 0; i < vertices; i++) {
      const angle = i * TAU / vertices;
      const r = radius * (1 + HANDOFF.bloomNoise * Math.sin(angle * 7 + 1.3) * Math.sin(angle * 3 + 0.6));
      points.push(target.x + Math.cos(angle) * r / stage.scale.x, target.y + Math.sin(angle) * r / stage.scale.y);
    }
    inkOpening.clear().poly(points).fill(0xffffff);
    inkBloomLayer = pondLayer;
    const filter = bloomFilters.get('opus');
    if (filter && !opts.mobile) {
      const uniforms = filter.resources.bloomUniforms.uniforms;
      uniforms.uProgress = progress; uniforms.uIncoming = 1;
      uniforms.uOrigin[0] = origin.x; uniforms.uOrigin[1] = origin.y; uniforms.uAspect = width / height;
      pondLayer.filters = [filter];
    } else pondLayer.mask = inkOpening;
  }

  function tiltToMeadow(progress: number) {
    const center = { x: (width / 2 - stage.x) / stage.scale.x, y: (height / 2 - stage.y) / stage.scale.y };
    for (const name of ['opus', 'fable'] as const) {
      const layer = sceneLayers.get(name)!, plate = plates.get(name)!;
      const dy = height * (name === 'opus' ? progress : progress - 1);
      const left = stage.x + (plate.x - plate.width / 2) * stage.scale.x;
      const right = stage.x + (plate.x + plate.width / 2) * stage.scale.x;
      const top = stage.y + (plate.y - plate.height / 2) * stage.scale.y;
      const bottom = stage.y + (plate.y + plate.height / 2) * stage.scale.y;
      // Keep the actual plate edges outside the viewport while the actors
      // and their painted surroundings move together through the tilt.
      const zoom = Math.max(1, (width / 2 + HANDOFF.feather) / (width / 2 - left),
        (width / 2 + HANDOFF.feather) / (right - width / 2),
        (height / 2 + dy + HANDOFF.feather) / (height / 2 - top),
        (height / 2 - dy + HANDOFF.feather) / (bottom - height / 2));
      layerPull(layer, center, zoom, { x: center.x, y: center.y + dy / stage.scale.y });
    }
    paintOpening((context, inset) => {
      const padding = HANDOFF.feather * 2;
      const edge = mix(-padding, height + padding, progress) + inset;
      const bend = Math.sin(progress * Math.PI) * Math.min(width, height) * 0.035;
      context.moveTo(-padding, -padding); context.lineTo(width + padding, -padding);
      context.lineTo(width + padding, edge);
      context.bezierCurveTo(width * 0.7, edge - bend, width * 0.3, edge + bend, -padding, edge);
      context.closePath();
    });
    sceneLayers.get('fable')!.setMask({ mask: windowOpening, channel: 'alpha' });
  }

  function renderSafely() {
    try { app.render(); }
    catch (error) {
      // WebGL failures may surface on first use rather than construction.
      // Restore the exact alpha weights of this frame before retrying.
      if (bloomProgram || sharedGrade) {
        bloomProgram = undefined; sharedGrade = undefined;
        app.stage.filters = [];
        for (const [name, layer] of sceneLayers) {
          layer.filters = []; layer.alpha = fallbackWeights.get(name) ?? layer.alpha;
        }
        bloomFilters.clear();
        if (inkBloomLayer) inkBloomLayer.mask = inkOpening;
        console.warn('[Claude] Journey shaders disabled; retaining geometric masks and painted plates', error);
        renderSafely(); return;
      }
      if (!aurora?.sprite.visible) throw error;
      aurora.sprite.visible = false; aurora.sprite.filters = [];
      aurora.sprite.destroy(); aurora = undefined;
      console.warn('[Claude] Aurora disabled after rendering failed', error);
      app.render();
    }
  }

  return {
    async mount(el, options) {
      opts = options;
      stageElement = el.closest<HTMLElement>('#stage') ?? document.getElementById('stage') ?? el;
      app = new Application();
      await app.init({ preference: 'webgl', autoStart: false, sharedTicker: false,
        eventMode: 'none', eventFeatures: { move: false, globalMove: false, click: false, wheel: false },
        width: Math.max(1, el.clientWidth), height: Math.max(1, el.clientHeight),
        resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true,
        background: PAPER, antialias: !opts.mobile, powerPreference: 'low-power' });
      initialized = true;
      const gl = (app.renderer as WebGLRenderer).gl;
      sharpArt = !opts.mobile && gl.getParameter(gl.MAX_TEXTURE_SIZE) >= 8192; // the largest copy is 3072x4608
      if (dead) { app.destroy(true, { children: true }); return; }
      app.stop();
      // Feature flags alone still install listeners and touch-action:none in
      // Pixi v8. Detach its documented event target before mounting the canvas.
      app.renderer.events.autoPreventDefault = false;
      app.renderer.events.setTargetElement(null!);
      app.stage.eventMode = 'none'; app.stage.interactiveChildren = false;
      app.canvas.style.touchAction = 'pan-y'; app.canvas.style.pointerEvents = 'none';
      const empty = document.createElement('canvas'); empty.width = empty.height = 1;
      fallbackTexture = Texture.from(empty, true); generated.push(fallbackTexture);
      openingCanvas = document.createElement('canvas');
      openingCanvas.width = openingCanvas.height = 1;
      openingTexture = Texture.from(openingCanvas, true); generated.push(openingTexture);
      openingTexture.dynamic = true;
      windowOpening = new Sprite(openingTexture);
      app.canvas.style.display = 'block'; app.canvas.style.width = '100%'; app.canvas.style.height = '100%';
      app.canvas.setAttribute('aria-hidden', 'true'); el.appendChild(app.canvas);
      stage.sortableChildren = true;
      tint.blendMode = 'multiply'; moonlight.blendMode = 'screen';
      nightWindow.blendMode = fireflies.blendMode = 'add';
      app.stage.addChild(stage, tint, moonlight, stars, fireflies, nightWindow);
      stage.addChild(towerLife, windowOpening, inkOpening);
      resize(el);
      preparePaperLight();
      observer = new ResizeObserver(() => { if (!dead) resize(el); }); observer.observe(el);
      clearObserver = new MutationObserver(() => { if (!dead) readClearArea(); });
      clearObserver.observe(stageElement, { attributes: true, attributeFilter: ['style', 'class'] });
      await ensure('haiku');
      if (dead) return;
      setCamera(skyArrival());
      sceneLayers.get('haiku')!.visible = true;
      fitBackdrop(skyBackdrop.sprite, skyBackdrop.root);
      ambient?.draw(0, 1);
      travellers?.draw(0, 1);
      tint.alpha = moonlight.alpha = 0;
      renderSafely();
      // Mount needs only the establishing plate and sky rig. Other downloads
      // never block it, and late completions cannot recreate a destroyed world.
      // The next close-up is prefetched only when its predecessor becomes active.
    },
    frame(pos, time) {
      if (dead || !initialized || !wide) return;
      const t = opts.reduced || time === 0 ? 0 : Math.max(0, time);
      lastT = t;
      const ids = opts.models.map(m => m.id);
      const value = clamp(pos.model, 0, Math.max(0, ids.length - 1));
      const a = Math.floor(value), b = Math.min(ids.length - 1, a + 1), p = value - a;
      const first = isScene(ids[a]) ? ids[a] as SceneName : 'haiku';
      const second = isScene(ids[b]) ? ids[b] as SceneName : first;
      journeyValue = value;
      const dt = t - previousFrameT;
      const speed = dt > 0 ? Math.max(Math.abs(value - previousValue), Math.abs(pos.level - previousLevel) / 5) / dt : Infinity;
      if (t === 0 || dt <= 0 || dt > WRITING.maxFrameGap || speed > WRITING.slowScroll) slowSince = t;
      readerSlow = t > 0 && dt > 0 && dt < WRITING.maxFrameGap && t - slowSince >= WRITING.settleSeconds;
      previousFrameT = t; previousValue = value; previousLevel = pos.level;
      audibleScene = p < 0.15 ? first : p > 0.85 ? second : undefined;
      if (t === 0) { soundQueue.length = 0; cueState.clear(); }
      const request = (name: SceneName) => {
        if (!pending.has(name)) void ensure(name).catch(error => console.warn(`[Claude] Art load failed for ${name}`, error));
      };
      request(first);
      if (p > 0) request(second);
      if (pos.active || p > 0) {
        const next = names[names.indexOf(first) + 1];
        if (next) request(next);
      }
      // Preload the neighbouring meadow even on a direct jump into night.
      if (first === 'mythos' || second === 'mythos' && p > 0) request('fable');
      // Keep the complete previous frame until all destination sprites exist.
      if (!scenes.has(first) || p > 0 && !scenes.has(second)
        || first === 'mythos' && !scenes.has('fable')) return;
      const firstHome = home(first), secondHome = home(second);
      deskPush = towerRig ? TOWER_READING_PUSH : 1;
      let camera = p === 0 ? firstHome : travel(firstHome, secondHome, p);
      const nightStart = ids.indexOf('mythos');
      const normalized = nightStart > 0 ? value / nightStart : 0;
      dusk = normalized * JOURNEY.earlyDusk + (1 - JOURNEY.earlyDusk)
        * ease((normalized - JOURNEY.duskStart) / (1 - JOURNEY.duskStart)) ** JOURNEY.duskPower;
      if (first === 'mythos') camera = between(home('fable'), nightCamera(),
        mix(JOURNEY.nightPullback, 1, ease(clamp(pos.level, 0, 2) / 2)));
      setCamera(camera);
      skyBackdrop.root.alpha = 1; skyBackdrop.root.visible = false;
      for (const layer of sceneLayers.values()) layer.visible = false;
      fallbackWeights.clear();
      for (const plate of plates.values()) plate.visible = false;
      for (const [name, scene] of scenes) {
        scene.root.visible = false;
        scene.root.position.set(regions[name].x, regions[name].y);
        scene.root.scale.set(regions[name].scale);
      }
      const offered = opts.models[a]?.efforts ?? [];
      const effort = (index: number) => clamp(['low', 'medium', 'high', 'xhigh', 'max'].indexOf(offered[index] ?? 'low') + 1, 1, 5);
      const lv = clamp(pos.level, 0, Math.max(0, offered.length - 1));
      const level = first === 'mythos' ? lv : mix(effort(Math.floor(lv)), effort(Math.ceil(lv)), ease(lv % 1));
      if (p === 0 && pos.active) remembered.set(first, level);
      let meadowAlpha = 0;
      const availability = (name: SceneName) => {
        if (t === 0) { readyAt.set(name, -Infinity); return 1; }
        return ease((t - (readyAt.get(name) ?? t)) / JOURNEY.loadFadeSeconds);
      };
      const transition = ease(p);
      const physical = p > 0 && t > 0 && !opts.reduced;
      inkBloomLayer = undefined;
      for (const [name, layer] of sceneLayers) {
        layer.position.set(0); layer.scale.set(1); layer.mask = null; layer.filters = [];
        layer.zIndex = names.indexOf(name) + 2;
      }
      const show = (name: SceneName, weight: number, buildLevel: number) => {
        if (weight <= 0) return;
        const layer = sceneLayers.get(name), scene = scenes.get(name);
        if (!layer || !scene) return;
        const ready = availability(name);
        layer.visible = ready > 0;
        fallbackWeights.set(name, weight * ready);
        layer.alpha = weight * ready;
        const plate = plates.get(name);
        if (plate) { fitPlate(name, plate); plate.visible = true; plate.alpha = 1; }
        if (name === 'haiku') {
          skyBackdrop.root.visible = true; fitBackdrop(skyBackdrop.sprite, skyBackdrop.root);
          placeSubject(scene.root);
        }
        if (name === 'sonnet' && !towerRig) placeSubject(scene.root);
        // Keep a scene's actors on its own plate throughout the dissolve.
        // In particular the meadow root must retain its flower registration.
        scene.root.visible = true;
        scene.root.alpha = name === 'haiku' ? 1 : name === 'sonnet' && !towerRig ? deskPush : 1;
        scene.draw(t, buildLevel);
        if (name === 'fable') meadowAlpha = weight * ready;
        if (name === 'sonnet' && !towerRig && plate) plate.alpha = 1 - scene.root.alpha;
      };
      const firstLevel = p === 0 ? (pos.active ? level : 1) : remembered.get(first) ?? 1;
      if (first === 'fable' && second === 'mythos' || first === 'mythos') {
        // The same meadow is painted into the distant night valley, with the
        // chrysalis already emerging during travel. There is no dusk cut.
        if (first === 'fable') show('fable', 1 - transition, firstLevel);
        const scene = scenes.get('mythos');
        if (scene) {
          scene.root.visible = true;
          scene.root.alpha = (first === 'mythos' ? 1 : transition) * availability('mythos');
          scene.root.position.set(clear.x, clear.y);
          scene.root.scale.set(1);
          scene.draw(t, first === 'mythos' ? level : 0);
        }
      } else if (physical && first === 'haiku' && second === 'sonnet') {
        show('haiku', 1, firstLevel); show('sonnet', 1, 1);
        pullThroughWindow(transition);
      } else if (physical && first === 'sonnet' && second === 'opus') {
        show('sonnet', 1, firstLevel); show('opus', 1, 1);
        bloomFromPage(transition);
      } else if (physical && first === 'opus' && second === 'fable') {
        show('opus', 1, firstLevel); show('fable', 1, 1);
        // Tilting up puts the meadow above the water: forward scroll lowers
        // the pond out of frame, and reversing retraces the exact same path.
        tiltToMeadow(transition);
      } else {
        show(first, p === 0 ? 1 : 1 - transition, firstLevel);
        if (p > 0) show(second, transition, 1);
      }
      animateTower(t, scenes.get('sonnet')?.root.visible ? scenes.get('sonnet')!.root.alpha : 0);
      if (plates.get('sonnet')?.visible || scenes.get('sonnet')?.root.visible) {
        cue('sonnet-fire', Math.floor(t / 18) * 2 + (t % 18 >= 7 ? 1 : 0), 'crackle', 'sonnet', t);
      }
      ambient?.draw(t, 1);
      if (ambient) ambient.root.alpha = 1 - ease((camera.zoom - 1.7) / 0.8) * 0.94;
      travellers?.draw(t, 1);
      // Keep a fully covering, continuous valley behind every soft mask.
      wide.alpha = 1;
      if (!physical) assertPlateCoverage(); // During a pan the two plates jointly cover the viewport.
      tint.alpha = dusk * JOURNEY.nightDarkness;
      moonlight.alpha = dusk * 0.045;
      if (sharedGrade) {
        const uniforms = sharedGrade.resources.paperUniforms.uniforms;
        uniforms.uTime = t; uniforms.uDusk = dusk;
        uniforms.uCamera[0] = camera.x / 1672; uniforms.uCamera[1] = camera.y / 941;
        uniforms.uViewport[0] = width; uniforms.uViewport[1] = height;
      }
      nightSky(t, meadowAlpha);
      // Filter areas are local to each layer in Pixi v8. Recompute after all
      // pulls/tilts so a transformed viewport rectangle never clips a mask.
      for (const layer of sceneLayers.values()) {
        const area = layer.filterArea!;
        area.x = (-stage.x / stage.scale.x - layer.x) / layer.scale.x;
        area.y = (-stage.y / stage.scale.y - layer.y) / layer.scale.y;
        area.width = width / stage.scale.x / layer.scale.x;
        area.height = height / stage.scale.y / layer.scale.y;
      }
      renderSafely();
    },
    cues() { return soundQueue.splice(0, 8); },
    destroy() {
      if (dead) return;
      dead = true;
      observer?.disconnect(); clearObserver?.disconnect();
      // Containers destroy their geometry, not cache-owned texture sources.
      if (initialized) app.destroy(true, { children: true, texture: false, textureSource: false });
      for (const effect of effects) effect.destroy();
      soundQueue.length = 0; cueState.clear();
      for (const slice of slices) slice.destroy(false);
      for (const texture of generated) texture.destroy(true);
      const loads = [...pending.values()], paths = [...loaded];
      assetCleanup = Promise.allSettled([assetCleanup, ...loads]).then(async () => {
        await Promise.allSettled(paths.map(path => Assets.unload(path)));
      });
      scenes.clear(); plates.clear(); backdrops.clear(); textures.clear(); pending.clear(); remembered.clear(); readyAt.clear();
      sceneLayers.clear(); bloomFilters.clear(); fallbackWeights.clear(); travellers = undefined; sharedGrade = undefined;
    },
  };
}
