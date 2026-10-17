// Offline stand-in for `claude --print --output-format stream-json`. It emits
// only the events that src/adapters/claude.mjs reads and never contacts a model.
import { randomUUID } from 'node:crypto';
import { FAKE_USD_PER_TOKEN, readConfig, readState, simulateTurn, writeState } from './model.mjs';

const { config, args } = await readConfig(process.argv.slice(2));

// The adapter refuses to launch unless --help lists every managed-mode flag it relies on.
const FLAGS = [
  '--print', '--output-format', '--verbose', '--effort', '--resume', '--restricted', '--safe-mode',
  '--permission-mode', '--permission-prompts', '--tools', '--allowedTools', '--disallowedTools',
  '--strict-mcp-config', '--mcp-config', '--settings', '--setting-sources', '--disable-slash-commands',
  '--no-chrome', '--max-turns', '--model',
];
if (args.includes('--help')) {
  process.stdout.write(`Usage: claude [options] (offline effort-bench fake)\n\n${FLAGS.join('\n')}\n`);
  process.exit(0);
}

const flag = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);

for await (const chunk of process.stdin) void chunk; // The prompt arrives on stdin; the fake ignores it.

const resumed = flag('--resume');
const sessionId = resumed ?? randomUUID();
const model = flag('--model') ?? config.model ?? 'fake-claude';
const tools = (flag('--tools') ?? '').split(',').filter(Boolean);
const state = await readState(config);

emit({ type: 'system', subtype: 'init', session_id: sessionId, model, tools, mcp_servers: [], plugins: [], permissionMode: flag('--permission-mode') });
if (resumed && !state.sessions[resumed]) {
  emit({ type: 'result', subtype: 'error_during_execution', is_error: true, session_id: sessionId, result: 'No conversation found for the session ID.' });
  process.exit(1);
}

const turn = await simulateTurn(config, state, { cwd: process.cwd(), effort: flag('--effort'), canWrite: tools.includes('Edit') || tools.includes('Write') });
const session = state.sessions[sessionId] ?? { costUsd: 0 };
// Like the real CLI's total_cost_usd on a resumed session, this cost covers the whole conversation.
session.costUsd = Math.round((session.costUsd + (turn.usage.inputTokens + turn.usage.outputTokens) * FAKE_USD_PER_TOKEN) * 1e6) / 1e6;
state.sessions[sessionId] = session;
await writeState(config, state);

emit({ type: 'assistant', session_id: sessionId, message: { model, content: [{ type: 'text', text: turn.text }] } });
emit({
  type: 'result', subtype: 'success', is_error: false, session_id: sessionId, result: turn.text,
  usage: { input_tokens: turn.usage.inputTokens, output_tokens: turn.usage.outputTokens, cache_read_input_tokens: turn.usage.cachedInputTokens },
  total_cost_usd: session.costUsd,
});
