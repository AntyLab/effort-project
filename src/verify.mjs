import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { classifyFailure } from './policy.mjs';
import { plainReport, failingTestNames } from './test-reports.mjs';
import { findCommand } from './commands.mjs';

const OUTPUT_LIMIT = 32_000;
const EXIT_GRACE_MS = 1000;
const literal = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The working and temporary directories, with either separator and as realpaths.
// A match starts and ends at a path boundary: the temporary root '/tmp' is not
// part of '/tmpl', '/tmp_uploads' or a project's own 'src/tmp' (nor '<cwd>/tmp').
function directories(cwd, tmp) {
  const found = [];
  for (const [path, label] of [[cwd, '<cwd>'], [tmp, '<tmp>']]) {
    if (typeof path !== 'string') continue;
    const variants = new Set([path]);
    try { variants.add(realpathSync(path)); } catch {}
    for (const variant of variants) {
      const parts = variant.replace(/[\\/]+$/, '').split(/[\\/]+/);
      if (parts.join('').length > 2) found.push({ length: variant.length, label,
        pattern: new RegExp(`(?<![\\w.>-])${parts.map(literal).join('[\\\\/]+')}(?![\\w.-])`, process.platform === 'win32' ? 'gi' : 'g') });
    }
  }
  // Replace the longer path first: a test's working directory is often inside the temporary one.
  return found.sort((a, b) => b.length - a.length);
}

// Temporary paths are collapsed whole: their directory names are random.
function replaceRoots(text, roots) {
  let value = text;
  for (const { pattern, label } of roots) value = value.replace(pattern, label);
  return value.replace(/<tmp>[^\s'"`<>|]*/g, '<tmp>');
}

function normalize(text, roots) {
  return replaceRoots(text, roots)
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>')
    .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g, '<time>')
    .replace(/\b\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?\b/g, '<time>')
    .replace(/\b1\d{12}\b/g, '<time>')
    .replace(/\b0x[0-9a-f]+\b/gi, '<hex>')
    .replace(/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{8,}\b/gi, '<hex>')
    .replace(/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):\d{1,5}\b/gi, '$1:<port>')
    // [ \t]*, not \s*: a value is on the same line, and \s* backtracks across blank lines.
    .replace(/\bport[ \t]*[:=]?[ \t]*\d+/gi, 'port <port>')
    .replace(/\bpid[ \t]*[:=]?[ \t]*\d+/gi, 'pid <pid>')
    .replace(/(\.[a-z]\w{0,5})(?::\d+){1,2}\b/gi, '$1:<line>')
    .replace(/\bline \d+\b/gi, 'line <n>')
    .replace(/\bduration(?:_ms)?[ \t]*[:=]?[ \t]*\d+(?:\.\d+)?/gi, 'duration #time')
    .replace(/\b\d+(?:\.\d+)?[ \t]*(?:ms|s|seconds)\b/g, '#time')
    .replace(/\s+/g, ' ').trim();
}

/**
 * Identical failures share a fingerprint: the failing test names when a runner reports
 * them, otherwise the output without run-specific noise. Names keep their numbers:
 * 'retries after 5s' and 'retries after 30s' are different tests.
 */
export function failureFingerprint(output, { cwd, tmp = tmpdir() } = {}) {
  const plain = plainReport(output);
  const roots = directories(cwd, tmp);
  const names = new Set([...failingTestNames(plain)].map((name) => replaceRoots(name, roots)));
  const basis = names.size ? `failing tests\n${[...names].sort().join('\n')}` : normalize(plain, roots);
  return createHash('sha256').update(basis).digest('hex').slice(0, 16);
}

export function validateCommand(argv) {
  if (!Array.isArray(argv) || !argv.length || argv.length > 100 || argv.some(x => typeof x !== 'string' || x.includes('\0') || x.length > 20_000) || !argv[0]) throw new Error('Verification must be a nonempty JSON array of executable and arguments.');
  return argv;
}

/**
 * The argv that starts a verification command with shell:false. On Windows this runs
 * npm, npx, pnpm or yarn through the JavaScript entry point their .cmd wrapper names.
 * Throws when the command cannot be started, so a run can stop before any provider turn.
 */
export function resolveVerification(argv, { cwd, env = process.env } = {}) {
  validateCommand(argv);
  const found = findCommand(argv[0], { env, cwd });
  if (!found) throw new Error(`The verification command ${JSON.stringify(argv[0])} was not found${/[\\/]/.test(argv[0]) ? '' : ' on PATH'}.`);
  return [found.executable, ...found.executableArgs, ...argv.slice(1)];
}

export function verify(argv, { cwd, timeoutMs = 60_000, signal, env = process.env } = {}) {
  validateCommand(argv);
  return new Promise(resolve => {
    if (signal?.aborted) return resolve({ status:'blocked', kind:'cancelled', output:'', exitCode:null });
    const unavailable = output => resolve({ status:'blocked', kind:'environment', output, exitCode:null, fingerprint:failureFingerprint(output,{cwd}) });
    let command;
    try { command = resolveVerification(argv, { cwd, env }); } catch (error) { return unavailable(error.message); }
    let output = '', truncated = false, timedOut = false, aborted = false, launchError = null;
    // A fresh verification process must not inherit node:test's nested-run marker:
    // Node can otherwise skip the requested tests and exit successfully.
    const childEnv={...env};delete childEnv.NODE_TEST_CONTEXT;
    let child;
    try { child = spawn(command[0], command.slice(1), { cwd, env:childEnv, shell:false, stdio:['ignore','pipe','pipe'], windowsHide:true, detached:process.platform!=='win32' }); }
    catch (error) { return unavailable(error.code || 'launch error'); }
    const collect = data => { output += data.toString(); if (output.length > OUTPUT_LIMIT) { output = output.slice(-OUTPUT_LIMIT); truncated = true; } };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    let hardKill,reapTimer,exitTimer,settled=false;
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
      clearTimeout(timer); clearTimeout(hardKill);clearTimeout(reapTimer);clearTimeout(exitTimer); signal?.removeEventListener('abort', abort);
      killTree('SIGKILL');
      if (launchError) output = launchError;
      const kind = aborted ? 'cancelled' : code === 0 && !timedOut ? null : classifyFailure(output, {timedOut});
      const status = code === 0 && !timedOut && !aborted ? 'passed' : kind === 'test' ? 'failed' : 'blocked';
      // Only failures are compared. A truncated tail starts mid-line at a shifting offset
      // and holds a varying number of lines, so compare its last 50 complete lines (all of
      // which fit even when lines are about 600 characters long).
      const tail = truncated ? output.split('\n').slice(1).slice(-50).join('\n') : output;
      resolve({status,kind,exitCode:code,output,fingerprint:status==='passed'?null:failureFingerprint(tail,{cwd})});
    };
    // The check is over when its process exits. A descendant that keeps stdout open
    // (such as a server started with `&`) must not turn a pass into a timeout: allow
    // a short grace period for remaining output, then stop the tree and settle. On
    // POSIX the group kill reaches the descendant; on Windows taskkill /T cannot once
    // the check has exited, so the descendant keeps running and only the pipes close.
    child.on('exit',code=>{exitTimer=setTimeout(()=>{killTree('SIGKILL');child.stdout.destroy();child.stderr.destroy();finish(code);},EXIT_GRACE_MS);});
    child.on('close',finish);
  });
}

// Lets runTask check, before any provider turn, that the command can start.
verify.preflight = (argv, options) => { resolveVerification(argv, options); };
