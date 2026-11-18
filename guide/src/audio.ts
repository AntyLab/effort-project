/** Optional story audio. Nothing is created or fetched until a visitor enables sound. */
const beds = new Set(['sky', 'tower', 'pond', 'meadow', 'night', 'space', 'hum']);
const cues = new Set(['croak', 'plop', 'scratch', 'crackle']);
const buffers = new Map<string, AudioBuffer>();
const pending = new Map<string, Promise<AudioBuffer | null>>();
const requests = new Map<string, AbortController>();
const warned = new Set<string>();
let context: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = false;
let suspended = true;
let wanted: string | null = null;
let revision = 0;
let cueRevision = 0;
type Bed = { name: string; source: AudioBufferSourceNode; gain: GainNode };
let current: Bed | null = null;
const playing = new Set<Bed>();
const shots = new Set<AudioBufferSourceNode>();

function ramp(param: AudioParam, value: number, seconds: number) {
  const now = context!.currentTime;
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(now);
  else { param.cancelScheduledValues(now); param.setValueAtTime(param.value, now); }
  param.linearRampToValueAtTime(value, now + seconds);
}

async function buffer(name: string): Promise<AudioBuffer | null> {
  if (!enabled || !context) return null;
  if (buffers.has(name)) return buffers.get(name)!;
  if (warned.has(name)) return null;
  if (pending.has(name)) return pending.get(name)!;
  const ctx = context, controller = new AbortController();
  requests.set(name, controller);
  const job = (async () => {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}assets/audio/${name}.mp3`, {signal:controller.signal});
      if (!response.ok) throw new Error('Audio unavailable');
      const bytes = await response.arrayBuffer();
      if (!enabled || controller.signal.aborted) return null;
      const decoded = await ctx.decodeAudioData(bytes);
      buffers.set(name, decoded);
      return decoded;
    } catch {
      if (!controller.signal.aborted && !warned.has(name)) {
        warned.add(name);
        console.warn(`Optional audio unavailable: ${name}.mp3`);
      }
      return null;
    } finally {
      if (requests.get(name) === controller) { requests.delete(name); pending.delete(name); }
    }
  })();
  pending.set(name, job);
  return job;
}

function retire(bed: Bed, seconds = 1.2) {
  ramp(bed.gain.gain, 0, seconds);
  bed.source.stop(context!.currentTime + seconds);
}

async function updateBed() {
  const name = wanted, token = ++revision;
  if (!enabled || suspended || !name || current?.name === name) return;
  const decoded = await buffer(name);
  if (token !== revision || !enabled || suspended || !context || !master) return;
  if (!decoded) { if (current) retire(current); current = null; return; }
  const source = context.createBufferSource(), gain = context.createGain();
  source.buffer = decoded; source.loop = true;
  gain.gain.value = 0; source.connect(gain); gain.connect(master);
  const bed = {name, source, gain};
  source.onended = () => { source.disconnect(); gain.disconnect(); playing.delete(bed); };
  if (current) retire(current);
  current = bed; playing.add(bed);
  source.start(); ramp(gain.gain, .5, 1.2);
}

export function setEnabled(on: boolean) {
  enabled = on;
  if (on) {
    // This is the only AudioContext creation site; callers invoke it from a user gesture.
    if (!context) {
      const Constructor = window.AudioContext || (window as typeof window & {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
      if (!Constructor) return;
      try { context = new Constructor(); master = context.createGain(); master.gain.value = 0; master.connect(context.destination); }
      catch { context = null; master = null; return; }
    }
    void context.resume().catch(() => {});
    ramp(master!.gain, suspended ? 0 : 1, .08);
    void updateBed();
  } else {
    ++revision; ++cueRevision;
    for (const request of requests.values()) request.abort();
    requests.clear(); pending.clear();
    if (master) ramp(master.gain, 0, .08);
    // Fading beds already have a stop scheduled; retire only the current one again.
    if (current) retire(current, .08);
    current = null;
    for (const shot of shots) shot.stop();
  }
}

export function scene(name: string | null) {
  const next = name && beds.has(name) ? name : null;
  if (wanted === next) return;
  wanted = next;
  ++revision; ++cueRevision;
  // Teardown clears every fading bed too, so a fast family switch cannot unmute old audio.
  if (!next) { for (const bed of playing) bed.source.stop(); current = null; return; }
  void updateBed();
}

const cueMix: Record<string, {gap:number; gain:number; spread:number}> = {
  scratch: {gap:3.2, gain:.2, spread:.2}, croak: {gap:1.6, gain:.38, spread:.16},
  plop: {gap:.9, gain:.4, spread:.2}, crackle: {gap:.5, gain:.35, spread:.18},
};
const lastCue = new Map<string, number>();
export async function cue(name: string) {
  if (!enabled || suspended || !cues.has(name)) return;
  // One-shots are rate-limited per name so fast scrolling or many frogs cannot stack the same clip.
  const mix = cueMix[name] || {gap:.4, gain:.5, spread:.12}, now = Date.now() / 1000;
  if (now - (lastCue.get(name) ?? -99) < mix.gap * (.8 + Math.random() * .6)) return;
  lastCue.set(name, now);
  const token = cueRevision, decoded = await buffer(name);
  if (!decoded || !enabled || suspended || token !== cueRevision || !context || !master) return;
  const source = context.createBufferSource(), gain = context.createGain();
  source.buffer = decoded; source.playbackRate.value = 1 - mix.spread + Math.random() * mix.spread * 2;
  gain.gain.value = mix.gain * (.75 + Math.random() * .25); source.connect(gain); gain.connect(master); shots.add(source);
  source.onended = () => { source.disconnect(); gain.disconnect(); shots.delete(source); };
  source.start();
}

export function setSuspended(on: boolean) {
  if (suspended === on) return;
  suspended = on;
  if (master) ramp(master.gain, enabled && !on ? 1 : 0, .08);
  if (on) { ++revision; ++cueRevision; for (const shot of shots) shot.stop(); }
  else void updateBed();
}
