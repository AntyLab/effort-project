// Offline stand-in for agy --print --output-format json; never contacts a model.
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { FAKE_VERSION, readConfig, readState, simulateTurn, writeState } from './model.mjs';

const { config, args } = await readConfig(process.argv.slice(2));
if (args.includes('--version')) {
  process.stdout.write(`${FAKE_VERSION}\n`);
  process.exit(0);
}
const flag = name => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
const emit = data => process.stdout.write(`${JSON.stringify(data)}\n`);
const effort = flag('--effort');
const model = flag('--model') ?? config.model ?? 'gemini-4-hydrogen';
const resumed = flag('--conversation');
const sessionId = resumed ?? randomUUID();
const state = await readState(config);
const settings = JSON.parse(flag('--settings') ?? '{}');
if (typeof flag('--print') !== 'string' || flag('--output-format') !== 'json' ||
    !['plan', 'accept-edits'].includes(flag('--mode')) || !/^\d+s$/.test(flag('--print-timeout') ?? '')) throw new Error('Invalid fake agy print arguments.');
const family = model.replace(/^gemini-4-/, '');
const title = word => word[0].toUpperCase() + word.slice(1);
await writeFile(flag('--log-file'), `Propagating selected model override to backend: label="Gemini 4 ${title(family)} (${title(effort)})"\n`);
if (resumed && !state.sessions[resumed]) {
  emit({ conversation_id: '', status: 'ERROR', response: '', error: 'No conversation found for the session ID.', finished_reason: 'error', num_turns: 0 });
  process.exit(0);
}
const turn = await simulateTurn(config, state, { cwd: process.cwd(), effort, model,
  canWrite: flag('--mode') === 'accept-edits' && settings.permissions?.allow?.includes('write_file(*)') });
const session = state.sessions[sessionId] ?? { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, num_turns: 0 };
session.input_tokens += turn.usage.inputTokens;
session.output_tokens += turn.usage.outputTokens;
session.cache_read_tokens += turn.usage.cachedInputTokens;
session.num_turns += 1;
state.sessions[sessionId] = session;
await writeState(config, state);
emit({ conversation_id: sessionId, status: 'SUCCESS', response: turn.text, duration_seconds: 0,
  num_turns: session.num_turns, usage: { input_tokens: session.input_tokens, output_tokens: session.output_tokens,
    thinking_tokens: 0, cache_read_tokens: session.cache_read_tokens, total_tokens: session.input_tokens + session.output_tokens } });
