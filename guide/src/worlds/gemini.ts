import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { World, WorldOpts } from '../stage';

const TAU = Math.PI * 2;
// Quality and optics: phone work is exactly half the desktop particle budget.
const QUALITY = { particles: 10000, plasma: 1600, ringSamples: 192, pixelRatio: 1.5 };
// Radians / world units / seconds. The same deformation drives atoms and bonds.
const CARBON = {
  samplesPerAtom: 64, atomRadius: 0.066, atomHeadSize: 4.4,
  tilt: 0.50, tiltSwing: 0.09, tiltSpeed: 0.23,
  yaw: 0.30, yawSwing: 0.25, yawSpeed: 0.18,
  turn: 0.10, turnSwing: 0.12, turnSpeed: 0.13,
  rippleHeight: 0.11, rippleSpeed: 0.95,
  bondRadius: 0.010, bondSides: 8, haloRadius: 2.8,
  pulseSpeed: 2.2, pulseSharpness: 14, boundsPadding: 0.10,
};
const FRAMING = {
  fill: 0.80, refreshSeconds: 0.25,
  mobile: { top: 60, bottom: 250, right: 60 },
  desktop: { top: 80, bottom: 0, right: 80 },
};
const FLIGHT = {
  distance: 8, lateral: 0.12, rise: 0.045, approach: 0.38, fovBreath: 0.8,
  exposure: [1.05, 1.02, 1.04, 1.02],
};
const DETAIL = {
  morphDelay: 0.14, morphArc: 0.16, morphDissolve: 0.28, depthFalloff: 0.16,
  boltWander: 0.035, boltFlicker: 0.32,
  boltFineScale: 12, boltFineSpeed: 2.1, boltPulseScale: 2.4, boltPulseSpeed: 3.1,
  auroraStrength: 0.12, auroraSpeed: 0.09, auroraRays: 92,
  auroraHeight: 0.69, auroraWidth: 0.15, auroraFold: 0.055,
  filamentStrength: 0.18, filamentFrequency: 4.2, filamentSpeed: 0.24,
  cloudBreath: 0.045, cloudTurnSpeed: 0.16,
  highlight: 0.12, highlightPower: 18, perspectiveSizeMin: 0.8, perspectiveSizeMax: 1.2,
};
// Integers must also be emitted as GLSL floats (for example 8.0 / depth).
const glslFloat = (value:number)=>value.toFixed(6);
const BLOOM = { strength: 0.40, radius: 0.42, threshold: 0.85, effortGain: 0.07 };

// Spatial value noise with time as the third dimension: patterns evolve in
// place instead of sliding a noise texture across the subject.
const evolvingNoise = /* glsl */ `
float hash3(vec3 p) {
  p=fract(p*0.1031); p+=dot(p,p.yzx+33.33);
  return fract((p.x+p.y)*p.z);
}
float noise3(vec3 p) {
  vec3 i=floor(p), f=fract(p); f=f*f*f*(f*(f*6.0-15.0)+10.0);
  return mix(mix(mix(hash3(i),hash3(i+vec3(1,0,0)),f.x),
                 mix(hash3(i+vec3(0,1,0)),hash3(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash3(i+vec3(0,0,1)),hash3(i+vec3(1,0,1)),f.x),
                 mix(hash3(i+vec3(0,1,1)),hash3(i+vec3(1,1,1)),f.x),f.y),f.z);
}`;

const carbonDeformation = /* glsl */ `
vec3 carbonPlate(vec3 p, float clock) {
  p.z+=sin(clock*${glslFloat(CARBON.rippleSpeed)}+p.x*1.8+p.y*1.2)*${glslFloat(CARBON.rippleHeight)};
  float tilt=${glslFloat(CARBON.tilt)}+sin(clock*${glslFloat(CARBON.tiltSpeed)})*${glslFloat(CARBON.tiltSwing)};
  float yaw=${glslFloat(CARBON.yaw)}+sin(clock*${glslFloat(CARBON.yawSpeed)})*${glslFloat(CARBON.yawSwing)};
  float turn=${glslFloat(CARBON.turn)}+sin(clock*${glslFloat(CARBON.turnSpeed)})*${glslFloat(CARBON.turnSwing)};
  p.yz=mat2(cos(tilt),sin(tilt),-sin(tilt),cos(tilt))*p.yz;
  p.xz=mat2(cos(yaw),sin(yaw),-sin(yaw),cos(yaw))*p.xz;
  p.xy=mat2(cos(turn),sin(turn),-sin(turn),cos(turn))*p.xy;
  return p;
}`;

// Explicit ES 3.00 programs, with identical float/int precision in both stages.
// Conversion is idempotent so saved, already-converted fallbacks stay usable.
const shaderPrecision=(source:string)=>'precision highp float;\nprecision highp int;\n'+
  source.replace(/precision\s+(?:lowp|mediump|highp)\s+(?:float|int)\s*;/g,'');
const shaderStages = (vertex: string, fragment: string) => ({
  vertexShader: shaderPrecision(vertex.replace(/\battribute\b/g,'in').replace(/\bvarying\b/g,'out')),
  fragmentShader: (fragment.includes('out highp vec4 plateColor;')?'':'out highp vec4 plateColor;\n')+
    shaderPrecision(fragment.replace(/\bvarying\b/g,'in').replace(/\bgl_FragColor\b/g,'plateColor')),
});

const names = ['flash', 'hydrogen', 'argon', 'carbon'];
const clamp = THREE.MathUtils.clamp;
const ease = (x: number) => { const v = clamp(x, 0, 1); return v * v * v * (v * (v * 6 - 15) + 10); };

function randomSource() {
  let seed = 872341;
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
}

function shellPosition(angle: number, shell: number): THREE.Vector3 {
  const radius = [0.65, 1.05, 1.47][shell];
  const tilt = [0.52, -0.64, 0.88][shell], turn = shell * 0.9;
  const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius * Math.cos(tilt);
  return new THREE.Vector3(x * Math.cos(turn) - y * Math.sin(turn),
    x * Math.sin(turn) + y * Math.cos(turn), Math.sin(angle) * radius * Math.sin(tilt));
}

function boltTarget(count: number, level: number): Float32Array {
  const random = randomSource();
  const branches: THREE.Vector3[][] = [];
  const bolts = level === 2 ? 5 : 1;
  for (let b = 0; b < bolts; b++) {
    const center = bolts === 1 ? 0 : (b - 2) * 0.53;
    const stroke: THREE.Vector3[] = [];
    for (let j = 0; j < 11; j++) {
      stroke.push(new THREE.Vector3(center + (random() - 0.5) * 0.56 + Math.sin(j * 1.7) * 0.17,
        1.5 - j * 0.3, (random() - 0.5) * 0.12));
    }
    branches.push(stroke);
    const forks = level === 0 ? 0 : level === 1 ? 2 : 5;
    for (let f = 0; f < forks; f++) {
      const origin = stroke[2 + Math.floor(random() * 6)];
      const side = f % 2 === 0 ? 1 : -1;
      branches.push([origin.clone(), origin.clone().add(new THREE.Vector3(side * 0.32, -0.18, 0.03)),
        origin.clone().add(new THREE.Vector3(side * 0.48, -0.51, 0)),
        origin.clone().add(new THREE.Vector3(side * 0.77, -0.8, -0.04))]);
    }
  }
  const result = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const branch = branches[Math.floor(random() * branches.length)];
    const at = random() * (branch.length - 1), index = Math.floor(at);
    const point = branch[index].clone().lerp(branch[Math.min(index + 1, branch.length - 1)], at - index);
    const spread = random() < 0.84 ? 0.016 : 0.085;
    result.set([point.x + (random() - 0.5) * spread, point.y + (random() - 0.5) * spread,
      point.z + (random() - 0.5) * spread], i * 3);
  }
  return result;
}

// All choreography is a pure function of the supplied story position; time only
// advances electrons and very small ambient movement. No private animation loop.
const pointVertex = /* glsl */ `
precision highp float;
attribute vec3 aPos1, aPos2, aPos3, aSheet, aSeed, aRole;
attribute vec3 aBolt0, aBolt1, aBolt2;
attribute vec4 aLight;
uniform float uTime, uOrbitTime, uFrom, uTo, uMix, uLevel;
uniform float uSize, uProtonSize, uArgonScale, uScale, uLift, uFlashWidth, uSheetCenter, uLandscape;
varying vec3 vColor;
varying float vAlpha, vSolid;
${carbonDeformation}
float ease(float x) { x=clamp(x,0.0,1.0); return x*x*x*(x*(x*6.0-15.0)+10.0); }
vec3 dust() { return vec3((aSeed.x-0.5)*4.1,(aSeed.y-0.5)*3.0,(aSeed.z-0.5)*2.0); }
vec3 orbit(float id) {
  float n=aRole.y;
  float shell=id<1.5?0.0:(id<2.5?(n<2.0?0.0:(n<10.0?1.0:2.0)):(n<2.0?0.0:1.0));
  float population=id<1.5?1.0:(shell<0.5?2.0:(id<2.5?8.0:4.0));
  float slot=n-(shell<0.5?0.0:(shell<1.5?2.0:10.0));
  // Speed varies gently; the tiny trailing samples follow the same orbit.
  bool argon=id>1.5 && id<2.5;
  float clock=(argon?uOrbitTime:uTime)-aRole.z*0.012;
  float speed=id<1.5?3.6:(1.8-shell*0.3);
  float angle=slot/population*6.2831853+shell*0.23+clock*speed+0.08*sin(clock*0.7);
  float radius=id<1.5?0.83:(shell<0.5?0.65:(shell<1.5?1.05:1.47));
  float tilt=shell<0.5?0.52:(shell<1.5?-0.64:0.88);
  vec3 p=vec3(cos(angle)*radius,sin(angle)*radius*cos(tilt),sin(angle)*radius*sin(tilt));
  float turn=shell*0.9;
  p.xy=mat2(cos(turn),sin(turn),-sin(turn),cos(turn))*p.xy;
  return p;
}
vec3 bolt() {
  return mix(mix(aBolt0,aBolt1,ease(uLevel)),aBolt2,ease(uLevel-1.0))*vec3(uFlashWidth,1.0,1.0);
}
float lightAt(float id) {
  if(id<0.5) return aLight.x;
  if(id<1.5) return aLight.y;
  if(id<2.5) return aLight.z;
  return aLight.w;
}
vec3 target(float id, float sheet) {
  if(id<0.5) return bolt();
  vec3 p=id<1.5?aPos1:(id<2.5?aPos2:aPos3);
  if(id<1.5 && aRole.x>2.5) {
    p*=1.0+${glslFloat(DETAIL.cloudBreath)}*(sin(uTime*0.9+aSeed.x*6.2831853)-sin(aSeed.x*6.2831853));
    float turn=uTime*${glslFloat(DETAIL.cloudTurnSpeed)};
    p.xz=mat2(cos(turn),sin(turn),-sin(turn),cos(turn))*p.xz;
  }
  if(aRole.x>1.5 && aRole.x<2.5 && lightAt(id)>0.05) p=orbit(id);
  // Shell-guide membership is independent of carbon's reused particle roles.
  if(id>1.5 && id<2.5 && aLight.z>0.05) p*=uArgonScale;
  if(id>2.5) {
    p=mix(p,aSheet,sheet);
    p.y-=uSheetCenter*sheet;
    p=mix(p,carbonPlate(p,uTime),sheet);
  }
  return p;
}
void main() {
  float travel=uTo-uFrom>0.5?1.0:0.0;
  float settle=ease((uMix-0.6)/0.4);
  // First a complete carbon atom; then copies and bonds spread during the
  // first half of the settle. At an integer stop the sheet is fully built.
  float sheet=travel>0.5?ease((uMix-0.665)/0.135):1.0;
  float oldLight=lightAt(uFrom), nextLight=lightAt(uTo);
  vec3 p=target(uFrom,1.0);
  float light=oldLight;
  if(travel>0.5) {
    float theta=aSeed.x*6.2831853;
    vec3 edge=vec3(cos(theta)*2.65,sin(theta)*1.8,(aSeed.z-0.5)*1.6);
    // Quadratic Bezier arrivals: anticipation, curved stream, eased impact.
    vec3 control=vec3(-sin(theta)*1.4,cos(theta)*1.15,0.7);
    float trail=aRole.x<2.5?aRole.z:0.0;
    float g=ease((uMix-0.035-trail*0.008)/(0.415-trail*0.008));
    vec3 arrival=(1.0-g)*(1.0-g)*edge+2.0*(1.0-g)*g*control;
    float release=ease(uMix/0.25);
    vec3 outgoing=mix(target(uFrom,1.0),edge,release);
    float incoming=ease(uMix/0.12);
    p=mix(outgoing,arrival,incoming);
    light=mix(oldLight*(1.0-release),nextLight,incoming);
    if(uMix>=0.6) {
      vec3 destination=target(uTo,sheet);
      // Monotonic, critically damped-style settle: no overshoot.
      float atomSettle=uTo>2.5?ease((uMix-0.6)/0.065):settle;
      float expand=atomSettle;
      if(uTo>2.5 && aRole.x>2.5) expand=sheet;
      p=destination*expand;
    }
    if(aRole.x>2.5) {
      // Filler stays local dust, except the destination cloud/sheet reveal.
      float reveal=uTo>2.5?sheet:settle;
      vec3 dispersed=mix(target(uFrom,1.0),dust(),release);
      if(uTo>2.5 && nextLight>0.05) {
        p=mix(dispersed,(aSheet-vec3(0.0,uSheetCenter,0.0))*sheet,ease(uMix/0.25));
        light=mix(oldLight, nextLight*sheet, ease(uMix/0.25));
      } else {
        p=mix(dispersed,target(uTo,sheet),reveal);
        light=mix(mix(oldLight,0.025,release),nextLight,reveal);
      }
    }
  }
  float id=travel>0.5?uTo:uFrom;
  bool physical=aRole.x<2.5;
  vSolid=physical && aRole.x<1.5?1.0:0.0;
  // Linear-light equivalents of #d96570 and #4285f4 for OutputPass.
  vec3 proton=vec3(0.694,0.132,0.162);
  vec3 neutron=vec3(0.48,0.43,0.57);
  vec3 electron=mix(vec3(0.054,0.235,0.905),vec3(1.0),0.10);
  vColor=aRole.x<0.5?proton:(aRole.x<1.5?neutron:electron);
  if(aRole.x>2.5) vColor=vec3(0.054,0.235,0.905);
  float sphereSize=physical?(aRole.x<1.5?4.6:1.9):0.9;
  if(id>2.5 && aRole.x>2.5) {
    vColor=mix(vec3(0.12,0.34,1.0),vec3(0.44,0.25,0.95),0.5+0.5*sin(aRole.y*2.4))*1.8;
    sphereSize=aRole.z<0.5?${glslFloat(CARBON.atomHeadSize)}:0.95;
    vSolid=aRole.z<0.5?1.0:0.0;
    light*=(travel>0.5?sheet:1.0);
  }
  if(id>2.5 && physical) sphereSize=mix(sphereSize,aRole.x<1.5?1.45:0.85,sheet);
  if(id>2.5 && aLight.w>0.05) {
    // A little more weight survives projection without enlarging the sheet
    // footprint or changing the phone plate. Dust keeps its existing falloff.
    float contrast=uLandscape*(travel>0.5?sheet:1.0);
    bool bond=aRole.x>5.5;
    sphereSize*=1.0+contrast*(bond?0.65:0.22);
    vColor*=1.0+contrast*(bond?0.30:0.18);
    if(bond) light*=1.0+contrast*0.25;
  }
  if(id<0.5) {
    // The bolt is the same round role-coloured particles as the atoms, not
    // a white stroke. Shared carbon/nucleus particles keep their species.
    float species=physical?aRole.x:(aRole.x<5.5?aRole.x-3.0:
      (aSeed.y<0.22?0.0:(aSeed.y<0.44?1.0:2.0)));
    vColor=species<0.5?proton:(species<1.5?neutron:electron);
    sphereSize=species<1.5?1.35:1.05;
    vSolid=species<1.5?0.45:0.0;
    vColor*=1.6;
    // A few blue-white electrons spark just off the dense bolt. Each follows
    // its own eased short arc, fading to zero before its phase resets.
    if(species>1.5 && aSeed.z>0.90) {
      float phase=fract(uTime*1.15+aSeed.x);
      float arc=ease(phase);
      float side=aSeed.y<0.72?-1.0:1.0;
      p+=vec3(side*0.12*arc*uFlashWidth,sin(phase*3.14159265)*0.045,0.02*arc);
      light*=pow(sin(phase*3.14159265),2.0);
      sphereSize=1.5;
    }
    light*=0.97+0.03*sin(uTime*17.0+aSeed.x*3.0)*sin(uTime*9.0);
  }
  if(physical && aRole.z>0.0) light*=0.22/(1.0+aRole.z);
  // Unused proton/neutron/electron identities become faint, stationary dust.
  if(physical && nextLight<0.05 && travel>0.5) {
    float release=ease(uMix/0.25);
    p=mix(target(uFrom,1.0),dust(),release);
    light=mix(oldLight,0.018,release);
  }
  float hydrogen=travel>0.5 ?
    (uTo>0.5 && uTo<1.5?settle:(uFrom>0.5 && uFrom<1.5?1.0-ease(uMix/0.25):0.0)) :
    (id>0.5 && id<1.5?1.0:0.0);
  if(aRole.x<0.5 && aRole.y<0.5) vColor*=1.0+hydrogen*2.2;
  if(!physical) {
    // Larger, luminous 1s samples retain the exponential radial density.
    sphereSize=mix(sphereSize,1.9,hydrogen);
    vColor*=1.0+hydrogen*1.6;
    light*=1.0+hydrogen*0.025*sin(uTime*0.8+aSeed.y*6.2831853);
  }
  if(aRole.x>1.5 && aRole.x<2.5 && lightAt(id)>0.05) {
    vColor*=1.8;
    if(id>1.5 && id<2.5) {
      // Brightness belongs in RGB, not opacity: alpha > 1 under normal
      // blending subtracts the destination in the floating-point composer.
      vColor*=1.0+uLevel*0.45;
      light=aRole.z>0.0?0.0:1.0;
      vSolid=1.0;
      sphereSize=2.4; // round heads; argon deliberately has no trail samples
    }
  }
  if(id>1.5 && id<2.5 && aLight.z>0.05) {
    if(physical && aRole.x<1.5) sphereSize*=uArgonScale;
    if(!physical) light*=1.0+uLevel*0.25;
  }
  // Unused identities form dust, not a faint rectangular panel. Taper the
  // original box-distributed samples to zero before any coordinate boundary.
  float atmosphere=1.0;
  if(id>0.5 && lightAt(id)<0.05) {
    atmosphere=1.0-smoothstep(0.48,0.82,length(p.xy/vec2(2.05,1.5)));
  } else if(id>0.5 && id<1.5 && !physical) {
    atmosphere=1.0-smoothstep(0.95,1.42,length(p));
  }
  light*=mix(1.0,atmosphere,travel>0.5?settle:1.0);
  p*=uScale; p.y+=uLift;
  gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);
  float pointSize=uSize*sphereSize;
  if(aRole.x<0.5 && aRole.y<0.5) pointSize=mix(pointSize,uProtonSize,hydrogen);
  gl_PointSize=clamp(pointSize,1.0,64.0);
  vAlpha=light;
}`;

const pointFragment = /* glsl */ `
precision highp float;
varying vec3 vColor;
varying float vAlpha, vSolid;
void main() {
  vec2 p=(gl_PointCoord-0.5)*2.0;
  float rr=dot(p,p);
  if(rr>=0.8464) discard;
  float glow=exp(-rr*4.0)*(1.0-smoothstep(0.58,0.92,sqrt(rr)));
  float sphere=sqrt(max(0.0,1.0-rr));
  float shade=0.46+0.54*clamp(dot(vec3(p,sphere),normalize(vec3(-0.4,0.6,1.0))),0.0,1.0);
  // One soft sprite for every scene: shaded nucleus cores and a luminous
  // feathered rim, with the same light falloff on electrons and bond samples.
  vec3 color=mix(vColor*1.9,vColor*(shade+0.38*glow),vSolid);
  float alpha=mix(glow,1.0-smoothstep(0.65,0.92,sqrt(rr)),vSolid);
  gl_FragColor=vec4(color,clamp(alpha*vAlpha,0.0,1.0));
}`;

// The original programs above remain the fallback, including their stop plates.
// Smooth model samples avoid changing colour/size/visibility at either endpoint.
const journeyVertex = pointVertex.slice(0, pointVertex.indexOf('void main()')) + /* glsl */ `
${evolvingNoise}
void sampleModel(float id, out vec3 p, out vec3 color, out float size,
                 out float light, out float solid) {
  p=target(id,1.0); light=lightAt(id);
  bool physical=aRole.x<2.5;
  vec3 proton=vec3(0.694,0.132,0.162), neutron=vec3(0.48,0.43,0.57);
  vec3 electron=mix(vec3(0.054,0.235,0.905),vec3(1.0),0.10);
  color=aRole.x<0.5?proton:(aRole.x<1.5?neutron:electron);
  if(!physical) color=vec3(0.054,0.235,0.905);
  size=physical?(aRole.x<1.5?4.6:1.9):0.9;
  solid=physical && aRole.x<1.5?1.0:0.0;
  if(id>2.5 && light>0.05) {
    if(!physical) color=aRole.x<3.5?proton:(aRole.x<4.5?neutron:electron);
    bool nucleus=physical?aRole.x<1.5:aRole.x<4.5;
    size=nucleus?1.45:0.85; solid=nucleus?1.0:0.0;
    bool bond=aRole.x>5.5;
    size*=1.0+uLandscape*(bond?0.65:0.22);
    color*=1.0+uLandscape*(bond?0.30:0.18);
    if(bond) light*=1.0+uLandscape*0.25;
    color=mix(vec3(0.12,0.34,1.0),vec3(0.44,0.25,0.95),0.5+0.5*sin(aRole.y*2.4))*1.8;
    size=aRole.z<0.5?${glslFloat(CARBON.atomHeadSize)}:0.95;
    solid=aRole.z<0.5?1.0:0.0;
  }
  if(id<0.5) {
    float species=physical?aRole.x:(aRole.x<5.5?aRole.x-3.0:
      (aSeed.y<0.22?0.0:(aSeed.y<0.44?1.0:2.0)));
    color=(species<0.5?proton:(species<1.5?neutron:electron))*1.6;
    size=species<1.5?1.35:1.05; solid=species<1.5?0.45:0.0;
    // Local channel turbulence evolves without translating the bolt.
    float turbulence=noise3(vec3(p.y*${glslFloat(DETAIL.boltFineScale)},aSeed.z*3.0,uTime*${glslFloat(DETAIL.boltFineSpeed)}));
    p.x+=(turbulence-0.5)*${glslFloat(DETAIL.boltWander)}*uFlashWidth;
    float pulse=noise3(vec3(p.y*${glslFloat(DETAIL.boltPulseScale)},aSeed.z,uTime*${glslFloat(DETAIL.boltPulseSpeed)}));
    light*=1.0-${glslFloat(DETAIL.boltFlicker)} + ${glslFloat(DETAIL.boltFlicker)}*pulse;
    if(species>1.5 && aSeed.z>0.90) {
      float phase=fract(uTime*1.15+aSeed.x);
      float arc=ease(phase), side=aSeed.y<0.72?-1.0:1.0;
      p+=vec3(side*0.12*arc*uFlashWidth,sin(phase*3.14159265)*0.045,0.02*arc);
      light*=pow(sin(phase*3.14159265),2.0); size=1.5;
    }
  }
  if(physical && aRole.z>0.0) light*=0.22/(1.0+aRole.z);
  if(id>0.5 && id<1.5) {
    if(aRole.x<0.5 && aRole.y<0.5) { color*=3.2; size=uProtonSize/uSize; }
    if(!physical) {
      size=1.9; color*=2.6;
      light*=1.0+0.14*sin(uTime*1.4+aSeed.y*6.2831853);
    }
  }
  if(aRole.x>1.5 && aRole.x<2.5 && lightAt(id)>0.05) {
    color*=1.8;
    if(id>1.5 && id<2.5) {
      color*=1.0+uLevel*0.45; light=aRole.z>0.0?0.0:1.0;
      solid=1.0; size=2.4;
    }
  }
  if(id>1.5 && id<2.5 && lightAt(id)>0.05) {
    if(physical && aRole.x<1.5) size*=uArgonScale;
    if(!physical) light*=1.0+uLevel*0.25;
  }
  if(id>0.5 && lightAt(id)<0.05)
    light*=1.0-smoothstep(0.48,0.82,length(p.xy/vec2(2.05,1.5)));
  else if(id>0.5 && id<1.5 && !physical)
    light*=1.0-smoothstep(0.95,1.42,length(p));
  // Back samples are dimmer and slightly smaller; front/back species stay clear.
  float depth=exp(-max(0.0,-p.z)*${glslFloat(DETAIL.depthFalloff)});
  light*=depth; size*=mix(0.88,1.04,smoothstep(-1.5,1.5,p.z));
}
void main() {
  vec3 a,b,ca,cb; float sa,sb,la,lb,va,vb;
  sampleModel(uFrom,a,ca,sa,la,va);
  if(uFrom==uTo) { b=a; cb=ca; sb=sa; lb=la; vb=va; }
  else sampleModel(uTo,b,cb,sb,lb,vb);
  // Per-particle delays have zero slope at the endpoints, including reverse scrub.
  float delay=aSeed.x*${glslFloat(DETAIL.morphDelay)};
  float g=uFrom==uTo?0.0:ease((uMix-delay)/(1.0-${glslFloat(DETAIL.morphDelay)}));
  vec3 p=mix(a,b,g);
  float arc=16.0*g*g*(1.0-g)*(1.0-g);
  vec3 bend=vec3(aSeed.y-0.5,aSeed.z-0.5,0.6+aSeed.x)*${glslFloat(DETAIL.morphArc)};
  p+=bend*arc;
  // A soft dissolve through travelling dust keeps all identities continuous.
  float dissolve=1.0-${glslFloat(DETAIL.morphDissolve)}*arc;
  vColor=mix(ca,cb,g); vSolid=mix(va,vb,g);
  vAlpha=mix(la,lb,g)*dissolve;
  p*=uScale; p.y+=uLift;
  vec4 view=modelViewMatrix*vec4(p,1.0);
  gl_Position=projectionMatrix*view;
  gl_PointSize=clamp(uSize*mix(sa,sb,g)*clamp(${glslFloat(FLIGHT.distance)}/max(0.1,-view.z),${glslFloat(DETAIL.perspectiveSizeMin)},${glslFloat(DETAIL.perspectiveSizeMax)}),1.0,64.0);
}`;

const journeyFragment = pointFragment.replace(
  'vColor*(shade+0.38*glow)',
  // A restrained broad highlight gives nucleus sprites roundness without clipping.
  `vColor*(shade+0.38*glow)+vec3(${glslFloat(DETAIL.highlight)})*pow(max(0.0,dot(vec3(p,sphere),normalize(vec3(-0.3,0.4,1.0)))),${glslFloat(DETAIL.highlightPower)})`,
);

export function create(): World {
  let renderer: THREE.WebGLRenderer | undefined;
  let composer: EffectComposer | undefined;
  let bloom: UnrealBloomPass | undefined;
  let observer: ResizeObserver | undefined;
  let scene: THREE.Scene | undefined;
  let camera: THREE.PerspectiveCamera | undefined;
  let opts: WorldOpts;
  let geometry: THREE.BufferGeometry;
  let material: THREE.ShaderMaterial;
  let background: THREE.ShaderMaterial;
  let plasmaHalo: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  let shellRings: THREE.Group;
  const shellMaterials: THREE.LineBasicMaterial[] = [];
  let plasma: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  let carbonBonds: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  let stageElement: HTMLElement;
  let count = 0, lastTime = 0, orbitTime = 0;
  let width = 1, height = 1, halfHeight = 2.1;
  let clearTop=0, clearBottom=0, clearRight=0, lastLayoutTime=-Infinity;
  // Each leg passes through the existing (0,0,8) stop viewpoint. Control
  // points make a shallow flight; eased parameterization lands with zero speed.
  const flights = names.slice(1).map((_,i)=> {
    const side=i%2===0?1:-1;
    return new THREE.CatmullRomCurve3([
      new THREE.Vector3(0,0,FLIGHT.distance),
      new THREE.Vector3(side*FLIGHT.lateral*0.65,FLIGHT.rise,FLIGHT.distance-FLIGHT.approach*0.5),
      new THREE.Vector3(side*FLIGHT.lateral,0,FLIGHT.distance-FLIGHT.approach),
      new THREE.Vector3(side*FLIGHT.lateral*0.45,-FLIGHT.rise,FLIGHT.distance-FLIGHT.approach*0.5),
      new THREE.Vector3(0,0,FLIGHT.distance),
    ],false,'centripetal');
  });
  const flightPoint=new THREE.Vector3();
  let shaderFailed=false, usingFallback=false;
  const shaderFallbacks: {material:THREE.ShaderMaterial; vertex:string; fragment:string}[]=[];
  const enhance=(m:THREE.ShaderMaterial,vertex:string,fragment:string)=>{
    shaderFallbacks.push({material:m,vertex:m.vertexShader,fragment:m.fragmentShader});
    Object.assign(m,shaderStages(vertex,fragment)); m.needsUpdate=true;
  };
  let carbonCenterY=0;
  // Bounds are projected at the stop distance, including the nearest depth.
  const subjectBounds=[{x:1.9,y:1.7},{x:1.60,y:1.60},{x:1.72,y:1.72},{x:1.4,y:1.4}];
  const subjectCenters=names.map(()=>({x:0,y:0}));
  const readClearRectangle=()=>{
    const style=getComputedStyle(stageElement);
    const fallback=opts.mobile?FRAMING.mobile:FRAMING.desktop;
    const inset=(name:string,value:number,limit:number)=>{
      const raw=style.getPropertyValue(name).trim();
      const parsed=raw===''?NaN:Number.parseFloat(raw);
      return clamp(Number.isFinite(parsed)?parsed:value,0,limit);
    };
    clearTop=inset('--clear-top',fallback.top,height-1);
    clearBottom=inset('--clear-bottom',fallback.bottom,height-clearTop-1);
    clearRight=inset('--clear-right',fallback.right,width-1);
    lastLayoutTime=lastTime;
  };
  // Frame the unchanged origin with an off-axis camera. Effort levels share a
  // single envelope, avoiding camera pumping when electrons or plasma speed up.
  const applyFraming=()=>{
    if(!camera) return;
    const from=material.uniforms.uFrom.value as number, to=material.uniforms.uTo.value as number;
    const mix=ease(material.uniforms.uMix.value as number);
    const clearWidth=width-clearRight, clearHeight=height-clearTop-clearBottom;
    const fit=(id:number)=>Math.max(subjectBounds[id].x*height/(clearWidth*FRAMING.fill),
      subjectBounds[id].y*height/(clearHeight*FRAMING.fill));
    halfHeight=THREE.MathUtils.lerp(fit(from),fit(to),mix);
    material.uniforms.uSheetCenter.value=carbonCenterY;
    const centerX=THREE.MathUtils.lerp(subjectCenters[from].x,subjectCenters[to].x,mix);
    const centerY=THREE.MathUtils.lerp(subjectCenters[from].y,subjectCenters[to].y,mix);
    const pixelsPerUnit=height/(halfHeight*2);
    camera.setViewOffset(width,height,clearRight/2+centerX*pixelsPerUnit,
      (clearBottom-clearTop)/2-centerY*pixelsPerUnit,width,height);
    if(renderer) {
      const size=clamp(pixelsPerUnit*0.025,2,5)*renderer.getPixelRatio();
      material.uniforms.uSize.value=size;
      plasma.material.uniforms.uSize.value=size;
    }
  };
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const ownedGeometry = <T extends THREE.BufferGeometry>(g: T): T => { geometries.push(g); return g; };
  const ownedMaterial = <T extends THREE.Material>(m: T): T => { materials.push(m); return m; };
  const ownedShader=(parameters:THREE.ShaderMaterialParameters)=>ownedMaterial(new THREE.ShaderMaterial({
    ...parameters, precision:'highp', glslVersion:THREE.GLSL3,
    ...shaderStages(parameters.vertexShader!,parameters.fragmentShader!),
  }));

  const world: World = {
    mount(el, options) {
      opts = options;
      stageElement=document.getElementById('stage')??el;
      count = QUALITY.particles / (opts.mobile ? 2 : 1);
      renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY.pixelRatio));
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = FLIGHT.exposure[0];
      renderer.debug.onShaderError = (_gl,_program,_vertex,_fragment)=>{
        shaderFailed=true;
        console.warn('[guide] Gemini shader failed; restoring original particle plates.');
      };
      renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;position:absolute;inset:0;pointer-events:none';
      renderer.domElement.setAttribute('aria-hidden', 'true');
      el.appendChild(renderer.domElement);
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(45,1,0.1,30);
      camera.position.z = FLIGHT.distance;

      background = ownedShader({
        depthTest: false, depthWrite: false,
        uniforms: { uTime: { value: 0 }, uAspect: { value: 1 } },
        vertexShader: `precision highp float; varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 1.0, 1.0); }`,
        fragmentShader: /* glsl */ `
          precision highp float;
          varying vec2 vUv;
          uniform float uTime, uAspect;
          float blob(vec2 p, vec2 center, vec2 shape) {
            vec2 d = (p - center) / shape;
            return exp(-dot(d,d) * 2.5);
          }
          void main() {
            vec2 p = vUv;
            float drift = uTime * 0.055;
            vec3 base = mix(vec3(0.00335,0.0103,0.0423), vec3(0.0065,0.0232,0.1248), p.y);
            vec2 shift = vec2(sin(drift), cos(drift) - 1.0) * 0.015;
            vec2 q = vec2((p.x - 0.5) * min(uAspect, 1.8) + 0.5, p.y);
            base += vec3(0.054,0.235,0.905) * blob(q, vec2(0.20,0.68) + shift, vec2(0.63,0.24)) * 0.27;
            base += vec3(0.328,0.168,0.597) * blob(q, vec2(0.64,0.75) - shift, vec2(0.48,0.30)) * 0.27;
            base += vec3(0.694,0.132,0.162) * blob(q, vec2(0.85,0.46) + shift, vec2(0.43,0.22)) * 0.13;
            base += vec3(0.905,0.456,0.0) * blob(q, vec2(0.29,0.36) - shift, vec2(0.45,0.19)) * 0.075;
            base *= 1.0 - 0.28 * smoothstep(0.3,0.8,length(p - 0.5));
            gl_FragColor = vec4(base,1.0);
          }`,
      });
      enhance(background,background.vertexShader,background.fragmentShader
        .replace('float blob(',`${evolvingNoise}\nfloat blob(`)
        .replace('base *= 1.0 - 0.28', `
          float n=noise3(vec3(q*vec2(4.0,7.0),uTime*${glslFloat(DETAIL.auroraSpeed)}));
          float fold=sin(q.x*10.0+n*2.0)*${glslFloat(DETAIL.auroraFold)};
          float curtain=exp(-pow((q.y-${glslFloat(DETAIL.auroraHeight)}-fold)/${glslFloat(DETAIL.auroraWidth)},2.0));
          float ray=pow(0.5+0.5*sin(q.x*${glslFloat(DETAIL.auroraRays)}+n*5.0),6.0);
          vec3 tint=mix(vec3(0.054,0.235,0.905),vec3(0.328,0.168,0.597),smoothstep(0.2,0.8,q.x));
          base+=tint*curtain*(0.22+0.78*ray)*${glslFloat(DETAIL.auroraStrength)};
          base *= 1.0 - 0.28`));
      const quad = new THREE.Mesh(ownedGeometry(new THREE.PlaneGeometry(2, 2)), background);
      quad.frustumCulled = false;
      quad.renderOrder = -10;
      scene.add(quad);

      const random = randomSource();
      const targets = [boltTarget(count, 0), new Float32Array(count * 3), new Float32Array(count * 3), new Float32Array(count * 3)];
      const seeds = new Float32Array(count * 3), lights = new Float32Array(count * 4);
      const roles = new Float32Array(count * 3), sheet = new Float32Array(count * 3);
      const plasmaCount=QUALITY.plasma/(opts.mobile?2:1);
      const plasmaPositions=new Float32Array(plasmaCount*3);
      const atoms: THREE.Vector3[] = [], bonds: [THREE.Vector3, THREE.Vector3][] = [];
      const unique = new Map<string, THREE.Vector3>(), edges = new Set<string>();
      const side = 0.38;
      // A bounded honeycomb fits above the phone caption. Shared vertices and
      // edges are deduplicated, so the interior has three bonds per atom.
      for (let row = -1; row <= 1; row++) for (let col = -1; col <= 1; col++) {
        const cx = col * side * 1.5, cy = (row + (Math.abs(col) % 2) * 0.5) * side * Math.sqrt(3);
        const ring: THREE.Vector3[] = [];
        for (let k = 0; k < 6; k++) {
          const p = new THREE.Vector3(cx + side * Math.cos(k * TAU / 6), cy + side * Math.sin(k * TAU / 6), 0);
          const key = `${p.x.toFixed(4)},${p.y.toFixed(4)}`;
          if (!unique.has(key)) unique.set(key, p);
          ring.push(unique.get(key)!);
        }
        for (let k = 0; k < 6; k++) {
          const a = ring[k], b = ring[(k + 1) % 6];
          const key = [a.toArray().join(','), b.toArray().join(',')].sort().join('/');
          if (!edges.has(key)) { edges.add(key); bonds.push([a, b]); }
        }
      }
      atoms.push(...unique.values());
      const center = atoms.reduce((best, atom) => atom.lengthSq()<best.lengthSq()?atom:best,atoms[0]);
      const core = (n: number, population: number, spacing: number): number[] => {
        // Fibonacci ball, with interleaved species sharing one compact cluster.
        const z = 1 - 2 * (n + 0.5) / population, angle = n * 2.39996323;
        const radius = spacing * Math.cbrt((n + 0.5) / population);
        return [Math.cos(angle)*Math.sqrt(1-z*z)*radius, Math.sin(angle)*Math.sqrt(1-z*z)*radius, z*radius];
      };
      for (let i = 0; i < count; i++) {
        const a = random(), b = random(), c = random();
        seeds.set([a, b, c], i * 3);
        // Trail samples share their electron's path, offset only in phase.
        if(i>=58 && i<112) seeds.set(seeds.subarray((40+(i-40)%18)*3,(41+(i-40)%18)*3),i*3);
        const dust = [(a - 0.5) * 4.1, (b - 0.5) * 3, (c - 0.5) * 2];
        // 18 protons, 22 neutrons, 18 electrons plus three trail samples each.
        const physical = i < 112;
        const role = i < 18 ? 0 : i < 40 ? 1 : physical ? 2 : 6;
        const slot = i < 18 ? i : i < 40 ? i - 18 : (i - 40) % 18;
        const trail = i < 58 ? 0 : Math.floor((i - 40) / 18);
        roles.set([role, slot, physical ? trail : 0], i * 3);
        const h = (role === 0 && slot === 0) || (role === 2 && slot === 0);
        const carbon = slot < 6;
        targets[1].set(physical ? (h ? [0, 0, 0] : dust) : dust, i * 3);
        targets[2].set(physical ? (role < 2 ? core(role === 0 ? slot * 2 : slot * 2 + 1, 44, 0.31) : [0,0,0]) : dust, i * 3);
        targets[3].set(physical && carbon ? (role < 2 ? core(slot * 2 + role, 12, 0.22) : [0,0,0]) : dust, i * 3);
        sheet.set(physical ? (carbon ? [0,0,0] : dust) : dust, i * 3);
        lights.set([0.65, physical ? (h ? 1 : 0.018) : 0.025,
          physical ? 1 : 0.025, physical ? (carbon ? 1 : 0.018) : 0.025], i * 4);
        if (!physical) {
          const local = i - 112;
          // Visible probability samples are distinct from the single electron.
          const z = random() * 2 - 1, angle = random() * TAU;
          const radius = Math.min(1.6, -0.20 * Math.log(Math.max(1e-9, random()*random()*random())));
          targets[1].set([Math.cos(angle)*Math.sqrt(1-z*z)*radius, Math.sin(angle)*Math.sqrt(1-z*z)*radius,z*radius],i*3);
          lights[i*4+1] = 0.32 * (1-radius/1.8);
          // Dense Fibonacci balls, each with a shaded luminous head. Phone
          // clusters use exactly half the samples; bonds have their own mesh.
          const samplesPerAtom=CARBON.samplesPerAtom/(opts.mobile?2:1);
          const atomSamples = atoms.length * samplesPerAtom;
          if (local < atomSamples) {
            const atomIndex=Math.floor(local/samplesPerAtom);
            const atom=atoms[atomIndex], part=local%samplesPerAtom;
            roles.set([3,atomIndex,part],i*3);
            const offset=part===0?[0,0,0]:core(part-1,samplesPerAtom-1,CARBON.atomRadius);
            sheet.set([atom.x+offset[0],atom.y+offset[1],offset[2]],i*3);
            lights[i*4+3]=part===0?1:0.48;
          } else {
            lights[i*4+3]=0.0;
          }
          // Shells use continuous LineLoops below; these shared cloud/sheet
          // particles remain faint argon dust rather than dotted ring sprites.
        }
        // The original carbon atom becomes the nearest central sheet atom.
        if (physical && carbon) {
          const offset = role < 2 ? core(slot*2+role,12,0.047) : [Math.cos(slot*TAU/6)*0.095,Math.sin(slot*TAU/6)*0.095,0.025];
          sheet.set([center.x+offset[0],center.y+offset[1],offset[2]],i*3);
        }
        // The central sheet atom now has the same dense budget as every copy.
        if(physical) lights[i*4+3]=0.0;
        if(i<plasmaCount) {
          // A hollow spherical distribution keeps the discharge inside the
          // outer shell; the nucleus remains the clear, unobscured centre.
          const angle=random()*TAU, z=random()*2-1;
          const radius=0.42+Math.cbrt(random())*0.9, radial=Math.sqrt(1-z*z);
          plasmaPositions.set([Math.cos(angle)*radial*radius,Math.sin(angle)*radial*radius,z*radius],i*3);
        }
      }
      geometry = ownedGeometry(new THREE.BufferGeometry());
      geometry.setAttribute('position', new THREE.BufferAttribute(targets[0], 3));
      // Draw cloud and guides first, then the nucleus and electron heads so
      // luminous filler cannot obscure the recognisable physical particles.
      geometry.setIndex([...Array.from({length:count-112},(_,i)=>i+112),
        ...Array.from({length:54},(_,i)=>i+58), ...Array.from({length:58},(_,i)=>i)]);
      for (let i=1;i<4;i++) geometry.setAttribute(`aPos${i}`,new THREE.BufferAttribute(targets[i],3));
      geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
      geometry.setAttribute('aLight', new THREE.BufferAttribute(lights, 4));
      geometry.setAttribute('aRole', new THREE.BufferAttribute(roles, 3));
      geometry.setAttribute('aSheet', new THREE.BufferAttribute(sheet, 3));
      for(let i=0;i<3;i++) geometry.setAttribute(`aBolt${i}`,new THREE.BufferAttribute(boltTarget(count,i),3));
      // Include every flash build, plus spark/idle margins, in its fit. Carbon
      // uses only live atoms/bonds; leftover dust must not shrink the subject.
      let flashMinX=Infinity,flashMaxX=-Infinity,flashMinY=Infinity,flashMaxY=-Infinity;
      for(let level=0;level<3;level++) {
        const positions=geometry.getAttribute(`aBolt${level}`);
        for(let i=0;i<count;i++) {
          flashMinX=Math.min(flashMinX,positions.getX(i));flashMaxX=Math.max(flashMaxX,positions.getX(i));
          flashMinY=Math.min(flashMinY,positions.getY(i));flashMaxY=Math.max(flashMaxY,positions.getY(i));
        }
      }
      subjectCenters[0]={x:(flashMinX+flashMaxX)/2,y:(flashMinY+flashMaxY)/2};
      subjectBounds[0]={x:(flashMaxX-flashMinX)/2+0.16,y:(flashMaxY-flashMinY)/2+0.10};
      let carbonMinY=Infinity,carbonMaxY=-Infinity;
      for(let i=0;i<count;i++) if(lights[i*4+3]>0.05) {
        carbonMinY=Math.min(carbonMinY,sheet[i*3+1]);
        carbonMaxY=Math.max(carbonMaxY,sheet[i*3+1]);
      }
      carbonCenterY=(carbonMinY+carbonMaxY)/2;
      // Sample the full slow-motion envelope once, including perspective.
      // Camera framing then stays steady as the sheet rocks and ripples.
      subjectBounds[3]={x:0,y:0};
      for(let clock=0;clock<=120;clock+=0.5) for(const atom of atoms) {
        const tilt=CARBON.tilt+Math.sin(clock*CARBON.tiltSpeed)*CARBON.tiltSwing;
        const yaw=CARBON.yaw+Math.sin(clock*CARBON.yawSpeed)*CARBON.yawSwing;
        const turn=CARBON.turn+Math.sin(clock*CARBON.turnSpeed)*CARBON.turnSwing;
        const y0=atom.y-carbonCenterY;
        const z0=Math.sin(clock*CARBON.rippleSpeed+atom.x*1.8+y0*1.2)*CARBON.rippleHeight;
        const y1=Math.cos(tilt)*y0-Math.sin(tilt)*z0;
        const z1=Math.sin(tilt)*y0+Math.cos(tilt)*z0;
        const x2=Math.cos(yaw)*atom.x-Math.sin(yaw)*z1;
        const z2=Math.sin(yaw)*atom.x+Math.cos(yaw)*z1;
        const x3=Math.cos(turn)*x2-Math.sin(turn)*y1;
        const y3=Math.sin(turn)*x2+Math.cos(turn)*y1;
        const perspective=FLIGHT.distance/(FLIGHT.distance-z2);
        subjectBounds[3].x=Math.max(subjectBounds[3].x,Math.abs(x3)*perspective+CARBON.boundsPadding);
        subjectBounds[3].y=Math.max(subjectBounds[3].y,Math.abs(y3)*perspective+CARBON.boundsPadding);
      }
      material = ownedShader({
        transparent: true, depthWrite: false, depthTest: false,
        uniforms: {
          uTime: { value: 0 }, uOrbitTime: { value: 0 }, uFrom: { value: 0 }, uTo: { value: 0 }, uMix: { value: 0 },
          uLevel: { value: 0 },
          uSize: { value: 3 }, uFlashWidth: { value: 1 }, uSheetCenter: { value: 0 }, uLandscape: { value: 0 }, uProtonSize: { value: 20 }, uArgonScale: { value: 1 }, uScale: { value: 1 }, uLift: { value: 0 },
        }, vertexShader: pointVertex, fragmentShader: pointFragment,
      });
      enhance(material,journeyVertex,journeyFragment);
      const points = new THREE.Points(geometry, material);
      points.frustumCulled = false;
      points.renderOrder = 2;
      scene.add(points);
      // Continuous thin tubes replace the dashed point bonds. A second soft
      // tube is a desktop-only halo, merged into the same draw call.
      const bondPositions:number[]=[], bondFlow:number[]=[], bondGlow:number[]=[], bondIndices:number[]=[];
      const bondSides=CARBON.bondSides/(opts.mobile?2:1);
      for(const [start,end] of bonds) {
        const direction=end.clone().sub(start).normalize();
        const across=new THREE.Vector3(-direction.y,direction.x,0);
        for(let layer=0;layer<(opts.mobile?1:2);layer++) {
          const base=bondPositions.length/3, radius=CARBON.bondRadius*(layer===0?1:CARBON.haloRadius);
          for(let endIndex=0;endIndex<2;endIndex++) for(let sideIndex=0;sideIndex<bondSides;sideIndex++) {
            const point=(endIndex===0?start:end).clone();
            const angle=sideIndex/bondSides*TAU;
            point.addScaledVector(across,Math.cos(angle)*radius);
            point.z+=Math.sin(angle)*radius;
            bondPositions.push(point.x,point.y-carbonCenterY,point.z);
            bondFlow.push((endIndex===0?start:end).x*2.6+((endIndex===0?start:end).y-carbonCenterY)*1.9);
            bondGlow.push(layer===0?1:0.12);
          }
          for(let sideIndex=0;sideIndex<bondSides;sideIndex++) {
            const next=(sideIndex+1)%bondSides;
            bondIndices.push(base+sideIndex,base+next,base+bondSides+sideIndex,
              base+next,base+bondSides+next,base+bondSides+sideIndex);
          }
        }
      }
      const bondGeometry=ownedGeometry(new THREE.BufferGeometry());
      bondGeometry.setAttribute('position',new THREE.Float32BufferAttribute(bondPositions,3));
      bondGeometry.setAttribute('aFlow',new THREE.Float32BufferAttribute(bondFlow,1));
      bondGeometry.setAttribute('aGlow',new THREE.Float32BufferAttribute(bondGlow,1));
      bondGeometry.setIndex(bondIndices);
      const bondMaterial=ownedShader({
        transparent:true,depthTest:false,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,
        uniforms:{uTime:material.uniforms.uTime,uWeight:{value:0}},
        vertexShader:`precision highp float;
          attribute float aFlow,aGlow; uniform float uTime; varying float vFlow,vGlow;
          ${carbonDeformation}
          void main(){vFlow=aFlow;vGlow=aGlow;
            gl_Position=projectionMatrix*modelViewMatrix*vec4(carbonPlate(position,uTime),1.0);}`,
        fragmentShader:`precision highp float; uniform float uTime,uWeight; varying float vFlow,vGlow;
          void main(){float pulse=0.0;
            vec3 color=mix(vec3(0.12,0.32,1.0),vec3(0.66,0.38,1.0),pulse);
            gl_FragColor=vec4(color*(1.5+pulse*2.2),uWeight*vGlow*(0.65+pulse*0.35));}`,
      });
      enhance(bondMaterial,bondMaterial.vertexShader,bondMaterial.fragmentShader.replace('float pulse=0.0;',
        `float pulse=pow(0.5+0.5*cos(vFlow-uTime*${glslFloat(CARBON.pulseSpeed)}),${glslFloat(CARBON.pulseSharpness)});`));
      carbonBonds=new THREE.Mesh(bondGeometry,bondMaterial);
      carbonBonds.visible=false;carbonBonds.frustumCulled=false;carbonBonds.renderOrder=1.8;
      scene.add(carbonBonds);
      shellRings = new THREE.Group();
      for (let shell = 0; shell < 3; shell++) {
        const samples = QUALITY.ringSamples/(opts.mobile?2:1);
        const ringGeometry = ownedGeometry(new THREE.BufferGeometry().setFromPoints(
          Array.from({length:samples}, (_,i)=>shellPosition(i/samples*TAU,shell))));
        const ringMaterial = ownedMaterial(new THREE.LineBasicMaterial({
          color:0x739fff, transparent:true, opacity:0.5, depthTest:false, depthWrite:false,
        }));
        shellMaterials.push(ringMaterial);
        const ring = new THREE.LineLoop(ringGeometry,ringMaterial);
        ring.renderOrder=1.5; ring.frustumCulled=false;
        shellRings.add(ring);
      }
      scene.add(shellRings);
      // Plasma owns a separate draw, behind the atom. It never repurposes the
      // shell-guide or electron buffers, even at maximum discharge intensity.
      const plasmaGeometry=ownedGeometry(new THREE.BufferGeometry());
      plasmaGeometry.setAttribute('position',new THREE.BufferAttribute(plasmaPositions,3));
      const plasmaMaterial=ownedShader({
        transparent:true, depthTest:false, depthWrite:false, blending:THREE.AdditiveBlending,
        uniforms:{uTime:{value:0},uDischarge:{value:0},uLevel:{value:0},uSize:{value:3},uScale:{value:1},uLift:{value:0}},
        vertexShader:`precision highp float; uniform float uTime,uDischarge,uLevel,uSize,uScale,uLift;
          varying vec3 vColor; varying float vAlpha,vSolid;
          void main(){vec3 p=position;
            float seed=dot(position,vec3(7.1,13.7,19.3));
            float clock=uTime*(0.4+fract(seed)*0.35);
            // Independent short curls, under 3% of the atom diameter. There
            // is no translating slab, shared slide, or moving outer boundary.
            p+=vec3(sin(clock+seed),cos(clock*0.83+seed*1.7),sin(clock*0.67-seed))*0.045;
            float wave=0.9+0.1*sin(clock*2.0+seed);
            vColor=mix(vec3(0.20,0.055,0.64),vec3(0.42,0.18,0.92),uLevel/2.0)*(1.2+uLevel*0.22);
            float clearCore=smoothstep(0.32,0.50,length(p.xy));
            float edge=1.0-smoothstep(0.94,1.20,length(p));
            vAlpha=uDischarge*(0.06+uLevel*0.045)*wave*clearCore*edge;vSolid=0.0;
            p*=uScale;p.y+=uLift;
            gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);gl_PointSize=uSize*1.25;}`,
        fragmentShader:pointFragment,
      });
      enhance(plasmaMaterial,plasmaMaterial.vertexShader
        .replace('void main(){vec3 p=position;',`${evolvingNoise}
          void main(){vec3 p=position;`)
        .replace('float wave=0.9+0.1*sin(clock*2.0+seed);',`
          vec3 drift=vec3(sin(uTime*0.31),cos(uTime*0.27),uTime*${glslFloat(DETAIL.filamentSpeed)});
          float density=noise3(position*${glslFloat(DETAIL.filamentFrequency)}+drift);
          float strand=1.0-smoothstep(0.015,0.07,abs(density-0.52));
          float wave=(0.75+0.25*sin(clock*2.0+seed))*(0.65+strand*1.5);`),journeyFragment);
      plasma=new THREE.Points(plasmaGeometry,plasmaMaterial);
      plasma.frustumCulled=false; plasma.renderOrder=1; plasma.visible=false;
      scene.add(plasma);
      // A radial density plate is the inexpensive projected glow of the
      // volume. Its boundary fades to zero well inside the outer shell; the
      // central clearing and render order leave the nucleus fully legible.
      const haloMaterial=ownedShader({
        transparent:true, depthTest:false, depthWrite:false, blending:THREE.AdditiveBlending,
        uniforms:{uTime:plasmaMaterial.uniforms.uTime,uDischarge:plasmaMaterial.uniforms.uDischarge,uLevel:plasmaMaterial.uniforms.uLevel},
        vertexShader:`precision highp float; varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
        fragmentShader:`precision highp float;varying vec2 vUv;uniform float uDischarge,uLevel;
          void main(){float r=length(vUv-0.5)*2.0;
            if(r>=0.95) discard;
            float halo=exp(-r*r*2.8)*smoothstep(0.16,0.34,r)*(1.0-smoothstep(0.55,0.95,r));
            vec3 color=mix(vec3(0.22,0.045,0.65),vec3(0.40,0.15,0.85),clamp(uLevel/2.0,0.0,1.0));
            gl_FragColor=vec4(color*1.3,uDischarge*halo*(0.22+uLevel*0.07));}`,
      });
      // No axis-aligned sine waves: thin ridges in warped 3D noise make
      // irregular curls. Phones keep the soft volume and vertex filaments,
      // skipping the two noise evaluations per halo fragment.
      if(!opts.mobile) enhance(haloMaterial,haloMaterial.vertexShader,haloMaterial.fragmentShader
        .replace('uniform float uDischarge,uLevel;','uniform float uTime,uDischarge,uLevel;'+evolvingNoise)
        .replace('vec3 color=mix',`
          vec2 q=(vUv-0.5)*2.0;
          float clock=uTime*${glslFloat(DETAIL.filamentSpeed)};
          float warp=noise3(vec3(q*2.8,clock));
          float n=noise3(vec3(q*${glslFloat(DETAIL.filamentFrequency)}+vec2(warp,warp*0.7),clock+2.0));
          float strand=1.0-smoothstep(0.012,0.045,abs(n-0.52));
          halo*=0.80+warp*0.20+strand*${glslFloat(DETAIL.filamentStrength)};
          vec3 color=mix`));
      plasmaHalo=new THREE.Mesh(ownedGeometry(new THREE.PlaneGeometry(2.88,2.88)),haloMaterial);
      plasmaHalo.renderOrder=0.5; plasmaHalo.frustumCulled=false; plasmaHalo.visible=false;
      scene.add(plasmaHalo);

      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
      // Soft sprites and the density halo provide glow without a phone blur pyramid.
      if (!opts.mobile) composer.addPass(bloom);
      composer.addPass(new OutputPass());
      const resize = () => {
        if (!renderer || !camera || !composer || !bloom) return;
        width = Math.max(1, el.clientWidth); height = Math.max(1, el.clientHeight);
        const aspect = width / height;
        camera.aspect=aspect;
        renderer.setSize(width, height, false);
        composer.setSize(width, height);
        background.uniforms.uAspect.value = aspect;
        readClearRectangle();
        applyFraming();
        camera.fov=THREE.MathUtils.radToDeg(2*Math.atan(halfHeight/FLIGHT.distance));
        camera.updateProjectionMatrix();
        material.uniforms.uProtonSize.value = Math.min(64,width*0.05*renderer.getPixelRatio());
      };
      observer = new ResizeObserver(resize);
      observer.observe(el);
      resize();
      world.frame({model:0,level:0,active:false}, 0);
    },
    frame(pos, t) {
      if (!renderer || !composer || !scene || !camera || !bloom) return;
      const previousTime=lastTime;
      lastTime = opts.reduced || !Number.isFinite(t) ? 0 : Math.max(0, t);
      const ids = opts.models.map(m => m.id);
      const index = clamp(Number.isFinite(pos.model) ? pos.model : 0, 0, Math.max(0, ids.length - 1));
      // Reduced motion always shows a complete plate, including when a caller
      // supplies a fractional model instead of storyPosition's snapped value.
      // Tiny float drift at an effort stop must not select carbon's assembly
      // shader or fail the active-argon gate at the final argon level.
      const nearest=Math.round(index);
      const value = opts.reduced || lastTime===0 || Math.abs(index-nearest)<1e-6 ? nearest : index;
      const from = Math.floor(value), to = Math.ceil(value), fraction = value-from;
      const sceneId = (i: number) => Math.max(0,names.indexOf(ids[i]));
      material.uniforms.uFrom.value = sceneId(from);
      material.uniforms.uTo.value = sceneId(to);
      material.uniforms.uMix.value = fraction;
      if(lastTime===0 || lastTime<lastLayoutTime || lastTime-lastLayoutTime>=FRAMING.refreshSeconds) readClearRectangle();
      applyFraming();
      material.uniforms.uTime.value = lastTime;
      background.uniforms.uTime.value = lastTime;
      const carbonWeight=from===to?(sceneId(from)===3?1:0):
        sceneId(from)===3?1-ease(fraction):sceneId(to)===3?ease(fraction):0;
      carbonBonds.visible=carbonWeight>0;
      carbonBonds.material.uniforms.uWeight.value=carbonWeight;
      const entry = opts.models[from];
      const offered = entry?.efforts ?? [];
      const levelPosition = clamp(Number.isFinite(pos.level)?pos.level:0,0,Math.max(0,offered.length-1));
      const low = Math.floor(levelPosition), high = Math.ceil(levelPosition);
      const levelValue = (i: number) => Math.max(0,['low','medium','high'].indexOf(offered[i]));
      const level = clamp(THREE.MathUtils.lerp(levelValue(low),levelValue(high),ease(levelPosition-low)),0,2);
      // Arrive stays unlit; active Low has a dim discharge. Bounded effort
      // interpolation retains a positive glow through the maximum level.
      const activeArgon=pos.active && from===to && sceneId(from)===2;
      const travel=ease(fraction);
      const departingArgon=from!==to && sceneId(from)===2 && offered.length>0;
      const dischargeLevel=departingArgon?levelValue(offered.length-1):level;
      const discharge=(activeArgon || departingArgon)?
        clamp(0.16+0.84*ease(dischargeLevel/2),0.16,1)*(departingArgon?1-travel:1):0;
      const atomWeight=from===to?(sceneId(from)===2?1:0):
        sceneId(from)===2?1-travel:sceneId(to)===2?travel:0;
      shellRings.visible=atomWeight>0;
      for(const ringMaterial of shellMaterials) ringMaterial.opacity=atomWeight*(0.5+((activeArgon || departingArgon)?dischargeLevel*0.08:0));
      const departingLevel=from!==to && offered.length>0 ? levelValue(offered.length-1) : level;
      material.uniforms.uLevel.value=(activeArgon || departingArgon)?dischargeLevel:0;
      orbitTime=lastTime===0?0:orbitTime+clamp(lastTime-previousTime,0,0.1)*(1+((activeArgon || departingArgon)?dischargeLevel*0.65*(departingArgon?1-travel:1):0));
      material.uniforms.uOrbitTime.value=orbitTime;
      // Bolt travel still releases the departing model's final effort form.
      if(sceneId(from)===0) material.uniforms.uLevel.value=departingLevel;
      plasma.visible=discharge>0;
      plasma.material.uniforms.uTime.value=orbitTime;
      plasma.material.uniforms.uDischarge.value=discharge;
      plasma.material.uniforms.uLevel.value=dischargeLevel;
      plasmaHalo.visible=discharge>0;
      // No impact flash or abrupt exposure spike between models.
      const cameraMix=from===to?0:travel;
      if(from!==to) flights[Math.min(from,flights.length-1)].getPoint(cameraMix,flightPoint);
      else flightPoint.set(0,0,FLIGHT.distance);
      camera.position.copy(flightPoint);
      camera.lookAt(0,0,0);
      const breath=Math.sin(Math.PI*cameraMix)**2;
      camera.fov=THREE.MathUtils.radToDeg(2*Math.atan(halfHeight/FLIGHT.distance))+FLIGHT.fovBreath*breath;
      camera.updateProjectionMatrix();
      bloom.strength=BLOOM.strength+discharge*dischargeLevel*BLOOM.effortGain;
      renderer.toneMappingExposure=THREE.MathUtils.lerp(FLIGHT.exposure[sceneId(from)],FLIGHT.exposure[sceneId(to)],travel);
      try { composer.render(); }
      catch(error) { if(!shaderFailed || usingFallback) throw error; }
      // Three reports link failures on first use. Retry synchronously in this
      // same frame, before the canvas is presented, with the original shaders.
      if(shaderFailed && !usingFallback) {
        usingFallback=true; shaderFailed=false;
        for(const saved of shaderFallbacks) {
          saved.material.vertexShader=saved.vertex; saved.material.fragmentShader=saved.fragment;
          saved.material.needsUpdate=true;
        }
        composer.render();
      }
      if(shaderFailed) throw new Error('Gemini fallback shader unavailable');
    },
    destroy() {
      observer?.disconnect(); observer = undefined;
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      geometries.length = 0; materials.length = 0; shellMaterials.length = 0;
      if (composer) {
        for (const pass of composer.passes) pass.dispose();
        composer.dispose(); composer = undefined;
      }
      scene?.clear(); scene = undefined;
      if (renderer) {
        renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); renderer = undefined;
      }
      if(opts?.mobile) bloom?.dispose();
      shaderFallbacks.length=0; shaderFailed=false; usingFallback=false;
      lastTime=0; orbitTime=0;
      camera = undefined; bloom = undefined;
    },
  };
  return world;
}
