import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { classifyFailure } from './policy.mjs';

const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]/g;
// Failing test names from common runner reports. They stay the same when timings,
// temporary paths or line numbers change between otherwise identical failures.
const FAILING_TESTS = [
  /^\s*✖ (.+?) \(\d+(?:\.\d+)?m?s\)$/gm, // node:test spec
  /^\s*not ok \d+ - (.+)$/gm, // TAP, including node:test
  /^\s*● (.+ › .+)$/gm, // jest
  /^\s*FAIL\s+(\S+ > .+)$/gm, // vitest
  /^FAILED (\S+::\S+)/gm, // pytest
  /^\s*--- FAIL: (\S+)/gm, // go test
  /^test (\S+) \.\.\. FAILED$/gm, // cargo test
];
const literal = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The working and temporary directories, with either separator and as realpaths.
function directories(cwd) {
  const found = [];
  for (const [path, label] of [[cwd, '<cwd>'], [tmpdir(), '<tmp>']]) {
    if (typeof path !== 'string') continue;
    const variants = new Set([path]);
    try { variants.add(realpathSync(path)); } catch {}
    for (const variant of variants) {
      const parts = variant.replace(/[\\/]+$/, '').split(/[\\/]+/);
      if (parts.join('').length > 2) found.push({ length: variant.length, label, pattern: new RegExp(parts.map(literal).join('[\\\\/]+'), process.platform === 'win32' ? 'gi' : 'g') });
    }
  }
  // Replace the longer path first: a test's working directory is often inside the temporary one.
  return found.sort((a, b) => b.length - a.length);
}

function normalize(text, roots) {
  let value = text;
  for (const { pattern, label } of roots) value = value.replace(pattern, label);
  return value
    .replace(/<tmp>[^\s'"`<>|]*/g, '<tmp>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>')
    .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g, '<time>')
    .replace(/\b\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?\b/g, '<time>')
    .replace(/\b1\d{12}\b/g, '<time>')
    .replace(/\b0x[0-9a-f]+\b/gi, '<hex>')
    .replace(/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{8,}\b/gi, '<hex>')
    .replace(/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):\d{1,5}\b/gi, '$1:<port>')
    .replace(/\bport\s*[:=]?\s*\d+/gi, 'port <port>')
    .replace(/\bpid\s*[:=]?\s*\d+/gi, 'pid <pid>')
    .replace(/(\.[a-z]\w{0,5})(?::\d+){1,2}\b/gi, '$1:<line>')
    .replace(/\bduration(?:_ms)?\s*[:=]?\s*\d+(?:\.\d+)?/gi, 'duration #time')
    .replace(/\b\d+(?:\.\d+)?\s*(?:ms|s|seconds)\b/g, '#time')
    .replace(/\s+/g, ' ').trim();
}

/** Identical failures share a fingerprint: failing test names when recognizable, otherwise output without run-specific noise. */
export function failureFingerprint(output, { cwd } = {}) {
  const plain = String(output).replace(ANSI, '').replace(/\r\n?/g, '\n');
  const roots = directories(cwd);
  const names = new Set();
  for (const pattern of FAILING_TESTS) for (const match of plain.matchAll(pattern)) names.add(normalize(match[1], roots));
  const basis = names.size ? `failing tests\n${[...names].sort().join('\n')}` : normalize(plain, roots);
  return createHash('sha256').update(basis).digest('hex').slice(0, 16);
}

export function validateCommand(argv) {
  if (!Array.isArray(argv) || !argv.length || argv.length > 100 || argv.some(x => typeof x !== 'string' || x.includes('\0') || x.length > 20_000) || !argv[0]) throw new Error('Verification must be a nonempty JSON array of executable and arguments.');
  return argv;
}

export function verify(argv, { cwd, timeoutMs = 60_000, signal, env = process.env } = {}) {
  validateCommand(argv);
  return new Promise(resolve => {
    if (signal?.aborted) return resolve({ status:'blocked', kind:'cancelled', output:'', exitCode:null });
    let output = '', timedOut = false, aborted = false, launchError = null;
    // A fresh verification process must not inherit node:test's nested-run marker:
    // Node can otherwise skip the requested tests and exit successfully.
    const childEnv={...env};delete childEnv.NODE_TEST_CONTEXT;
    const child = spawn(argv[0], argv.slice(1), { cwd, env:childEnv, shell:false, stdio:['ignore','pipe','pipe'], windowsHide:true, detached:process.platform!=='win32' });
    const collect = data => { output = (output + data.toString()).slice(-32_000); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    let hardKill,reapTimer,settled=false;
    const killTree = signalName => {
      if(!child.pid)return;
      if(process.platform==='win32'){
        const killer=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{shell:false,stdio:'ignore',windowsHide:true});
        killer.on('error',()=>{try{child.kill(signalName);}catch{}});killer.unref();
      }else{try{process.kill(-child.pid,signalName);}catch{try{child.kill(signalName);}catch{}}}
    };
    const stop = () => {
      killTree('SIGTERM');
      hardKill=setTimeout(()=>killTree('SIGKILL'),500);
      reapTimer=setTimeout(()=>{child.stdout.destroy();child.stderr.destroy();child.unref();finish(null);},1500);
    };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    const abort = () => { aborted = true; stop(); };
    signal?.addEventListener('abort', abort, { once:true });
    child.on('error', e => { launchError = e.code || 'launch error'; });
    const finish = code => {
      if(settled)return;settled=true;
      clearTimeout(timer); clearTimeout(hardKill);clearTimeout(reapTimer); signal?.removeEventListener('abort', abort);
      killTree('SIGKILL');
      if (launchError) output = launchError;
      const kind = aborted ? 'cancelled' : code === 0 && !timedOut ? null : classifyFailure(output, {timedOut});
      const status = code === 0 && !timedOut && !aborted ? 'passed' : kind === 'test' ? 'failed' : 'blocked';
      resolve({status,kind,exitCode:code,output,fingerprint:failureFingerprint(output,{cwd})});
    };
    child.on('close',finish);
  });
}
