import { open, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { MODELS, recommend } from '../policy.mjs';

// Claude Code UserPromptSubmit suggestions, with skill-based routing by opt-in.
// Prompt and transcript text stay in memory: never written, logged or sent.
// https://code.claude.com/docs/en/hooks#userpromptsubmit
const CEILING = 'high'; // Effort's rules never suggest more than high.
const MAX_PROMPT_CHARACTERS = 100_000;
const MAX_TRANSCRIPT_BYTES = 65_536;
export const MAX_INPUT_BYTES = 1_048_576;

function eligiblePrompt(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return false;
  if (event.hook_event_name !== undefined && event.hook_event_name !== 'UserPromptSubmit') return false;
  const { prompt } = event;
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > MAX_PROMPT_CHARACTERS) return false;
  // Commands and skills arrive as typed (/name args) and ! lines run a shell;
  // neither describes the task the next requests will work on.
  return !/^\s*[/!]/.test(prompt);
}

const recommendPrompt = (prompt) => recommend({ prompt, provider: 'claude', maxEffort: CEILING });
const hasSignal = ({ features }) => features.critical || features.complex || features.mechanical;
const shortFollowUp = (prompt, suggested) => prompt.trim().length <= 80 && !hasSignal(suggested);

/**
 * Pure advice from the prompt, explicit environment and earlier eligible prompts
 * (newest first). No repository facts, event effort or $CLAUDE_EFFORT are used.
 */
export function promptAdvice(event, { env = {}, previousPrompts = [] } = {}) {
  if (!eligiblePrompt(event)) return null;
  const { prompt } = event;
  let suggested;
  try { suggested = recommendPrompt(prompt); } catch { return null; }
  let inherited = false;
  if (shortFollowUp(prompt, suggested)) {
    for (const earlier of previousPrompts.slice(0, 3)) {
      const candidate = recommendPrompt(earlier);
      if (!hasSignal(candidate)) continue;
      suggested = candidate;
      inherited = true;
      break;
    }
  }
  const suffix = inherited ? ' Based on your earlier request.' : '';
  if (!/^(?:1|true|yes|on)$/i.test(env.EFFORT_AUTO_ROUTE ?? '') || suggested.effort === 'medium') {
    const model = MODELS.claude[suggested.tier];
    return { systemMessage: `Effort suggests ${model} · ${suggested.effort} effort for this prompt (/model ${model}, /effort ${suggested.effort}).${suffix}` };
  }
  const tier = suggested.effort === 'low' ? 'fast' : suggested.tier === 'frontier' ? 'frontier' : null;
  const skill = `effort-project:route-${tier ?? 'hard'}`;
  const additionalContext = tier
    ? `Effort Project hook: Do not carry out the request yourself. Invoke the Skill tool with skill "${skill}", passing the user's request verbatim as its arguments plus any earlier conversation context the worker needs. Then relay the result to the user.`
    : `Effort Project hook: Before anything else, invoke the Skill tool with skill "${skill}", then carry out the user's request as written.`;
  const systemMessage = tier
    ? `Effort: ${MODELS.claude[tier]} at ${suggested.effort} effort for this prompt.`
    : 'Effort: high effort for this prompt.';
  return { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext }, systemMessage: systemMessage + suffix };
}

async function previousPrompts(event) {
  if (!eligiblePrompt(event) || !shortFollowUp(event.prompt, recommendPrompt(event.prompt))) return [];
  const path = event.transcript_path;
  if (typeof path !== 'string' || !isAbsolute(path)) return [];
  let file;
  try {
    if (!(await stat(path)).isFile()) return []; // Avoid opening pipes and devices.
    file = await open(path, 'r');
    const info = await file.stat();
    if (!info.isFile()) return [];
    const offset = Math.max(0, info.size - MAX_TRANSCRIPT_BYTES);
    const buffer = Buffer.alloc(Math.min(info.size, MAX_TRANSCRIPT_BYTES));
    const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
    const text = buffer.subarray(0, bytesRead).toString('utf8');
    const lines = text.split('\n');
    if (offset > 0) lines.shift(); // The tail can start in the middle of a JSON line.
    const prompts = [];
    for (let i = lines.length - 1; i >= 0 && prompts.length < 3; i--) {
      let entry;
      try { entry = JSON.parse(lines[i]); } catch { continue; }
      if (entry?.type !== 'user' || entry.isMeta === true || entry.message?.role !== 'user') continue;
      const content = entry.message.content;
      const prompt = typeof content === 'string' ? content : Array.isArray(content)
        ? content.filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n') : '';
      if (!eligiblePrompt({ prompt }) || /^\s*<command-/.test(prompt) || prompt === event.prompt) continue;
      prompts.push(prompt);
    }
    return prompts;
  } catch {
    return []; // Context is optional; never report errors that could contain text.
  } finally {
    try { await file?.close(); } catch { /* ignore */ }
  }
}

function readEvent(stream, timeoutMs) {
  if (stream.isTTY) return Promise.resolve(null); // Started by hand, not by Claude Code.
  return new Promise(done => {
    const chunks = [];
    let size = 0, timer;
    const finish = (text) => {
      clearTimeout(timer);
      stream.removeListener('data', onData).removeListener('end', onEnd).removeListener('error', onError);
      if (text === null) stream.destroy?.();
      done(text);
    };
    const onData = (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      size += bytes.length;
      if (size > MAX_INPUT_BYTES) return finish(null);
      chunks.push(bytes);
    };
    const onEnd = () => finish(Buffer.concat(chunks).toString('utf8'));
    const onError = () => finish(null);
    timer = setTimeout(() => finish(null), timeoutMs);
    stream.on('data', onData).on('end', onEnd).on('error', onError);
  });
}

const write = (stream, text) => new Promise((done, fail) => stream.write(text, error => (error ? fail(error) : done())));

/**
 * Read one hook event and print a suggestion (optionally routing context), or nothing.
 * Never throws, blocks, or rewrites the prompt; the caller always exits 0.
 */
export async function runPromptHook({
  stdin = process.stdin, stdout = process.stdout, stderr = process.stderr, inputTimeoutMs = 3000, env = process.env,
} = {}) {
  try {
    const text = await readEvent(stdin, inputTimeoutMs);
    if (!text) return null;
    let event;
    try { event = JSON.parse(text); } catch { return null; }
    const advice = promptAdvice(event, { env, previousPrompts: await previousPrompts(event) });
    if (advice) await write(stdout, JSON.stringify(advice) + '\n');
    return advice;
  } catch {
    // Fixed text only: error messages can quote the hook input, which holds the prompt.
    try { stderr.write('effort-project: prompt advice skipped after an internal error.\n'); } catch { /* ignore */ }
    return null;
  }
}
