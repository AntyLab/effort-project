import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { World, WorldOpts } from '../stage';
import type { StoryPosition } from '../story';

const ease = (x: number) => { x = THREE.MathUtils.clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const smoother = (x: number) => { x = THREE.MathUtils.clamp(x, 0, 1); return x * x * x * (x * (x * 6 - 15) + 10); };
// Visual controls are kept here so the frame review can tune one section at a time.
// Moon: relief in scene units, reflected-light gain (above the ACES toe), scattering blend,
// rotation in radians/second and libration amplitude/frequency. Companion size is
// relative apparent diameter; separation is in lunar radii. The full-Moon
// endpoint stays at phase 1; stronger bump and lower fill preserve its relief.
const MOON = { bump: .085, earthshine: .075, regolithMix: .35, spin: .003,
  earthSizeRatio: .25, earthSeparation: 1.4, maxPhase: 1,
  libration: .012, librationRate: .13 };
// Earth: glint gain/exponent, shadow strength/UV offset, atmosphere shell radius,
// scattering gain and the cosine-width of the night-light terminator. City
// thresholds reject Black Marble's blue land/ice pedestal before emission gain;
// aurora widths are in normalized polar latitude, with a dim upper red fringe.
const EARTH = { glint: 1.4, glintPower: 640, cloudShadow: .38, cloudOffset: .004,
  nightFloor: .00035, nightGain: 9, cityEffortGain: 3,
  cityCut: .004, cityFull: .035, cityBlueReject: .65,
  auroraLatitude: .88, auroraWidth: .018, auroraGain: .85, redFringe: .14,
  airRadius: 1.435, airStrength: .48, twilightWidth: .14 };
// Sun: spatial frequencies, cell warp/evolution, photosphere contrast/limb floor,
// spot size/depth, facula and rim gains, corona gains, spin and geometry budgets.
// Evolution is radians/second; corona extent is in solar radii, breathSize and
// breathGain are fractional modulation, limbFeather is the view-normal cosine.
const SUN = { granuleScale: 32, warp: .55, evolution: .95, contrast: .48,
  supergranuleContrast: .50, limbFloor: .44, limbFeather: .30,
  spotRadius: .036, spotDepth: .38, faculae: .08,
  chromosphere: .12, streamer: .12, coronaOpacity: .38, coronaActivity: .13,
  coronaExtent: 1.5, coronaWidthPerLevel: .18, breathRate: .9, breathSize: .035, breathGain: .13,
  rotation: .012, mobileStrands: 3, desktopStrands: 6,
  strandWidth: .085, ejectaCount: 600, ejectaSize: .42 };
// Galaxy: radii/pitch, particle budgets, rigid and differential radians/second,
// radial speed exponent, shear reset seconds, point size and diffuse-light gains.
const GALAXY = { radius: 70, solarRadius: 28, pitch: 1.65, count: 120000, streamCount: 500,
  patternSpeed: Math.PI * 2 / 35, orbitSpeed: .0075, orbitPower: .55, orbitReset: 16,
  pointScale: .24, pointMax: 2.4, discOpacity: .90, haloOpacity: .09,
  armWidth: .11, interarmFraction: .24, companionScale: .13,
  temperatureBias: .55, sizeFloor: .28, sizeRange: 1.7, hotSize: .10, edgeFadeStart: .72 };
// Register a logarithmic arm through the original Sun position, not an inter-arm gap.
const GALAXY_ARM_PHASE = Math.PI - Math.log1p(GALAXY.solarRadius) * GALAXY.pitch;
// Sky: particle budget/radius, band fraction/angular scatter, star and diffuse
// brightness and the number of unresolved background galaxies.
const BACKGROUND = { count: 4000, radius: 1500, bandFraction: .30, bandWidth: .09,
  brightness: .65, bandOpacity: .018, galaxyCount: 3 };
// Flight: settle/afterglow fractions; Moon fade is normalized departure distance,
// all other fade bounds use scene units; exposure is scene-linear.
const FLIGHT = { settle: .96, afterglow: .45, moonFadeNear: .15, moonFadeFar: .9,
  earthFadeNear: 18, earthFadeFar: 70, sunFadeNear: 65, sunFadeFar: 190,
  galaxyRevealNear: 32, galaxyRevealFar: 150, exposure: 1, solarExposure: .82 };
// Desktop bloom: world/Sun gain, spread and scene-linear highlight threshold.
const BLOOM = { strength: .22, solarStrength: .035, radius: .35, solarRadius: .16,
  threshold: 1.25, solarThreshold: 1.8 };
// Clear-rectangle insets are stage-local CSS pixels, including a real zero.
// Frame the bright solar halo and the full Terra orbit envelope, not just the spheres.
const FRAMING = { fill: .80, moonRadius: .72, earthRadius: 2.15, solarRadius: 6.3,
  mobileTop: 60, mobileBottom: 250, mobileRight: 60,
  desktopTop: 80, desktopBottom: 0, desktopRight: 80 };
const HANDOFF = { outgoingHold: .85, turnEnd: .42, panStart: .42, panEnd: .5 };
const levels = ['none', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const sphereVertex = `
  precision highp float;
  precision highp int;
  varying vec2 vUv;
  varying vec3 vWorld, vNormal, vLocal;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vUv = uv; vLocal = position;
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
    #include <logdepthbuf_vertex>
  }`;
const sphereFragment = `
  precision highp float;
  precision highp int;
  varying vec2 vUv;
  varying vec3 vWorld, vNormal, vLocal;
  #include <logdepthbuf_pars_fragment>
`;
const noise = `
  float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453); }
  float noise3(vec3 p) {
    vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),
      mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
      mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),
      mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
  }`;

export function create(): World {
  let opts: WorldOpts;
  let renderer: THREE.WebGLRenderer | undefined;
  let composer: EffectComposer | undefined;
  let bloom: UnrealBloomPass | undefined;
  let observer: ResizeObserver | undefined;
  let scene: THREE.Scene;
  let camera: THREE.PerspectiveCamera;
  let dead = false;
  let lastT = 0, lastPos: StoryPosition = {model:0,level:0,active:false};
  let width = 1, height = 1;
  let stage: HTMLElement;
  let clearTop = 0, clearHeight = 1, clearWidth = 1;
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const passes: { dispose(): void }[] = [];
  const geometry = <T extends THREE.BufferGeometry>(g: T): T => { geometries.add(g); return g; };
  const material = <T extends THREE.Material>(m: T): T => { materials.add(m); return m; };
  const shaderFallbacks = new Map<string, () => void>();
  let shaderRetry = false;
  // Three reports link errors on first use, including hidden effort features.
  // Retry the same frame with the old shader before presenting the canvas.
  function guardShader(m: THREE.Material, fallback: () => void): string {
    const tag = `OPENAI_GUARD_${m.id}`;
    shaderFallbacks.set(tag, () => {
      fallback(); m.needsUpdate = true; shaderFallbacks.delete(tag); shaderRetry = true;
    });
    return `\n#define ${tag}\n`;
  }
  function upgradeShader(m: THREE.ShaderMaterial, patch: { vertexShader?: string; fragmentShader?: string }): void {
    const vertex = m.vertexShader, fragment = m.fragmentShader;
    const marker = guardShader(m, () => { m.vertexShader = vertex; m.fragmentShader = fragment; });
    m.vertexShader = marker + (patch.vertexShader ?? vertex);
    m.fragmentShader = marker + (patch.fragmentShader ?? fragment);
  }
  const precision = 'precision highp float;\nprecision highp int;\n';
  const moonPosition = new THREE.Vector3(-1.6, 1.5, 3);
  const earthPosition = new THREE.Vector3(0, 0, 0);
  const sunPosition = new THREE.Vector3(-26, 4, -20);
  const galaxyPosition = sunPosition.clone().add(new THREE.Vector3(GALAXY.solarRadius, 0, 0));
  const lightPosition = sunPosition.clone();
  // dot(view, sun direction) = .2 => (1 + .2) / 2 = 60% illuminated disc.
  const sunDirection = sunPosition.clone().normalize();
  const earthView = new THREE.Vector3(sunDirection.z, 0, -sunDirection.x).normalize()
    .multiplyScalar(Math.sqrt(.96)).addScaledVector(sunDirection, .2);
  const moonView = new THREE.Vector3(sunPosition.z - moonPosition.z, 0, moonPosition.x - sunPosition.x).normalize();
  const moonAway = moonPosition.clone().sub(earthPosition).normalize();
  const moonSide = moonView.clone().addScaledVector(moonAway, -moonView.dot(moonAway)).normalize();
  const journeyKeys = [
    { id: 'luna', p: moonPosition.clone().addScaledVector(moonView, 4.3), target: moonPosition, fov: 40 },
    { id: 'terra', p: earthPosition.clone().addScaledVector(earthView, 6.4), target: earthPosition, fov: 42 },
    { id: 'sol', p: new THREE.Vector3(-26, 4, -5.5), target: sunPosition, fov: 43 },
    { id: 'astra', p: galaxyPosition.clone().add(new THREE.Vector3(0, 110, 190)), target: galaxyPosition, fov: 49 },
  ];
  // Centripetal splines pass through exactly the authored stop viewpoints.
  let flightPath: THREE.CatmullRomCurve3, targetPath: THREE.CatmullRomCurve3;
  const look = new THREE.Vector3(), direction = new THREE.Vector3(), phaseSide = new THREE.Vector3();
  const lunaViewpoint = new THREE.Vector3(), terraViewpoint = new THREE.Vector3();
  let moon: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  let earth: THREE.Group, solar: THREE.Group, galaxy: THREE.Group;
  let earthSurface: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  let cloud: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  let atmosphere: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  let sun: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  let corona: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  let eruption: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  let moonGlow: THREE.Sprite;
  let sunlight: THREE.PointLight;
  let starfield: THREE.Points;
  let galaxyMaterial: THREE.ShaderMaterial;
  let galaxyStars: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  let galaxyDisc: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> | undefined;
  let galaxyHalo: THREE.Sprite;
  let astraDistance = 220;
  let astraFitKey = '';
  let galaxyCore: THREE.Sprite;
  let streams: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  const companions: THREE.Group[] = [];
  const companionDiscs: THREE.ShaderMaterial[] = [];
  const satellites: { group: THREE.Group; point: THREE.ShaderMaterial; trails: THREE.Mesh<THREE.TubeGeometry, THREE.MeshBasicMaterial>[]; normal: THREE.Vector3 }[] = [];
  let station: THREE.Group, stationTrail: THREE.Group;
  let stationTrails: THREE.Mesh<THREE.TubeGeometry, THREE.MeshBasicMaterial>[];
  const flares: { mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>; onset: number }[] = [];
  const galaxyLevels = [
    { opacity: .90, arms: .70, core: .38, fraction: .35 },
    { opacity: .90, arms: .70, core: .38, fraction: .35 },
    { opacity: 1.05, arms: 1, core: .55, fraction: .55 },
    { opacity: 1.18, arms: 1.12, core: .70, fraction: .75 },
    { opacity: 1.30, arms: 1.30, core: .85, fraction: .90 },
    { opacity: 1.40, arms: 1.45, core: 1.05, fraction: 1 },
    { opacity: 1.40, arms: 1.45, core: 1.05, fraction: 1 },
  ];

  // Seeded sampling makes reduced-motion plates and fresh mounts reproducible.
  let seed = 9317;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const gaussian = () => Math.sqrt(-2 * Math.log(Math.max(1e-8, random()))) * Math.cos(2 * Math.PI * random());
  function flatTexture(rgb: number[], srgb = true): THREE.DataTexture {
    const texture = new THREE.DataTexture(new Uint8Array([...rgb, 255]), 1, 1);
    texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.needsUpdate = true; textures.add(texture); return texture;
  }
  function glowTexture(): THREE.DataTexture {
    const size = 64, bytes = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const r = Math.hypot((x + .5) / size * 2 - 1, (y + .5) / size * 2 - 1);
      const i = (y * size + x) * 4;
      bytes[i] = bytes[i + 1] = bytes[i + 2] = 255;
      bytes[i + 3] = Math.round(255 * Math.pow(Math.max(0, 1 - r), 3));
    }
    const texture = new THREE.DataTexture(bytes, size, size);
    texture.needsUpdate = true; textures.add(texture); return texture;
  }
  function sprite(map: THREE.Texture, color: number, size: number, opacity: number): THREE.Sprite {
    const s = new THREE.Sprite(material(new THREE.SpriteMaterial({ map, color, opacity,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
    s.scale.setScalar(size); return s;
  }
  function load(path: string, color: boolean, apply: (texture: THREE.Texture) => void): Promise<boolean> {
    return new Promise(resolve => {
      new THREE.TextureLoader().load(`/assets/space/${path}.webp`, texture => {
        if (dead) { texture.dispose(); resolve(false); return; }
        textures.add(texture);
        texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        // Equirectangular longitude must wrap, especially for drifting cloud shadows.
        texture.wrapS = THREE.RepeatWrapping;
        texture.anisotropy = Math.min(8, renderer?.capabilities.getMaxAnisotropy() ?? 1);
        apply(texture); resolve(true);
      }, undefined, () => resolve(false));
    });
  }
  function makeGalaxy(count: number): THREE.BufferGeometry {
    const positions = new Float32Array(count * 3), colors = new Float32Array(count * 3);
    const radii = new Float32Array(count), knots = new Float32Array(count), ranks = new Float32Array(count);
    const sizes = new Float32Array(count), populations = new Float32Array(count), cohorts = new Float32Array(count);
    const c = new THREE.Color();
    // Paired cohorts crossfade between bounded differential orbits. The pattern
    // keeps turning, but never accumulates enough shear to wind the arms into rings.
    for (let i = 0; i < count; i += 2) {
      const population = random();
      const bulge = population < .14, bar = population >= .14 && population < .22;
      const halo = population > .985;
      const interarm = !bulge && !bar && random() < GALAXY.interarmFraction;
      let r = Math.pow(random(), 1.15) * GALAXY.radius + .02;
      if (bulge) r = Math.pow(random(), 1.6) * 12;
      const arm = (i / 2) % 4;
      let theta = arm * Math.PI / 2 + Math.log(1 + r) * GALAXY.pitch + GALAXY_ARM_PHASE;
      if (bulge || halo || interarm) theta = random() * Math.PI * 2;
      const spread = .65 + r * GALAXY.armWidth;
      let x = Math.cos(theta) * r + gaussian() * spread;
      let z = Math.sin(theta) * r + gaussian() * spread;
      let y = THREE.MathUtils.clamp(gaussian(), -2.5, 2.5) * (halo ? 4 : .55 + 2.8 * Math.exp(-r / 9));
      const extent = Math.hypot(x, z);
      if (extent > GALAXY.radius) { x *= GALAXY.radius / extent; z *= GALAXY.radius / extent; }
      r = Math.hypot(x, z);
      if (bar) { x = gaussian() * 7; z = gaussian() * 1.4; r = Math.hypot(x, z); }
      // The physical Sun lands on this warm, ordinary arm star, locked to the pattern.
      if (i === 0) { x = -GALAXY.solarRadius; y = z = 0; r = GALAXY.solarRadius; }
      const rank = i === 0 ? 0 : random();
      const knot = !bulge && !bar && !halo && r > 12 && Math.sin(r * 1.35 + arm * 4) > .65 && random() > .5;
      const temperature = Math.pow(random(), GALAXY.temperatureBias);
      c.setRGB(1, .79, .54);
      if (!bulge && !bar) c.lerp(new THREE.Color(.63, .77, 1), temperature);
      const knotType = knot ? (random() < .4 ? 1 : .5) : 0;
      if (knotType === 1) c.setRGB(1, .25, .43);
      else if (knotType > 0) c.setRGB(.58, .79, 1.15);
      if (i === 0) c.setRGB(1, .88, .65);
      c.multiplyScalar(.028 + Math.pow(random(), 9) * .85);
      const size = GALAXY.sizeFloor + Math.pow(random(), 4) * GALAXY.sizeRange + temperature * GALAXY.hotSize;
      for (let j = i; j < Math.min(count, i + 2); j++) {
        positions.set([x, y, z], j * 3); c.toArray(colors, j * 3);
        radii[j] = r / GALAXY.radius; knots[j] = knotType; ranks[j] = rank;
        sizes[j] = size; cohorts[j] = j % 2;
        populations[j] = i === 0 ? 4 : halo ? 3 : bulge ? 1 : bar ? 2 : 0;
      }
    }
    const g = geometry(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setAttribute('aRadius', new THREE.BufferAttribute(radii, 1));
    g.setAttribute('aKnot', new THREE.BufferAttribute(knots, 1));
    g.setAttribute('aRank', new THREE.BufferAttribute(ranks, 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    g.setAttribute('aPopulation', new THREE.BufferAttribute(populations, 1));
    g.setAttribute('aCohort', new THREE.BufferAttribute(cohorts, 1));
    return g;
  }
  const orbitRight = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), earthView).normalize();
  const orbitUp = new THREE.Vector3().crossVectors(earthView, orbitRight).normalize();
  const orbitTilts = [-.65, -.1, .5, 1.1];
  function orbitPoint(out: THREE.Vector3, angle: number, index: number): THREE.Vector3 {
    const radius = 1.4 * (1.15 + index * .10), inclination = .38 + index * .16;
    const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius * Math.cos(inclination);
    const tilt = orbitTilts[index];
    // Camera-facing orbital basis: the near quarter arcs cross the daylight hemisphere.
    return out.copy(orbitRight).multiplyScalar(x * Math.cos(tilt) - y * Math.sin(tilt))
      .addScaledVector(orbitUp, x * Math.sin(tilt) + y * Math.cos(tilt))
      .addScaledVector(earthView, Math.sin(angle) * radius * Math.sin(inclination));
  }
  function orbitTrail(parent: THREE.Group, index: number, phase: number, depthOffset = 0): THREE.Mesh<THREE.TubeGeometry, THREE.MeshBasicMaterial>[] {
    const points: THREE.Vector3[] = [];
    for (let j = 0; j <= 24; j++) {
      points.push(orbitPoint(new THREE.Vector3(), phase - (1 - j / 24) * Math.PI / 4, index)
        .addScaledVector(earthView, depthOffset));
    }
    const curve = new THREE.CatmullRomCurve3(points);
    const trails: THREE.Mesh<THREE.TubeGeometry, THREE.MeshBasicMaterial>[] = [];
    for (let layer = 0; layer < 2; layer++) {
      const tube = geometry(new THREE.TubeGeometry(curve, opts.mobile ? 20 : 32, layer === 0 ? .014 : .0045, 4, false));
      const trail = new THREE.Mesh(tube, material(new THREE.MeshBasicMaterial({
        color: layer === 0 ? 0x365e80 : 0x7190ae, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })));
      parent.add(trail); trails.push(trail);
    }
    return trails;
  }

  function readClearRectangle(): void {
    const css = getComputedStyle(stage);
    const inset = (name: string, fallback: number) => {
      const raw = css.getPropertyValue(name).trim();
      const value = /^(?:\d+(?:\.\d+)?|\.\d+)(?:px)?$/.test(raw) ? Number.parseFloat(raw) : NaN;
      return Number.isFinite(value) ? Math.max(0, value) : fallback;
    };
    const top = inset('--clear-top', opts.mobile ? FRAMING.mobileTop : FRAMING.desktopTop);
    const bottom = inset('--clear-bottom', opts.mobile ? FRAMING.mobileBottom : FRAMING.desktopBottom);
    const right = inset('--clear-right', opts.mobile ? FRAMING.mobileRight : FRAMING.desktopRight);
    // Clamp transient measurements during header/caption relayout to a usable rectangle.
    clearTop = Math.min(height * .8, top);
    clearHeight = Math.max(height * .1, height - clearTop - bottom);
    clearWidth = Math.max(width * .1, width - right);
  }
  function sphereDistance(radius: number, fov: number): number {
    const halfAngle = Math.tan(THREE.MathUtils.degToRad(fov / 2))
      * FRAMING.fill * Math.min(clearWidth, clearHeight) / height;
    return radius * Math.sqrt(1 + 1 / (halfAngle * halfAngle));
  }
  function fitAstraCamera(): void {
    const fitKey = `${height}/${clearWidth}/${clearHeight}`;
    if (fitKey === astraFitKey) return;
    astraFitKey = fitKey;
    const tangent = Math.tan(THREE.MathUtils.degToRad(49 / 2));
    const halfX = tangent * FRAMING.fill * clearWidth / height;
    const halfY = tangent * FRAMING.fill * clearHeight / height;
    const view = new THREE.Vector3(0, 110, 190).normalize();
    const up = new THREE.Vector3(0, view.z, -view.y);
    // A rotational envelope keeps the faster arms inside the rail at every time.
    let distance = 1;
    const include = (p: THREE.Vector3, padding: number) => {
      const depth = p.dot(view) + padding;
      distance = Math.max(distance, depth + (Math.abs(p.x) + padding) / halfX,
        depth + (Math.abs(p.dot(up)) + padding) / halfY);
    };
    const point = new THREE.Vector3();
    for (let i = 0; i < 64; i++) {
      const angle = i / 64 * Math.PI * 2;
      include(point.set(Math.cos(angle) * GALAXY.radius, 0, Math.sin(angle) * GALAXY.radius), 3);
    }
    for (const companion of companions) include(companion.position, GALAXY.radius * GALAXY.companionScale);
    astraDistance = distance;
  }
  function stopDistance(id: string): number {
    const fov = journeyKeys.find(key => key.id === id)!.fov;
    return id === 'astra' ? astraDistance : sphereDistance(id === 'luna' ? FRAMING.moonRadius
      : id === 'terra' ? FRAMING.earthRadius : FRAMING.solarRadius, fov);
  }

  function frame(pos: StoryPosition, t: number): void {
    const u = pos.model;
    if (dead || !renderer || !composer) return;
    lastPos = pos; lastT = t;
    const m = opts.models[Math.round(u)];
    const selected = m.id;
    const level = THREE.MathUtils.clamp(pos.level, 0, Math.max(0, m.efforts.length - 1));
    const levelLo = Math.floor(level), levelHi = Math.min(m.efforts.length - 1, levelLo + 1);
    const namedLevel = (i: number) => Math.max(0, levels.indexOf(m.efforts[i]));
    const currentLevel = THREE.MathUtils.lerp(namedLevel(levelLo), namedLevel(levelHi), smoother(level - levelLo));
    const time = opts.reduced ? 0 : t;
    const effort = pos.active && Math.abs(u - Math.round(u)) < .000001;
    const ids = opts.models.map(m => m.id);
    const index = (id: string) => Math.max(0, ids.indexOf(id));
    const travel = THREE.MathUtils.clamp((u - index('sol')) / Math.max(1, index('astra') - index('sol')), 0, 1);
    // Distance fades are evaluated after the camera flight, never at a model boundary.
    let galMix = 0;
    earth.visible = true;
    solar.visible = true;
    galaxy.visible = true;
    readClearRectangle();
    fitAstraCamera();
    const frameX = clearWidth / (2 * width);
    const frameY = (clearTop + clearHeight / 2) / height;
    const activity = effort ? currentLevel : 0;
    const outgoing = opts.models[Math.floor(u)];
    const betweenModels = u - Math.floor(u) > .000001;
    const outgoingLevel = Math.max(0, levels.indexOf(outgoing.efforts.at(-1) ?? 'none'));
    const afterglow = betweenModels ? outgoingLevel * (1 - smoother((u - Math.floor(u)) / FLIGHT.afterglow)) : 0;
    const bodyActivity = (id: string) => effort && selected === id ? activity : outgoing.id === id ? afterglow : 0;
    const lunarActivity = bodyActivity('luna'), earthActivity = bodyActivity('terra'), solarActivity = bodyActivity('sol');
    const lunarEffort = effort && selected === 'luna';
    const earthEffort = (effort && selected === 'terra') || (betweenModels && outgoing.id === 'terra');
    // Preserve a small, physically separate Earth behind the close Moon. Its
    // scale returns smoothly before Terra; camera offsets do all screen framing.
    const lunaKey = journeyKeys.find(key => key.id === 'luna')!;
    const lunaDistance = stopDistance('luna');
    // Keep the companion centre 1.4 lunar radii away in projection as the
    // responsive fit changes viewing distance. Both bodies remain in place.
    const lunarTangent = MOON.earthSeparation * FRAMING.moonRadius / lunaDistance;
    const lunarAngle = Math.atan(lunarTangent) + Math.asin(
      MOON.earthSeparation * FRAMING.moonRadius / moonPosition.distanceTo(earthPosition)
      / Math.sqrt(1 + lunarTangent * lunarTangent));
    direction.copy(moonAway).multiplyScalar(Math.cos(lunarAngle)).addScaledVector(moonSide, Math.sin(lunarAngle));
    lunaKey.p.copy(moonPosition).addScaledVector(direction, 4.3);
    const lunaCamera = direction.copy(lunaKey.p).sub(lunaKey.target).normalize()
      .multiplyScalar(stopDistance('luna')).add(lunaKey.target);
    const earthAtLuna = MOON.earthSizeRatio * FRAMING.moonRadius / 1.4
      * lunaCamera.distanceTo(earthPosition) / stopDistance('luna');
    earth.scale.setScalar(THREE.MathUtils.lerp(earthAtLuna, 1, smoother(u - index('luna'))));
    moon.scale.setScalar(THREE.MathUtils.lerp(1, .44, ease(u - index('luna'))));
    moon.rotation.y = .3 + time * MOON.spin + MOON.libration * Math.sin(time * MOON.librationRate);
    moon.rotation.z = MOON.libration * Math.sin(time * MOON.librationRate * .7);
    // Earth turns and its clouds drift a little faster, so the planet is never a still photo at rest.
    earthSurface.rotation.y = .7 + time * .012;
    cloud.rotation.y = .7 + time * .017;
    sun.rotation.y = time * SUN.rotation;
    // Camera distance, rather than shrinking the hero, fits the solar envelope.
    solar.scale.setScalar(THREE.MathUtils.lerp(1, .045, smoother((travel - .6) / .35)));
    let terraSolMix = -1;
    {
      const keys = journeyKeys;
      const a = keys.filter(k => index(k.id) <= u).at(-1) ?? keys[0];
      const b = keys.find(k => index(k.id) > u) ?? a;
      const progress = a === b ? 0 : THREE.MathUtils.clamp((u - index(a.id)) / Math.max(1, index(b.id) - index(a.id)), 0, 1);
      // One geometric flight with zero velocity at caption stops. No FOV kick or
      // exponential rush at the galaxy handoff; all endpoints remain unchanged.
      const mix = smoother(progress / FLIGHT.settle);
      const segment = keys.indexOf(a);
      const coordinate = (segment + (a === b ? 0 : mix)) / (keys.length - 1);
      flightPath.getPoint(coordinate, camera.position);
      targetPath.getPoint(coordinate, look);
      camera.fov = THREE.MathUtils.lerp(a.fov, b.fov, mix);
      const distance = THREE.MathUtils.lerp(stopDistance(a.id), stopDistance(b.id), mix);
      direction.copy(camera.position).sub(look).normalize();
      if (a.id === 'terra' && b.id === 'sol') {
        terraSolMix = mix;
        // Turn around the foreground before widening the frame. The offset
        // from the Earth/Sun axis keeps both silhouettes readable in overlap.
        const turn = smoother(mix / HANDOFF.turnEnd);
        const pan = smoother((mix - HANDOFF.panStart) / (HANDOFF.panEnd - HANDOFF.panStart));
        look.copy(earthPosition).lerp(sunPosition, pan);
        phaseSide.copy(earthView).addScaledVector(sunDirection, -earthView.dot(sunDirection)).normalize();
        const bridgeView = earthPosition.clone().sub(sunPosition).normalize().addScaledVector(phaseSide, .1).normalize();
        direction.copy(a.p).sub(a.target).normalize().lerp(bridgeView, turn).normalize();
        direction.lerp(phaseSide.copy(b.p).sub(b.target).normalize(),
          smoother((mix - .7) / .3)).normalize();
        camera.position.copy(look).add(direction);
        camera.lookAt(look); camera.updateMatrixWorld();
        const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
        const halfX = tangent * FRAMING.fill * clearWidth / height;
        const halfY = tangent * FRAMING.fill * clearHeight / height;
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
        const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
        const fit = (center: THREE.Vector3, radius: number) => {
          const delta = phaseSide.copy(center).sub(look);
          return delta.dot(direction) + radius + Math.max(
            (Math.abs(delta.dot(right)) + radius) / halfX,
            (Math.abs(delta.dot(up)) + radius) / halfY);
        };
        const incoming = smoother((mix - .36) / .14);
        const outgoing = 1 - smoother((mix - .62) / .25);
        const bridgeDistance = Math.max(THREE.MathUtils.lerp(stopDistance(a.id), stopDistance(b.id), smoother((mix - .42) / .58)),
          fit(earthPosition, 1.45) * outgoing, fit(sunPosition, 3.8) * incoming);
        // Once the gaze reaches the Sun, release the pair fit into a readable
        // solar disc. Merely fitting both centres can leave two edge specks.
        const solarHalfAngle = tangent * .30 * clearWidth / height;
        const solarLimit = Math.max(stopDistance(b.id),
          3.8 * Math.sqrt(1 + 1 / (solarHalfAngle * solarHalfAngle)));
        camera.position.copy(look).addScaledVector(direction, THREE.MathUtils.lerp(bridgeDistance,
          Math.min(bridgeDistance, solarLimit), smoother((mix - .48) / .02)));
      } else camera.position.copy(look).addScaledVector(direction, distance);
    }
    camera.lookAt(look);
    const lunarRoll = 1 - smoother(u - index('luna'));
    if (lunarRoll > 0) {
      // The companion follows the clear rectangle's diagonal: wide screens
      // use spare horizontal room, while portrait keeps the original diagonal.
      camera.updateMatrixWorld();
      const delta = phaseSide.copy(earthPosition).sub(moonPosition);
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      const companionAngle = Math.atan2(clearHeight, -clearWidth);
      camera.rotateZ((companionAngle - Math.atan2(-delta.dot(up), delta.dot(right))) * lunarRoll);
    }
    camera.setViewOffset(width, height, -width * (frameX - .5), height * (.5 - frameY), width, height);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const fadeDistance = (body: THREE.Vector3, near: number, far: number) =>
      1 - smoother((camera.position.distanceTo(body) - near) / (far - near));
    // Moon remains in the opening plate but fades before it can cross Terra's disc.
    const fittedView = (id: string, out: THREE.Vector3) => {
      const key = journeyKeys.find(k => k.id === id)!;
      return out.copy(key.p).sub(key.target).normalize().multiplyScalar(stopDistance(id)).add(key.target);
    };
    fittedView('luna', lunaViewpoint); fittedView('terra', terraViewpoint);
    const departure = camera.position.distanceTo(lunaViewpoint) / Math.max(.01, lunaViewpoint.distanceTo(terraViewpoint));
    moon.material.opacity = 1 - smoother((departure - FLIGHT.moonFadeNear) / (FLIGHT.moonFadeFar - FLIGHT.moonFadeNear));
    moon.visible = moon.material.opacity > 0;
    moon.material.depthWrite = moon.material.opacity === 1;
    const earthOpacity = u >= index('sol') ? 0 : terraSolMix >= 0
      ? 1 - smoother((terraSolMix - HANDOFF.outgoingHold) / (1 - HANDOFF.outgoingHold))
      : fadeDistance(earthPosition, FLIGHT.earthFadeNear, FLIGHT.earthFadeFar);
    earthSurface.material.uniforms.uOpacity.value = earthOpacity;
    earthSurface.material.depthWrite = earthOpacity === 1;
    earth.visible = earthOpacity > 0;
    cloud.material.opacity = .82 * earthOpacity;
    atmosphere.material.uniforms.uOpacity.value = earthOpacity;
    const solarDistance = camera.position.distanceTo(sunPosition);
    const sunOpacity = 1 - smoother((solarDistance - FLIGHT.sunFadeNear) / (FLIGHT.sunFadeFar - FLIGHT.sunFadeNear));
    sun.material.uniforms.uOpacity.value = sunOpacity;
    sun.material.depthWrite = false;
    solar.visible = sunOpacity > 0;
    galMix = smoother((solarDistance - FLIGHT.galaxyRevealNear) / (FLIGHT.galaxyRevealFar - FLIGHT.galaxyRevealNear))
      * smoother(travel / .35);
    // The wide-screen Sun falls below a quarter-width before the old distance
    // fade reveals Astra. Establish its surrounding disc during that overlap.
    galMix = Math.max(galMix, .3 * smoother(travel / .25));
    galaxy.visible = galMix > 0;
    // A rigid-pattern arm star is the registration point for the shrinking Sun.
    const orbitAngle = time * GALAXY.patternSpeed;
    solar.position.copy(sunPosition);
    solar.position.x += GALAXY.solarRadius * (1 - Math.cos(orbitAngle)) * galMix;
    solar.position.z -= GALAXY.solarRadius * Math.sin(orbitAngle) * galMix;
    lightPosition.copy(sunPosition);
    if (lunarEffort || (betweenModels && outgoing.id === 'luna' && afterglow > 0)) {
      // Light moves around the real sphere: crescent to full, without a screen-space mask.
      // Keep the same phase build relative to the journey camera instead of the removed close-up.
      const angles = [.18, .34, .515, .68, .84, MOON.maxPhase, MOON.maxPhase].map(fraction => Math.acos(2 * fraction - 1));
      const phaseLevel = lunarEffort ? lunarActivity : outgoingLevel;
      const lo = Math.floor(phaseLevel), hi = Math.min(6, lo + 1);
      const phase = THREE.MathUtils.lerp(angles[lo], angles[hi], phaseLevel - lo);
      direction.copy(camera.position).sub(moonPosition).normalize();
      phaseSide.crossVectors(camera.up, direction).normalize();
      lightPosition.copy(moonPosition).addScaledVector(direction, Math.cos(phase) * 25)
        .addScaledVector(phaseSide, Math.sin(phase) * 25);
      if (!lunarEffort) lightPosition.lerp(sunPosition, 1 - afterglow / Math.max(1, outgoingLevel));
    }
    sunlight.position.copy(lightPosition);
    earthSurface.material.uniforms.uSun.value.copy(lightPosition);
    earthSurface.material.uniforms.uSurfaceRotation.value = earthSurface.rotation.y;
    earthSurface.material.uniforms.uCloudDrift.value = cloud.rotation.y - earthSurface.rotation.y;
    earthSurface.material.uniforms.uCities.value = earthEffort ? 1 + smoother(earthActivity - 2) * EARTH.cityEffortGain : 1;
    atmosphere.material.uniforms.uAurora.value = earthEffort ? ease(earthActivity - 4) : 0;
    atmosphere.material.uniforms.uTime.value = time;
    sun.material.uniforms.uTime.value = time;
    sun.material.uniforms.uActivity.value = solarActivity / 5;
    const solarFocus = effort ? (selected === 'sol' ? 1 : 0) : 1 - ease(Math.abs(u - index('sol')));
    if (bloom) {
      bloom.strength = THREE.MathUtils.lerp(BLOOM.strength, BLOOM.solarStrength, solarFocus);
      bloom.radius = THREE.MathUtils.lerp(BLOOM.radius, BLOOM.solarRadius, solarFocus);
      bloom.threshold = THREE.MathUtils.lerp(BLOOM.threshold, BLOOM.solarThreshold, solarFocus);
    }
    renderer.toneMappingExposure = THREE.MathUtils.lerp(FLIGHT.exposure, FLIGHT.solarExposure, solarFocus);
    const breath = Math.sin(time * SUN.breathRate);
    // A broad, warm leading edge announces the Sun while Earth is still large.
    // The pulse vanishes at both stops, including their reduced-motion plates.
    const approach = terraSolMix < 0 ? 0 : smoother((terraSolMix - .08) / .2)
      * (1 - smoother((terraSolMix - .5) / .3));
    const coronaExtent = (SUN.coronaExtent + solarActivity * SUN.coronaWidthPerLevel + approach * 3)
      * (1 + breath * SUN.breathSize);
    corona.material.uniforms.uInner.value = 1 / coronaExtent;
    corona.material.uniforms.uApproach.value = approach;
    corona.material.uniforms.uOpacity.value = (SUN.coronaOpacity + solarActivity * SUN.coronaActivity) * (1 + breath * SUN.breathGain) * sunOpacity;
    corona.material.uniforms.uTime.value = time;
    // A sphere's perspective silhouette is wider than its equatorial plane.
    // Register the thin chromosphere to that silhouette rather than hide it
    // behind the photosphere (especially at the close arrival stop).
    const coronaDistance = camera.position.distanceTo(solar.position);
    const solarRadius = 3.8 * solar.scale.x;
    const coronaProjection = coronaDistance / Math.sqrt(Math.max(.01, coronaDistance * coronaDistance - solarRadius * solarRadius));
    corona.scale.setScalar(7.6 * coronaExtent * coronaProjection);
    corona.quaternion.copy(camera.quaternion);
    eruption.visible = solar.visible && solarActivity > 4;
    eruption.material.opacity = smoother(solarActivity - 4) * .40 * sunOpacity;
    eruption.quaternion.copy(camera.quaternion);
    eruption.rotateZ(Math.sin(time * .4) * .06);
    eruption.scale.setScalar(1 + .025 * Math.sin(time * .6));
    moonGlow.visible = lunarEffort || (betweenModels && outgoing.id === 'luna');
    moonGlow.scale.setScalar(2.0);
    moonGlow.material.opacity = ease(lunarActivity - 4) * .22 * moon.material.opacity;
    for (const { mesh, onset } of flares) {
      const visibility = ease(solarActivity - onset) * sunOpacity;
      mesh.visible = solar.visible && visibility > .001;
      mesh.material.uniforms.uOpacity.value = visibility;
      mesh.material.uniforms.uTime.value = time;
      mesh.material.uniforms.uActivity.value = solarActivity / 5;
      mesh.quaternion.copy(camera.quaternion);
    }
    const pixelRatio = renderer.getPixelRatio();
    satellites.forEach((s, i) => {
      const opacity = earthEffort ? smoother(earthActivity - i) * earthOpacity : 0;
      s.group.visible = opacity > 0;
      s.group.quaternion.setFromAxisAngle(s.normal, .025 * Math.sin(time * (.3 - i * .025)));
      // Keep the phone-sized core, but cap its size on wide presentation stages.
      s.point.uniforms.uSize.value = Math.min(width * .024, height * .03) * pixelRatio;
      s.point.uniforms.uOpacity.value = opacity;
      s.trails.forEach((trail, layer) => { trail.material.opacity = opacity * (layer === 0 ? .08 : .28); });
    });
    const stationBuild = earthEffort ? smoother(earthActivity - 4) * earthOpacity : 0;
    station.visible = stationTrail.visible = stationBuild > 0;
    orbitPoint(station.position, 1.35, 0).addScaledVector(earthView, .18);
    // The station's 0.70-unit wing span projects to about 2.5% of stage width.
    direction.copy(station.position).multiplyScalar(earth.scale.x).add(earth.position).applyMatrix4(camera.matrixWorldInverse);
    const stationSpan = .025 * width / height * 2 * Math.max(.1, -direction.z)
      * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    station.scale.setScalar(stationBuild * stationSpan / (.70 * earth.scale.x));
    station.quaternion.copy(camera.quaternion);
    station.rotateX(.22); station.rotateY(-.25); station.rotateZ(.12 + .012 * Math.sin(time * .25));
    stationTrails.forEach((trail, layer) => { trail.material.opacity = stationBuild * (layer === 0 ? .08 : .28); });
    // XZ disc with the authored tilted viewpoint; no roll, so its polar axis reads vertically.
    galaxy.rotation.set(0, 0, 0);
    galaxyMaterial.uniforms.uTime.value = time;
    const astraEffort = effort && selected === 'astra';
    const astraLevel = astraEffort ? activity : 1;
    const ultra = astraEffort ? smoother(astraLevel - 5) : 0;
    const lo = Math.min(6, Math.floor(astraLevel)), hi = Math.min(6, lo + 1);
    const levelMix = ease(astraLevel - lo);
    const galaxyValue = (key: keyof typeof galaxyLevels[number]) =>
      THREE.MathUtils.lerp(galaxyLevels[lo][key], galaxyLevels[hi][key], levelMix);
    galaxyMaterial.uniforms.uOpacity.value = galMix * galaxyValue('opacity');
    galaxyMaterial.uniforms.uArms.value = galaxyValue('arms');
    galaxyMaterial.uniforms.uFraction.value = galaxyValue('fraction');
    galaxyMaterial.uniforms.uKnots.value = smoother(astraLevel - 2);
    galaxyMaterial.uniforms.uDust.value = smoother(astraLevel - 3);
    galaxyMaterial.uniforms.uLaneContrast.value = smoother(astraLevel - 3);
    galaxyMaterial.uniforms.uKnotBoost.value = 1 + smoother(astraLevel - 2) * 1.2;
    if (galaxyDisc) {
      galaxyDisc.material.uniforms.uTime.value = time;
      galaxyDisc.material.uniforms.uOpacity.value = galMix * GALAXY.discOpacity * galaxyValue('arms');
      galaxyDisc.material.uniforms.uDust.value = .55 + .45 * smoother(astraLevel - 3);
      galaxyDisc.material.uniforms.uKnots.value = .25 + .75 * smoother(astraLevel - 2);
    }
    galaxyHalo.material.opacity = galMix * GALAXY.haloOpacity;
    galaxyCore.material.opacity = galMix * galaxyValue('core') * .4;
    companions.forEach(g => { g.visible = ultra > .001; g.scale.setScalar(GALAXY.companionScale * ultra); });
    companionDiscs.forEach(m => {
      m.uniforms.uTime.value = time;
      m.uniforms.uOpacity.value = galMix * ultra * GALAXY.discOpacity * .48;
      m.uniforms.uDust.value = .65;
      m.uniforms.uKnots.value = .35;
    });
    streams.visible = ultra > .001; streams.material.opacity = galMix * ultra * .12;
    // Levels reveal the same galaxy; neither its extent nor the camera changes.
    galaxy.scale.setScalar(1);
    starfield.position.copy(camera.position);
    // If an upgraded program fails to link, restore its prior shader and redraw
    // synchronously. Shader diagnostics are checked only by Three on first use.
    do { shaderRetry = false; composer.render(); } while (shaderRetry);
  }

  return {
    async mount(el, options) {
      opts = options;
      stage = el.closest<HTMLElement>('#stage') ?? document.getElementById('stage') ?? el;
      journeyKeys.sort((a, b) => opts.models.findIndex(m => m.id === a.id) - opts.models.findIndex(m => m.id === b.id));
      flightPath = new THREE.CatmullRomCurve3(journeyKeys.map(k => k.p), false, 'centripetal');
      targetPath = new THREE.CatmullRomCurve3(journeyKeys.map(k => k.target), false, 'centripetal');
      scene = new THREE.Scene(); scene.background = new THREE.Color(0x010208);
      camera = new THREE.PerspectiveCamera(42, 1, .05, 4000);
      renderer = new THREE.WebGLRenderer({ antialias: !opts.mobile, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
      renderer.debug.onShaderError = (gl, _program, vertex, fragment) => {
        const source = (gl.getShaderSource(vertex) ?? '') + (gl.getShaderSource(fragment) ?? '');
        let restored = false;
        for (const [tag, fallback] of shaderFallbacks) {
          if (source.includes(`#define ${tag}\n`)) { fallback(); restored = true; }
        }
        console.warn('[guide] OpenAI shader link failed' + (restored ? '; restored previous material' : ''),
          gl.getShaderInfoLog(vertex), gl.getShaderInfoLog(fragment));
      };
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1;
      renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;position:absolute;inset:0';
      el.appendChild(renderer.domElement);
      composer = new EffectComposer(renderer);
      const render = new RenderPass(scene, camera), output = new OutputPass();
      bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
      composer.addPass(render);
      // Bloom performs five blur mip passes: skip them entirely on the phone tier.
      if (!opts.mobile) composer.addPass(bloom);
      composer.addPass(output);
      passes.push(render, bloom, output);
      const segments = opts.mobile ? 48 : 80;
      const sphere = geometry(new THREE.SphereGeometry(1, segments, segments / 2));
      const glow = glowTexture();
      sunlight = new THREE.PointLight(0xfff4df, 1700, 0, 0); sunlight.position.copy(sunPosition); scene.add(sunlight);
      // Decay zero keeps the deliberately compressed astronomical distances coherent.
      sunlight.intensity = 2.8;
      // No ambient fill: the Moon's only dark-side source is directional earthshine.
      moon = new THREE.Mesh(sphere, material(new THREE.MeshStandardMaterial({
        map: flatTexture([152, 149, 143]), transparent: true, roughness: .98, bumpScale: .018, color: 0xc9c7c1,
        emissive: 0x7c8ca8, emissiveIntensity: .28,
      })));
      // A little reflected Earth light preserves crater detail on the unlit hemisphere.
      moon.material.onBeforeCompile = shader => {
        shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `
          #include <emissivemap_fragment>
          float moonRim=pow(1.0-max(dot(normalize(vNormal),normalize(vViewPosition)),0.0),3.0);
          totalEmissiveRadiance*=diffuseColor.rgb*(.5+moonRim);
        `);
      };
      const originalMoonCompile = moon.material.onBeforeCompile;
      const moonMarker = guardShader(moon.material, () => {
        moon.material.onBeforeCompile = originalMoonCompile;
        moon.material.customProgramCacheKey = () => 'openai-moon-original';
      });
      moon.material.bumpScale = MOON.bump;
      moon.material.emissiveIntensity = MOON.earthshine;
      moon.material.onBeforeCompile = shader => {
        shader.vertexShader = precision + moonMarker + shader.vertexShader;
        shader.fragmentShader = precision + moonMarker + shader.fragmentShader;
        // Mixed Lommel-Seeliger/Lambert particulate scattering uses the perturbed
        // bump normal, so small crater slopes still catch the grazing sunlight.
        const physical = THREE.ShaderChunk.lights_physical_pars_fragment.replace(
          'reflectedLight.directDiffuse += irradiance * diffuseBRDF * ( 1.0 - F );',
          `float regolith = mix(1.0, 2.0 / max(.20, dotNL + max(dot(geometryNormal, geometryViewDir), 0.0)), ${MOON.regolithMix});
           reflectedLight.directDiffuse += irradiance * diffuseBRDF * ( 1.0 - F ) * regolith;`);
        shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_pars_fragment>', physical)
          .replace('#include <emissivemap_fragment>', `
            #include <emissivemap_fragment>
            vec3 earthDirection = normalize((viewMatrix * vec4(0.0,0.0,0.0,1.0)).xyz + vViewPosition);
            totalEmissiveRadiance *= diffuseColor.rgb * (.12 + .88 * pow(max(dot(normal, earthDirection), 0.0), .65));
          `);
      };
      moon.material.customProgramCacheKey = () => 'openai-moon-regolith-v2';
      moon.position.copy(moonPosition);
      // Radius belongs to the geometry so scale remains available for the distant Moon.
      moon.geometry = geometry(new THREE.SphereGeometry(.72, segments, segments / 2));
      scene.add(moon);
      moonGlow = sprite(glow, 0xb9cdff, 2.8, 0); moonGlow.position.copy(moonPosition); scene.add(moonGlow);
      earth = new THREE.Group(); earth.position.copy(earthPosition); scene.add(earth);
      const earthMaterial = material(new THREE.ShaderMaterial({
        uniforms: { uDay: { value: flatTexture([17, 55, 103]) }, uNight: { value: flatTexture([0, 0, 0]) },
          uHasDay: { value: 0 }, uSun: { value: lightPosition.clone() }, uCities: { value: 1 } },
        vertexShader: sphereVertex,
        fragmentShader: sphereFragment + noise + `
          uniform sampler2D uDay, uNight;
          uniform vec3 uSun;
          uniform float uCities, uHasDay;
          void main() {
            #include <logdepthbuf_fragment>
            vec3 n = normalize(vNormal), l = normalize(uSun-vWorld), v = normalize(cameraPosition-vWorld);
            vec3 day = texture2D(uDay,vUv).rgb;
            if (uHasDay < .5) {
              float land = smoothstep(.51,.57,noise3(normalize(vLocal)*5.0));
              day = mix(vec3(.012,.045,.12),vec3(.11,.17,.07),land);
            }
            float nl = dot(n,l), lit = smoothstep(-.12,.16,nl);
            float ocean = (1.0-smoothstep(.16,.4,max(day.r,day.g))) * smoothstep(.0,.05,day.b-day.r);
            float spec = pow(max(dot(reflect(-l,n),v),0.0),320.0)*ocean*max(nl,0.0);
            vec3 cityMap=texture2D(uNight,vUv).rgb;
            float cityMask=smoothstep(${EARTH.cityCut},${EARTH.cityFull},min(cityMap.r,cityMap.g)-cityMap.b*${EARTH.cityBlueReject});
            vec3 night=cityMap*cityMask*uCities*${EARTH.nightGain.toFixed(1)};
            vec3 col = day*(${EARTH.nightFloor}+max(nl,0.0)*1.25)+night*(1.0-lit)+vec3(1.0,.88,.65)*spec*1.8;
            gl_FragColor=vec4(col,1.0);
          }`,
      }));
      Object.assign(earthMaterial.uniforms, {
        uClouds: { value: flatTexture([0, 0, 0], false) }, uCloudDrift: { value: 0 }, uSurfaceRotation: { value: .7 }, uOpacity: { value: 1 },
      });
      upgradeShader(earthMaterial, { fragmentShader: sphereFragment + noise + `
        uniform sampler2D uDay,uNight,uClouds;
        uniform vec3 uSun;
        uniform float uCities,uHasDay,uCloudDrift,uSurfaceRotation,uOpacity;
        void main() {
          #include <logdepthbuf_fragment>
          vec3 n=normalize(vNormal), l=normalize(uSun-vWorld), v=normalize(cameraPosition-vWorld);
          // Color maps are tagged sRGB at load and decoded by Three's texture upload;
          // cloud coverage is linear data. All lighting here remains scene-linear.
          vec3 day=texture2D(uDay,vUv).rgb;
          if(uHasDay<.5) {
            float land=smoothstep(.51,.57,noise3(normalize(vLocal)*5.0));
            day=mix(vec3(.012,.045,.12),vec3(.11,.17,.07),land);
          }
          float nl=dot(n,l), lit=smoothstep(-${EARTH.twilightWidth},${EARTH.twilightWidth},nl);
          // Work in the rotating surface's tangent frame. Ray-to-cloud displacement
          // offsets the shadow towards the Sun rather than painting grey on the cloud.
          vec3 local=normalize(vLocal);
          vec3 tangent=normalize(vec3(-local.z,0.0,local.x)+vec3(.00001,0.0,0.0));
          vec3 worldT=normalize(vec3(cos(uSurfaceRotation)*tangent.x+sin(uSurfaceRotation)*tangent.z,tangent.y,
            -sin(uSurfaceRotation)*tangent.x+cos(uSurfaceRotation)*tangent.z));
          vec2 cloudUv=vUv+vec2(-uCloudDrift/6.2831853,0.0);
          vec2 shadowOffset=-vec2(dot(l,worldT),dot(l,normalize(cross(n,worldT))))
            *${EARTH.cloudOffset}/max(.25,abs(nl));
          float coverage=texture2D(uClouds,cloudUv+shadowOffset).g;
          float shadow=1.0-${EARTH.cloudShadow}*coverage*lit;
          float ocean=(1.0-smoothstep(.16,.4,max(day.r,day.g)))*smoothstep(0.0,.05,day.b-day.r);
          float fresnel=.02+.98*pow(1.0-max(dot(n,v),0.0),5.0);
          float glint=pow(max(dot(n,normalize(l+v)),0.0),${EARTH.glintPower.toFixed(1)})
            *ocean*max(nl,0.0)*(1.0-coverage)*(.3+fresnel);
          // Black Marble contains blue land/ice as well as lights. Reject the
          // blue pedestal before applying gain so the night stays nearly black.
          vec3 cityMap=texture2D(uNight,vUv).rgb;
          float cityMask=smoothstep(${EARTH.cityCut},${EARTH.cityFull},min(cityMap.r,cityMap.g)-cityMap.b*${EARTH.cityBlueReject});
          vec3 night=cityMap*cityMask*uCities*${EARTH.nightGain.toFixed(1)};
          vec3 col=day*(${EARTH.nightFloor}+max(nl,0.0)*1.25)*shadow
            +night*(1.0-lit)*(1.0-coverage*.65)
            +vec3(1.0,.91,.76)*glint*${EARTH.glint};
          gl_FragColor=vec4(col,uOpacity);
        }` });
      earthMaterial.transparent = true;
      earthSurface = new THREE.Mesh(sphere, earthMaterial); earthSurface.scale.setScalar(1.4); earth.add(earthSurface);
      cloud = new THREE.Mesh(sphere, material(new THREE.MeshStandardMaterial({
        color: 0xffffff, alphaMap: flatTexture([0, 0, 0], false), transparent: true, opacity: .82, depthWrite: false, roughness: 1,
      })));
      cloud.scale.setScalar(1.418); earth.add(cloud);
      atmosphere = new THREE.Mesh(sphere, material(new THREE.ShaderMaterial({
        uniforms: { uSun: { value: lightPosition }, uAurora: { value: 0 }, uTime: { value: 0 } },
        vertexShader: sphereVertex,
        fragmentShader: sphereFragment + `
          uniform vec3 uSun;
          uniform float uAurora,uTime,uOpacity;
          void main() {
            #include <logdepthbuf_fragment>
            vec3 n=normalize(vNormal), v=normalize(cameraPosition-vWorld);
            float rim=pow(1.0-abs(dot(n,v)),3.4);
            float lighting=.2+.8*max(dot(n,normalize(uSun-vWorld)),0.0);
            float latitude=abs(normalize(vLocal).y);
            float band=exp(-pow((latitude-${EARTH.auroraLatitude})/${EARTH.auroraWidth},2.0));
            float curtain=.65+.35*sin(vUv.x*110.0+sin(vUv.x*37.0+uTime*.5)*3.0+uTime*.7);
            vec3 aurora=vec3(.06,.75,.19);
            gl_FragColor=vec4(vec3(.08,.38,1.0)*rim*lighting*.72+aurora*band*curtain*uAurora*${EARTH.auroraGain},1.0);
          }`, transparent: true, blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false,
      })));
      atmosphere.material.uniforms.uOpacity = { value: 1 };
      upgradeShader(atmosphere.material, { fragmentShader: sphereFragment + `
        uniform vec3 uSun;
        uniform float uAurora,uTime,uOpacity;
        void main() {
          #include <logdepthbuf_fragment>
          vec3 n=normalize(vNormal), v=normalize(cameraPosition-vWorld);
          float nl=dot(n,normalize(uSun-vWorld));
          float rim=pow(1.0-abs(dot(n,v)),4.2);
          float daylight=smoothstep(-.22,.25,nl);
          float dusk=exp(-pow(nl/.18,2.0));
          vec3 scatter=mix(vec3(.10,.34,.95),vec3(.75,.19,.055),dusk*.7);
          gl_FragColor=vec4(scatter*rim*daylight*${EARTH.airStrength},uOpacity);
        }` });
      atmosphere.scale.setScalar(EARTH.airRadius); earth.add(atmosphere);
      // Thin oval in magnetic latitude. A dim, higher red fringe shares the
      // same oval; the unlit hemisphere carries most of the emission.
      const auroraMaterial = material(new THREE.ShaderMaterial({
        uniforms: atmosphere.material.uniforms, vertexShader: sphereVertex,
        fragmentShader: sphereFragment + `void main(){gl_FragColor=vec4(0.0);}`,
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      upgradeShader(auroraMaterial, { fragmentShader: sphereFragment + `
        uniform vec3 uSun;
        uniform float uAurora,uTime,uOpacity;
        void main() {
          #include <logdepthbuf_fragment>
          vec3 p=normalize(vLocal), n=normalize(vNormal);
          float latitude=abs(p.y);
          float longitude=atan(p.z,p.x);
          float oval=${EARTH.auroraLatitude}+.006*sin(longitude*3.0+uTime*.18);
          float green=exp(-pow((latitude-oval)/${EARTH.auroraWidth},2.0));
          float red=exp(-pow((latitude-oval-.025)/.022,2.0))*${EARTH.redFringe};
          float curtain=.78+.22*sin(longitude*29.0+sin(longitude*7.0+uTime*.3)+uTime*.55);
          float night=1.0-.8*smoothstep(-.15,.35,dot(n,normalize(uSun-vWorld)));
          vec3 light=vec3(.045,.90,.20)*green+vec3(.65,.045,.025)*red;
          gl_FragColor=vec4(light*curtain*night*${EARTH.auroraGain},uOpacity*uAurora);
        }` });
      const aurora = new THREE.Mesh(sphere, auroraMaterial);
      aurora.scale.setScalar(1.428); earth.add(aurora);
      solar = new THREE.Group(); solar.position.copy(sunPosition); scene.add(solar);
      sun = new THREE.Mesh(sphere, material(new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uActivity: { value: 0 } }, vertexShader: sphereVertex,
        fragmentShader: sphereFragment + noise + `
          uniform float uTime,uActivity,uOpacity;
          void main() {
            #include <logdepthbuf_fragment>
            vec3 p=normalize(vLocal);
            float granules=noise3(p*68.0+vec3(0.0,uTime*.20,0.0));
            float cells=noise3(p*22.0+uTime*.045);
            ${opts.mobile ? '' : 'granules=.6*granules+.4*noise3(p*137.0-uTime*.12);'}
            float facing=max(dot(normalize(vNormal),normalize(cameraPosition-vWorld)),0.0);
            float limb=.24+.76*pow(facing,.60);
            float spot=smoothstep(.64,.82,cells)*.16;
            granules=.5+(granules-.5)*.75;
            vec3 temperature=mix(vec3(.95,.19,.015),vec3(1.45,.90,.32),pow(facing,.45));
            vec3 col=temperature*(.72+.48*granules)*limb*(1.0-spot);
            gl_FragColor=vec4(col*(1.0+uActivity*.025),uOpacity);
          }`,
      })));
      sun.material.uniforms.uOpacity = { value: 1 };
      sun.material.transparent = true;
      sun.material.depthWrite = false;
      sun.renderOrder = 1;
      upgradeShader(sun.material, { fragmentShader: sphereFragment + noise + `
        uniform float uTime,uActivity,uOpacity;
        // Noise values evolve in place through a bounded domain deformation;
        // no UV scrolling, and time zero is a fully populated photosphere.
        float evolving(vec3 p,float clock) {
          float phase=clock+noise3(p*.16)*6.2831853;
          vec3 warp=vec3(sin(phase),cos(phase*.83+1.7),sin(phase*.71+3.2));
          return noise3(p+warp*${SUN.warp});
        }
        // About thirty cells per radius. Desktop uses a 3D
        // Voronoi slice; mobile uses nine neighbours on the visible local plane.
        float cells(vec3 p) {
          ${opts.mobile ? 'vec3 cell=vec3(floor(p.xy),0.0), f=vec3(fract(p.xy),0.0);' : 'vec3 cell=floor(p), f=fract(p);'}
          float nearest=10.0, second=10.0;
          for(int z=${opts.mobile ? '0' : '-1'};z<=${opts.mobile ? '0' : '1'};z++) for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++) {
            vec3 offset=vec3(float(x),float(y),float(z)), id=cell+offset;
            vec3 center=.5+.23*sin(vec3(hash(id),hash(id+17.0),hash(id+31.0))*6.2831853
              +uTime*${SUN.evolution}*(.7+uActivity*.8));
            ${opts.mobile ? 'center.z=0.0;' : ''}
            vec3 d=offset+center-f;
            float distanceSq=dot(d,d);
            if(distanceSq<nearest) { second=nearest; nearest=distanceSq; }
            else { second=min(second,distanceSq); }
          }
          float gap=second-nearest;
          float aa=clamp(fwidth(gap)*.5,.008,.055);
          return smoothstep(.025-aa,.16+aa,gap);
        }
        float spot(vec3 p,vec3 center,float radius) {
          vec3 delta=p-normalize(center);
          float d=length(delta)/radius;
          float angle=atan(delta.y,delta.x);
          float filaments=.5+.5*sin(angle*43.0+d*12.0+noise3(p*85.0)*3.0);
          float umbra=1.0-smoothstep(.35,.62,d);
          float penumbra=(1.0-smoothstep(.65,1.4,d))*(.40+.24*filaments);
          return max(umbra,penumbra);
        }
        void main() {
          #include <logdepthbuf_fragment>
          vec3 p=normalize(vLocal);
          float clock=uTime*${SUN.evolution};
          float coarse=evolving(p*7.0,clock*.35);
          vec3 warped=p*${SUN.granuleScale.toFixed(1)}+vec3(coarse-.5)*${SUN.warp};
          float granules=cells(warped);
          float facing=max(dot(normalize(vNormal),normalize(cameraPosition-vWorld)),0.0);
          float limb=${SUN.limbFloor}+(1.0-${SUN.limbFloor})*pow(facing,.8);
          float groups=max(spot(p,vec3(.32,.20,.93),${SUN.spotRadius}),
            spot(p,vec3(.375,.18,.91),${SUN.spotRadius}*.55));
          groups=max(groups,spot(p,vec3(-.53,-.24,.81),${SUN.spotRadius}*.9));
          groups=max(groups,spot(p,vec3(-.13,.48,.87),${SUN.spotRadius}*.75));
          float activityGain=.7+uActivity*.8;
          float textureLight=1.0-${SUN.contrast}*(.75+uActivity*.65)*(1.0-granules)
            +${SUN.supergranuleContrast}*(coarse-.5);
          float faculae=smoothstep(.52,.78,coarse)*pow(1.0-facing,1.8)*${SUN.faculae}*activityGain;
          // Headroom survives ACES: pale gold over most of the centre, with
          // only a small white-hot core. Cell evolution changes actual radiance.
          vec3 heat=mix(vec3(.90,.25,.025),vec3(1.45,1.02,.42),smoothstep(.0,.85,facing));
          heat=mix(heat,vec3(1.95,1.78,1.35),smoothstep(.94,1.0,facing));
          vec3 col=heat*limb*(textureLight*(1.0-groups*${SUN.spotDepth}*activityGain)+faculae);
          float feather=smoothstep(0.0,${SUN.limbFeather},facing);
          gl_FragColor=vec4(col,uOpacity*feather);
        }` });
      sun.scale.setScalar(3.8); solar.add(sun);
      // One analytic halo: soft at the limb even on the calm, time-zero plate.
      corona = new THREE.Mesh(geometry(new THREE.PlaneGeometry(1, 1)), material(new THREE.ShaderMaterial({
        uniforms: { uInner: { value: 1 / 1.3 }, uOpacity: { value: .2 }, uTime: { value: 0 }, uApproach: { value: 0 } },
        vertexShader: sphereVertex,
        fragmentShader: sphereFragment + `
          uniform float uInner,uOpacity,uTime,uApproach;
          void main() {
            #include <logdepthbuf_fragment>
            vec2 p=(vUv-.5)*2.0;
            float r=length(p), height=max(0.0,r/uInner-1.0);
            if(r<uInner-.006 || r>1.0) discard;
            float angle=atan(p.y,p.x);
            float wisps=.83+.10*sin(angle*7.0+uTime*.025)
              +.07*sin(angle*13.0-.6+sin(angle*5.0)+uTime*.04);
            float inner=smoothstep(uInner-.006,uInner+.004,r);
            float edge=1.0-smoothstep(.80,1.0,r);
            float falloff=exp(-height*24.0)+.19*exp(-height*7.0/wisps);
            falloff+=uApproach*.6*exp(-height*.55);
            gl_FragColor=vec4(1.15,.19,.012,uOpacity*falloff*wisps*inner*edge);
          }`, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      })));
      upgradeShader(corona.material, { fragmentShader: sphereFragment + `
        uniform float uInner,uOpacity,uTime,uApproach;
        void main() {
          #include <logdepthbuf_fragment>
          vec2 p=(vUv-.5)*2.0;
          float r=length(p), height=r/uInner-1.0;
          if(height<-.10 || r>1.0) discard;
          float angle=atan(p.y,p.x), evolution=uTime*.22;
          float rays=pow(.5+.5*sin(angle*11.0+sin(angle*5.0+evolution)*1.4),4.0);
          float fine=.75+.25*sin(angle*53.0+sin(angle*17.0-evolution)*2.0);
          float edge=1.0-smoothstep(.82,1.0,r);
          float inner=smoothstep(-.10,.025,height);
          float spicules=.65+.35*sin(angle*157.0+sin(angle*37.0)+uTime*.25);
          float chromosphere=exp(-max(height,0.0)*95.0)*spicules;
          float outerCorona=exp(-max(height,0.0)*(4.0-rays*1.4));
          vec3 pearl=mix(vec3(1.0,.85,.6),vec3(1.0,.42,.08),smoothstep(.0,.9,height));
          float h=max(height,0.0);
          vec3 light=vec3(1.0,.30,.03)*chromosphere*${SUN.chromosphere}
            +vec3(1.0,.66,.23)*exp(-h*8.0)*.65
            +vec3(1.0,.40,.075)*exp(-h*2.6)*.38*(.93+.07*fine)
            +pearl*outerCorona*${SUN.streamer}*rays*fine;
          light+=vec3(1.0,.28,.035)*uApproach*.6*exp(-h*.55);
          gl_FragColor=vec4(light,uOpacity*inner*edge);
        }` });
      solar.add(corona);
      // Uneven active regions, measured in solar radii. The last region is the sole
      // large eruption; open sprays and short hedgerows interrupt the returning arches.
      const regions = [
        { angle: .24, span: .22, height: .11, lean: -.035, onset: 0, open: false },
        { angle: 2.30, span: .15, height: .16, lean: .045, onset: 1, open: true },
        { angle: 2.73, span: .30, height: .24, lean: -.055, onset: 2, open: false },
        { angle: 4.95, span: .18, height: .18, lean: .040, onset: 2, open: true },
        { angle: .72, span: .27, height: .36, lean: -.075, onset: 3, open: false },
        { angle: 5.72, span: .23, height: .28, lean: .060, onset: 3, open: false },
        { angle: 3.43, span: .24, height: .22, lean: -.025, onset: 4, open: true },
        { angle: 1.67, span: .32, height: .58, lean: .090, onset: 4, open: true },
      ];
      // Local seeded noise leaves the shared galaxy/ejecta sampling sequence untouched.
      const sample = (i: number) => { const n = Math.sin(i * 127.1 + 73.7) * 43758.5453; return n - Math.floor(n); };
      const plasmaMaterial = material(new THREE.ShaderMaterial({
        uniforms: { uOpacity: { value: 0 }, uTime: { value: 0 }, uActivity: { value: 0 } },
        vertexShader: `
          attribute float aSeed,aHeight;
          uniform float uTime,uActivity;
          varying vec2 vUv;
          varying float vSeed,vHeight;
          #include <common>
          #include <logdepthbuf_pars_vertex>
          void main() {
            vUv=uv; vSeed=aSeed; vHeight=aHeight;
            vec3 p=position;
            // Slow, small displacements pin both footpoints to the photosphere.
            float drift=aHeight*.012*sin(uTime*.32+aSeed+uv.x*8.0);
            p.xy+=normalize(position.xy)*(drift+aHeight*uActivity*.55);
            gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);
            #include <logdepthbuf_vertex>
          }`,
        fragmentShader: `
          precision highp float;
          uniform float uOpacity,uTime;
          varying vec2 vUv;
          varying float vSeed,vHeight;
          #include <logdepthbuf_pars_fragment>
          float filamentNoise(float x) {
            float i=floor(x), f=fract(x);
            f=f*f*(3.0-2.0*f);
            return mix(fract(sin(i*127.1)*43758.5453),fract(sin((i+1.0)*127.1)*43758.5453),f);
          }
          void main() {
            #include <logdepthbuf_fragment>
            float edge=exp(-pow((vUv.y-.5)*3.6,2.0))
              *(1.0-smoothstep(.25,.5,abs(vUv.y-.5)));
            float flow=.25+.75*filamentNoise(vUv.x*23.0+vSeed*9.0-uTime*.18);
            flow*=.75+.25*sin(uTime*.55+vSeed);
            float roots=exp(-vHeight*24.0);
            float top=1.0-smoothstep(.66,1.0,vUv.x);
            // Open ends fade out; returning strands recover their bright second root.
            float fade=mix(.34,1.0,roots)*(.45+.55*top);
            vec3 heat=mix(vec3(1.05,.065,.004),vec3(1.8,.95,.36),roots);
            gl_FragColor=vec4(heat,uOpacity*edge*flow*fade*.85);
          }`,
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true,
      }));
      const filamentNoise = (x: number) => {
        const lo = Math.floor(x);
        return THREE.MathUtils.lerp(sample(lo), sample(lo + 1), smoother(x - lo)) * 2 - 1;
      };
      regions.forEach((region, i) => {
        const vertices: number[] = [], uvs: number[] = [], seeds: number[] = [], heights: number[] = [], indices: number[] = [];
        const steps = opts.mobile ? 28 : 40, strands = opts.mobile ? SUN.mobileStrands : SUN.desktopStrands;
        for (let strand = 0; strand < strands; strand++) {
          const salt = i * 97 + strand * 13, phase = sample(salt) * Math.PI * 2;
          const strandHeight = region.height * (.65 + sample(salt + 1) * .35);
          const spread = (strand / (strands - 1) - .5) * .035;
          const strandWidth = SUN.strandWidth * (.8 + sample(salt + 2) * .7);
          const path = (q: number) => {
            const arch = Math.sin(q * Math.PI * (region.open ? .62 : 1));
            const envelope = Math.sin(q * Math.PI);
            const jitter = (filamentNoise(q * 9 + salt) + .4 * filamentNoise(q * 21 + salt + 47)) * .013 * envelope;
            const a = region.angle + (q - .5) * region.span + region.lean * arch + spread * arch + jitter;
            const lift = strandHeight * arch + jitter * .7;
            const r = 3.77 + 3.8 * lift;
            return { x: Math.cos(a) * r, y: Math.sin(a) * r, lift };
          };
          for (let j = 0; j <= steps; j++) {
            const q = j / steps, p = path(q), before = path(Math.max(0, q - .002)), after = path(Math.min(1, q + .002));
            const dx = after.x - before.x, dy = after.y - before.y, length = Math.hypot(dx, dy);
            const taper = (.45 + .55 * Math.sin(q * Math.PI)) * (region.open ? 1 - .8 * q : 1);
            for (const side of [-1, 1]) {
              vertices.push(p.x - dy / length * strandWidth * taper * side,
                p.y + dx / length * strandWidth * taper * side, .28);
              uvs.push(q, (side + 1) / 2); seeds.push(phase); heights.push(Math.max(0, p.lift));
            }
            if (j < steps) {
              const v = strand * (steps + 1) * 2 + j * 2;
              indices.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
            }
          }
        }
        const ribbon = geometry(new THREE.BufferGeometry());
        ribbon.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        ribbon.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        ribbon.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));
        ribbon.setAttribute('aHeight', new THREE.Float32BufferAttribute(heights, 1));
        ribbon.setIndex(indices);
        const strandMaterial = material(plasmaMaterial.clone());
        // Each clone owns its guard; a failed ribbon cannot blank the solar plate.
        const strandMarker = guardShader(strandMaterial, () => {
          strandMaterial.vertexShader = sphereVertex;
          strandMaterial.fragmentShader = sphereFragment + `
            uniform float uOpacity;
            void main(){gl_FragColor=vec4(.8,.18,.02,uOpacity*.25);}`;
        });
        strandMaterial.vertexShader = strandMarker + strandMaterial.vertexShader;
        strandMaterial.fragmentShader = strandMarker + strandMaterial.fragmentShader;
        const flare = new THREE.Mesh(ribbon, strandMaterial);
        solar.add(flare); flares.push({ mesh: flare, onset: region.onset });
      });
      const ejecta: number[] = [], ejectaColors: number[] = [];
      for (let i = 0; i < (opts.mobile ? SUN.ejectaCount / 2 : SUN.ejectaCount); i++) {
        // Two unequal bent flux plumes, sampled continuously with soft overlap.
        const q = random(), plume = i % 3 === 0 ? 1 : 0;
        const angle = (plume ? 2.34 : .68) + (plume ? -.48 : .62) * q
          + gaussian() * (.015 + .035 * Math.sin(q * Math.PI));
        const radius = 3.83 + Math.sin(q * Math.PI * .78) * (plume ? 1.55 : 2.55);
        ejecta.push(Math.cos(angle) * radius, Math.sin(angle) * radius, .35 + Math.sin(q * Math.PI) * .6);
        const heat = Math.pow(1 - q, .7);
        ejectaColors.push(.65 + heat * .35, .035 + heat * .17, .004 + heat * .015);
      }
      const eruptionGeometry = geometry(new THREE.BufferGeometry());
      eruptionGeometry.setAttribute('position', new THREE.Float32BufferAttribute(ejecta, 3));
      eruptionGeometry.setAttribute('color', new THREE.Float32BufferAttribute(ejectaColors, 3));
      eruption = new THREE.Points(eruptionGeometry, material(new THREE.PointsMaterial({
        vertexColors: true, size: SUN.ejectaSize, map: glow, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0,
      })));
      solar.add(eruption);
      galaxyMaterial = material(new THREE.ShaderMaterial({
        uniforms: { uOpacity: { value: 0 }, uArms: { value: 1 }, uKnots: { value: 1 }, uDust: { value: 1 }, uLaneContrast: { value: 0 }, uKnotBoost: { value: 1 }, uHeight: { value: 1 }, uFraction: { value: .35 } },
        vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        vertexShader: `
          attribute float aRadius,aKnot,aRank;
          uniform float uHeight;
          varying vec3 vColor; varying float vRadius,vKnot,vDust,vRank;
          #include <common>
  #include <logdepthbuf_pars_vertex>
          void main() {
            vColor=color; vRadius=aRadius; vKnot=aKnot; vRank=aRank;
            vDust=.5+.5*sin(atan(position.z,position.x)*4.0-log(1.0+length(position.xz))*6.6+.7);
            vec4 mv=modelViewMatrix*vec4(position,1.0);
            gl_Position=projectionMatrix*mv;
            gl_PointSize=clamp(uHeight*.09/max(1.0,-mv.z),1.0,4.0);
            #include <logdepthbuf_vertex>
          }`,
        fragmentShader: `
          precision highp float;
          uniform float uOpacity,uArms,uKnots,uDust,uLaneContrast,uKnotBoost,uFraction;
          varying vec3 vColor; varying float vRadius,vKnot,vDust,vRank;
          #include <logdepthbuf_pars_fragment>
          void main() {
            #include <logdepthbuf_fragment>
            float r=length(gl_PointCoord-.5)*2.0; if(r>1.0) discard;
            float reveal=1.0-smoothstep(uFraction,uFraction+.012,vRank);
            if(reveal<=0.0) discard;
            float arms=mix(1.0,uArms,smoothstep(.02,.18,vRadius));
            float lane=smoothstep(mix(.74,.84,uLaneContrast),mix(.98,.94,uLaneContrast),vDust);
            float dust=1.0-uDust*lane*smoothstep(.1,.3,vRadius)*mix(.72,.97,uLaneContrast);
            // Knot stars remain ordinary arm stars until High, preserving the star fractions.
            vec3 base=mix(vColor,vec3(.4,.6,1.0),vKnot*(1.0-uKnots));
            vec3 light=base*1.8*mix(1.0,uKnotBoost,vKnot*uKnots);
            gl_FragColor=vec4(light,pow(1.0-r,1.5)*uOpacity*arms*reveal*dust*.72
              *(1.0-smoothstep(${GALAXY.edgeFadeStart},1.0,vRadius)));
          }`,
      }));
      galaxyMaterial.uniforms.uTime = { value: 0 };
      upgradeShader(galaxyMaterial, {
        vertexShader: precision + `
          attribute float aRadius,aKnot,aRank,aSize,aPopulation,aCohort;
          uniform float uHeight,uTime;
          varying vec3 vColor;
          varying float vRadius,vKnot,vDust,vRank,vOrbitFade,vPopulation;
          #include <common>
          #include <logdepthbuf_pars_vertex>
          void main() {
            vColor=color; vRadius=aRadius; vKnot=aKnot; vRank=aRank; vPopulation=aPopulation;
            float epoch=mod(uTime,${GALAXY.orbitReset.toFixed(1)});
            float blend=smoothstep(.2,.8,epoch/${GALAXY.orbitReset.toFixed(1)});
            vOrbitFade=mix(1.0-blend,blend,aCohort);
            // Inner disc stars move faster, but the bulge, bar and registered
            // solar arm star follow the rigid density-wave pattern.
            float speed=aPopulation<.5 ? ${GALAXY.orbitSpeed}/pow(max(aRadius,.08),${GALAXY.orbitPower}) : 0.0;
            float age=epoch-aCohort*${GALAXY.orbitReset.toFixed(1)};
            float angle=uTime*${GALAXY.patternSpeed}+age*speed;
            float c=cos(angle), s=sin(angle);
            vec3 p=vec3(position.x*c-position.z*s,position.y,position.x*s+position.z*c);
            float theta=atan(position.z,position.x);
            // Dust stays attached to each orbiting arm cohort, never screen space.
            vDust=.5+.5*sin(theta*4.0-log(1.0+length(position.xz))*${(GALAXY.pitch * 4).toFixed(2)}-(${(GALAXY_ARM_PHASE * 4).toFixed(6)})+.7);
            vec4 mv=modelViewMatrix*vec4(p,1.0);
            gl_Position=projectionMatrix*mv;
            gl_PointSize=clamp(uHeight*${GALAXY.pointScale}*aSize/max(1.0,-mv.z),.65,${GALAXY.pointMax.toFixed(1)});
            #include <logdepthbuf_vertex>
          }`,
        fragmentShader: precision + `
          uniform float uOpacity,uArms,uKnots,uDust,uLaneContrast,uKnotBoost,uFraction;
          varying vec3 vColor;
          varying float vRadius,vKnot,vDust,vRank,vOrbitFade,vPopulation;
          #include <logdepthbuf_pars_fragment>
          void main() {
            #include <logdepthbuf_fragment>
            float r=length(gl_PointCoord-.5)*2.0;
            if(r>1.0 || vOrbitFade<.001) discard;
            float reveal=1.0-smoothstep(uFraction,uFraction+.012,vRank);
            if(reveal<=0.0) discard;
            float arm=mix(1.0,uArms,smoothstep(.02,.18,vRadius));
            float lane=smoothstep(.76,.97,vDust);
            float dust=1.0-uDust*lane*smoothstep(.1,.3,vRadius)*mix(.65,.88,uLaneContrast);
            if(vPopulation>.5) dust=1.0;
            vec3 base=mix(vColor,vec3(.63,.76,1.0),vKnot*(1.0-uKnots));
            vec3 light=base*.85*mix(1.0,uKnotBoost,vKnot*uKnots);
            float profile=exp(-r*r*4.5)*(1.0-smoothstep(.65,1.0,r));
            float halo=vPopulation>2.5 && vPopulation<3.5 ? .3 : 1.0;
            gl_FragColor=vec4(light,profile*uOpacity*arm*reveal*dust*vOrbitFade*halo*.72
              *(1.0-smoothstep(${GALAXY.edgeFadeStart},1.0,vRadius)));
          }`,
      });
      galaxy = new THREE.Group(); galaxy.position.copy(galaxyPosition); scene.add(galaxy);
      galaxyStars = new THREE.Points(makeGalaxy(opts.mobile ? GALAXY.count / 2 : GALAXY.count), galaxyMaterial); galaxy.add(galaxyStars);
      galaxyCore = sprite(glow, 0xffd19a, 24, .8); galaxy.add(galaxyCore);
      galaxyHalo = sprite(glow, 0x8e9bb9, 150, 0); galaxy.add(galaxyHalo);
      // The continuous light carries the galaxy on both tiers. Mobile uses two
      // noise octaves; desktop adds fine dust detail. No extra fullscreen pass.
      const discGeometry = geometry(new THREE.PlaneGeometry(GALAXY.radius * 2, GALAXY.radius * 2));
      const makeDiscMaterial = () => {
        const discMaterial = material(new THREE.ShaderMaterial({
          uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 }, uDust: { value: .55 }, uKnots: { value: .25 } },
          vertexShader: sphereVertex,
          // A visible analytic disc remains if the detailed shader cannot link.
          fragmentShader: sphereFragment + `
            uniform float uTime,uOpacity,uDust,uKnots;
            void main() {
              #include <logdepthbuf_fragment>
              vec2 p=vec2(vUv.x-.5,.5-vUv.y)*${(GALAXY.radius * 2).toFixed(1)};
              float r=length(p), theta=atan(p.y,p.x)-uTime*${GALAXY.patternSpeed};
              float phase=theta*4.0-log(1.0+r)*${(GALAXY.pitch * 4).toFixed(2)}-(${(GALAXY_ARM_PHASE * 4).toFixed(6)});
              float arms=pow(.5+.5*cos(phase),3.0)*smoothstep(4.0,12.0,r);
              vec3 light=vec3(.22,.32,.55)*(.18+arms)*exp(-r/38.0)
                +vec3(.85,.62,.30)*exp(-r*r/70.0);
              gl_FragColor=vec4(light,uOpacity*(1.0-smoothstep(${(GALAXY.radius * GALAXY.edgeFadeStart).toFixed(1)},${GALAXY.radius.toFixed(1)},r)));
            }`,
          transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
          forceSinglePass: true,
        }));
        upgradeShader(discMaterial, { fragmentShader: sphereFragment + noise + `
          uniform float uTime,uOpacity,uDust,uKnots;
          float discFbm(vec3 p) {
            float n=.62*noise3(p)+.38*noise3(p*2.07+7.0);
            ${opts.mobile ? '' : 'n=n*.80+.14*noise3(p*4.13+17.0)+.06*noise3(p*8.31);'}
            return n;
          }
          void main() {
            #include <logdepthbuf_fragment>
            // Plane Y becomes -Z after rotation: match the particle handedness.
            vec2 p=vec2(vUv.x-.5,.5-vUv.y)*${(GALAXY.radius * 2).toFixed(1)};
            float r=length(p);
            if(r>${GALAXY.radius.toFixed(1)}) discard;
            float theta=atan(p.y,p.x)-uTime*${GALAXY.patternSpeed};
            vec2 rotating=vec2(cos(theta),sin(theta))*r;
            float grain=discFbm(vec3(rotating*.19,0.0));
            float phase=theta*4.0-log(1.0+r)*${(GALAXY.pitch * 4).toFixed(2)}-(${(GALAXY_ARM_PHASE * 4).toFixed(6)});
            float armPhase=phase+(grain-.5)*.55;
            float arms=pow(.5+.5*cos(armPhase),3.0)*smoothstep(4.0,13.0,r);
            float radial=exp(-r/36.0);
            // Positive phase is the inner-radius edge of a logarithmic arm.
            float lane=pow(.5+.5*cos(armPhase-.48),20.0)*smoothstep(8.0,18.0,r)*uDust;
            float disc=.075*radial, armLight=arms*radial*(.55+.9*grain);
            vec3 young=vec3(.42,.60,1.0)*(disc+armLight*.85);
            young=mix(young,young*vec3(.24,.12,.045),lane*.90);
            float bulge=exp(-r*r/65.0), innerBulge=exp(-r*r/12.0);
            float bar=exp(-pow(rotating.x/13.0,2.0)-pow(rotating.y/2.6,2.0));
            vec3 old=vec3(.92,.68,.34)*(bulge*.72+bar*.35)+vec3(.68,.62,.44)*innerBulge*.22;
            float knots=pow(smoothstep(.61,.84,noise3(vec3(rotating*.55,8.0))),2.0)*arms*smoothstep(12.0,22.0,r);
            vec3 light=young+old+vec3(1.0,.10,.32)*knots*radial*uKnots*.7;
            gl_FragColor=vec4(light,uOpacity*(1.0-smoothstep(${(GALAXY.radius * GALAXY.edgeFadeStart).toFixed(1)},${GALAXY.radius.toFixed(1)},r)));
          }` });
        return discMaterial;
      };
      galaxyDisc = new THREE.Mesh(discGeometry, makeDiscMaterial());
      galaxyDisc.rotation.x = -Math.PI / 2; galaxy.add(galaxyDisc);
      for (let i = 0; i < 4; i++) {
        const g = new THREE.Group(), angle = i * Math.PI / 2 + .45;
        g.position.set(Math.cos(angle) * 64, (i % 2 ? 1 : -1) * 10, Math.sin(angle) * 70);
        g.rotation.set(.35 + i * .35, i * 1.2, .15 + i * .3);
        const companionMaterial = makeDiscMaterial(); companionDiscs.push(companionMaterial);
        const disc = new THREE.Mesh(discGeometry, companionMaterial);
        disc.rotation.x = -Math.PI / 2; g.add(disc);
        galaxy.add(g); companions.push(g);
      }
      const streamPositions: number[] = [];
      companions.forEach(g => {
        for (let i = 0, count = opts.mobile ? GALAXY.streamCount / 2 : GALAXY.streamCount; i < count; i++) {
          const q = i / (count - 1);
          streamPositions.push(g.position.x*q+gaussian()*1.3, Math.sin(q*Math.PI)*12+gaussian(), g.position.z*q+gaussian()*1.3);
        }
      });
      const streamGeometry = geometry(new THREE.BufferGeometry()); streamGeometry.setAttribute('position', new THREE.Float32BufferAttribute(streamPositions, 3));
      streams = new THREE.Points(streamGeometry, material(new THREE.PointsMaterial({ color: 0x8ca9ef, size: .19, map: glow,
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: .12 })));
      galaxy.add(streams);
      const stars: number[] = [], starColors: number[] = [], starSizes: number[] = [], magnitudes: number[] = [];
      for (let i = 0; i < (opts.mobile ? BACKGROUND.count / 2 : BACKGROUND.count); i++) {
        const phi = random() * Math.PI * 2;
        const band = random() < BACKGROUND.bandFraction;
        const latitude = band ? gaussian() * BACKGROUND.bandWidth : Math.asin(random() * 2 - 1);
        const r = Math.cos(latitude), z = Math.sin(latitude);
        // A fixed inclined great-circle band; camera translation introduces no drift.
        const x = r * Math.cos(phi), y = z, depth = r * Math.sin(phi);
        stars.push(BACKGROUND.radius * x, BACKGROUND.radius * (y * .82 - depth * .57),
          BACKGROUND.radius * (y * .57 + depth * .82));
        const temperature = random();
        const color = new THREE.Color(1, .83, .66).lerp(new THREE.Color(.72, .83, 1), temperature);
        starColors.push(color.r, color.g, color.b);
        starSizes.push(.85 + Math.pow(random(), 7) * 2.6);
        magnitudes.push(.12 + Math.pow(random(), 3) * .88);
      }
      const starGeometry = geometry(new THREE.BufferGeometry());
      starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(stars, 3));
      starGeometry.setAttribute('color', new THREE.Float32BufferAttribute(starColors, 3));
      starGeometry.setAttribute('aSize', new THREE.Float32BufferAttribute(starSizes, 1));
      starGeometry.setAttribute('aMagnitude', new THREE.Float32BufferAttribute(magnitudes, 1));
      const fallbackStars = material(new THREE.PointsMaterial({ color: 0xb3c4de, map: glow, size: 1,
        sizeAttenuation: false, transparent: true, opacity: .6, depthWrite: false }));
      starfield = new THREE.Points(starGeometry, fallbackStars);
      const backgroundMaterial = material(new THREE.ShaderMaterial({
        uniforms: { uPixelRatio: { value: renderer.getPixelRatio() } },
        vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
        vertexShader: precision + `
          attribute float aSize,aMagnitude;
          uniform float uPixelRatio;
          varying vec3 vColor;
          varying float vMagnitude;
          #include <common>
          #include <logdepthbuf_pars_vertex>
          void main() {
            vColor=color; vMagnitude=aMagnitude;
            gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
            gl_PointSize=aSize*uPixelRatio;
            #include <logdepthbuf_vertex>
          }`,
        fragmentShader: precision + `
          varying vec3 vColor;
          varying float vMagnitude;
          #include <logdepthbuf_pars_fragment>
          void main() {
            #include <logdepthbuf_fragment>
            float r=length(gl_PointCoord-.5)*2.0;
            if(r>1.0) discard;
            float profile=exp(-r*r*3.5)*(1.0-smoothstep(.7,1.0,r));
            gl_FragColor=vec4(vColor,profile*vMagnitude*${BACKGROUND.brightness});
          }`,
      }));
      const backgroundMarker = guardShader(backgroundMaterial, () => { starfield.material = fallbackStars; });
      backgroundMaterial.vertexShader = backgroundMarker + backgroundMaterial.vertexShader;
      backgroundMaterial.fragmentShader = backgroundMarker + backgroundMaterial.fragmentShader;
      starfield.material = backgroundMaterial;
      scene.add(starfield);
      if (!opts.mobile) {
        const bandMaterial = material(new THREE.ShaderMaterial({
          vertexShader: sphereVertex,
          fragmentShader: sphereFragment + 'void main(){gl_FragColor=vec4(0.0);}',
          transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide,
        }));
        upgradeShader(bandMaterial, { fragmentShader: sphereFragment + noise + `
          void main() {
            #include <logdepthbuf_fragment>
            vec3 d=normalize(vLocal);
            float latitude=abs(d.y*.82+d.z*.57);
            float band=exp(-pow(latitude/.11,2.0));
            float dust=noise3(d*28.0)*noise3(d*67.0);
            vec3 light=mix(vec3(.23,.29,.44),vec3(.48,.40,.32),noise3(d*5.0));
            gl_FragColor=vec4(light,band*(.3+dust)*${BACKGROUND.bandOpacity});
          }` });
        const band = new THREE.Mesh(geometry(new THREE.SphereGeometry(BACKGROUND.radius * 1.02, 32, 16)), bandMaterial);
        starfield.add(band);
      }
      for (let i = 0; i < BACKGROUND.galaxyCount; i++) {
        const distant = sprite(glow, 0xc5bcac, 12, .12);
        const azimuth = .8 + i * 2.1, latitude = .35 - i * .3;
        distant.position.set(Math.cos(azimuth), latitude, Math.sin(azimuth)).normalize().multiplyScalar(BACKGROUND.radius * .95);
        distant.scale.set(12, 3.5 + i, 1); distant.material.rotation = i * .8;
        starfield.add(distant);
      }
      const satelliteGeometry = geometry(new THREE.BufferGeometry());
      satelliteGeometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
      const phases = [2.3, 2.5, 2.6, 2.8];
      for (let i = 0; i < 4; i++) {
        const group = new THREE.Group(); earth.add(group);
        const point = material(new THREE.ShaderMaterial({
          uniforms: { uSize: { value: 1 }, uOpacity: { value: 0 } },
          vertexShader: `
            uniform float uSize;
            #include <common>
            #include <logdepthbuf_pars_vertex>
            void main() {
              gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
              gl_PointSize=uSize;
              #include <logdepthbuf_vertex>
            }`,
          fragmentShader: `
            uniform float uOpacity;
            #include <logdepthbuf_pars_fragment>
            void main() {
              #include <logdepthbuf_fragment>
              float r=length(gl_PointCoord-.5)*2.0;
              if(r>1.0) discard;
              float core=1.0-smoothstep(.42,.5,r);
              float halo=exp(-r*r*5.0)*(1.0-smoothstep(.8,1.0,r));
              gl_FragColor=vec4(vec3(1.6,2.0,2.4),uOpacity*(core+halo*.45));
            }`,
          transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        const dot = new THREE.Points(satelliteGeometry, point);
        orbitPoint(dot.position, phases[i], i); group.add(dot);
        const trails = orbitTrail(group, i, phases[i]);
        const normal = new THREE.Vector3().crossVectors(orbitPoint(new THREE.Vector3(), 0, i), orbitPoint(new THREE.Vector3(), Math.PI / 2, i)).normalize();
        satellites.push({ group, point, trails, normal });
      }
      station = new THREE.Group();
      const stationMaterial = material(new THREE.MeshBasicMaterial({ color: 0xd7e5ed }));
      const panelMaterial = material(new THREE.MeshBasicMaterial({ color: 0x284f78 }));
      const railMaterial = material(new THREE.MeshBasicMaterial({ color: 0x6687a0 }));
      const box = geometry(new THREE.BoxGeometry(1, 1, 1));
      const body = new THREE.Mesh(geometry(new THREE.CylinderGeometry(.045, .045, .22, 8)), stationMaterial);
      station.add(body);
      const boom = new THREE.Mesh(box, railMaterial); boom.scale.set(.64, .018, .022); station.add(boom);
      for (const sign of [-1, 1]) {
        const panel = new THREE.Mesh(box, panelMaterial);
        panel.position.x = sign * .21; panel.scale.set(.28, .115, .012); station.add(panel);
        // Thin cell rails and the panel thickness supply depth without a flat white cross.
        for (const offset of [-.07, 0, .07]) {
          const rail = new THREE.Mesh(box, railMaterial);
          rail.position.set(sign * .21 + offset, 0, .008); rail.scale.set(.005, .115, .004); station.add(rail);
        }
      }
      const stationGlow = sprite(glow, 0xbedcff, .36, .20); station.add(stationGlow);
      earth.add(station);
      stationTrail = new THREE.Group(); earth.add(stationTrail);
      stationTrails = orbitTrail(stationTrail, 0, 1.35, .18);
      for (const m of materials) {
        if (m instanceof THREE.ShaderMaterial) {
          m.precision = 'highp';
          m.vertexShader = precision + m.vertexShader;
          m.fragmentShader = precision + m.fragmentShader;
        }
      }
      const resize = () => {
        if (dead || !renderer || !composer) return;
        width = Math.max(1, el.clientWidth); height = Math.max(1, el.clientHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5)); renderer.setSize(width, height, false);
        composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(width, height);
        camera.aspect = width / height;
        readClearRectangle(); fitAstraCamera();
        backgroundMaterial.uniforms.uPixelRatio.value = renderer.getPixelRatio();
        galaxyMaterial.uniforms.uHeight.value = height * renderer.getPixelRatio();
        frame(lastPos, lastT);
      };
      observer = new ResizeObserver(resize); observer.observe(el); resize();
      const small = [
        load('moon_color_2k', true, texture => { moon.material.map = texture; moon.material.needsUpdate = true; }),
        load('moon_disp_1k', false, texture => { moon.material.bumpMap = texture; moon.material.needsUpdate = true; }),
        load('earth_day_2k', true, texture => { earthMaterial.uniforms.uDay.value = texture; earthMaterial.uniforms.uHasDay.value = 1; }),
        load('earth_night_2k', true, texture => { earthMaterial.uniforms.uNight.value = texture; }),
        load('earth_clouds_2k', false, texture => { earthMaterial.uniforms.uClouds.value = texture; cloud.material.alphaMap = texture; cloud.material.needsUpdate = true; }),
      ];
      const settled = Promise.all(small);
      if (!opts.mobile) void settled.then(() => {
        if (dead) return;
        void load('moon_color_4k', true, texture => { moon.material.map = texture; moon.material.needsUpdate = true; });
        void load('earth_night_4k', true, texture => { earthMaterial.uniforms.uNight.value = texture; });
      });
      let timeout: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([settled, new Promise<void>(resolve => { timeout = setTimeout(resolve, 4000); })]);
      if (timeout !== undefined) clearTimeout(timeout);
      frame(lastPos, lastT);
    },
    frame,
    destroy() {
      if (dead) return;
      dead = true; observer?.disconnect();
      geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose());
      passes.forEach(p => p.dispose()); composer?.dispose();
      renderer?.dispose(); renderer?.forceContextLoss(); renderer?.domElement.remove();
      geometries.clear(); materials.clear(); textures.clear(); shaderFallbacks.clear();
    },
  };
}
