// Generates the Claude-world art layers listed in art-manifest.json with Codex's
// image tool. One Codex run per layer; Codex stores its image under
// ~/.codex/generated_images/<session id>/, which this script copies to <rawDir>.
// Usage: [ART_REF=reference.png] node scripts/generate-art.mjs <rawDir> [layer ...]   (skips layers already present)
// Layers marked `ref` get ART_REF attached as the style reference.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [rawDir, ...only] = process.argv.slice(2);
if (!rawDir) throw new Error('usage: generate-art.mjs <rawDir> [layer ...]');
const manifest = JSON.parse(fs.readFileSync(new URL('./art-manifest.json', import.meta.url)));
export const promptFor = (l) => `${l.bleed ? manifest.styleBleed : manifest.style} Subject: ${l.subject}. Format: ${l.format}.`;

const todo = manifest.layers.filter(l => (!only.length || only.includes(l.layer)) && !fs.existsSync(path.join(rawDir, l.scene, l.layer + '.png')));
const CONCURRENCY = 5;

function run(l) {
  return new Promise((done) => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'art-'));
    const ask = `Use your built-in image generation tool exactly once to create one image from the prompt below. Do not write code, do not try to save or download the file, and do not generate a second image. After the tool returns, reply with the single word DONE.\n\nImage prompt: ${promptFor(l)}`;
    const child = spawn('codex', ['exec', '-m', 'gpt-6-luna', '-c', 'model_reasoning_effort="low"', '-s', 'read-only', '-C', work, '--skip-git-repo-check', ...(l.ref && process.env.ART_REF ? ['-i', process.env.ART_REF] : []), '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let log = '';
    child.stdout.on('data', d => { log += d; });
    child.stderr.on('data', d => { log += d; });
    child.stdin.end(ask);
    const timer = setTimeout(() => child.kill(), 8 * 60_000);
    child.on('close', () => {
      clearTimeout(timer);
      const session = /session id: ([0-9a-f-]+)/.exec(log)?.[1];
      const dir = session && path.join(os.homedir(), '.codex', 'generated_images', session);
      const files = dir && fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.png')).map(f => path.join(dir, f)).sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs) : [];
      if (!files.length) { console.log(`FAILED ${l.scene}/${l.layer} (session ${session}): ${log.split('\n').filter(x => /error|limit|quota/i.test(x)).slice(-2).join(' | ').slice(0, 300)}`); return done(false); }
      fs.mkdirSync(path.join(rawDir, l.scene), { recursive: true });
      fs.copyFileSync(files.at(-1), path.join(rawDir, l.scene, l.layer + '.png'));
      console.log(`ok ${l.scene}/${l.layer}`);
      done(true);
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`${todo.length} layers to generate`);
  const queue = [...todo];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => { while (queue.length) await run(queue.shift()); }));
}
