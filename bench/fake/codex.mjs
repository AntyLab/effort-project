// Offline stand-in for `codex app-server --listen stdio://`. It implements only
// the JSON-RPC messages that src/adapters/codex.mjs sends and never contacts a model.
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { FAKE_VERSION, readConfig, readState, simulateTurn, writeState } from './model.mjs';

const { config, args } = await readConfig(process.argv.slice(2));
if (args[0] !== 'app-server') {
  process.stderr.write('The fake Codex CLI only implements app-server.\n');
  process.exit(2);
}

const zero = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const reply = (id, result) => send({ id, result });
const notify = (method, params) => send({ method, params });
const reportUsage = (usage) => ({ ...usage, totalTokens: usage.inputTokens + usage.outputTokens, reasoningOutputTokens: 0 });
let thread = null;

async function handle({ id, method, params = {} }) {
  switch (method) {
    case 'initialize':
      return reply(id, { userAgent: FAKE_VERSION });
    case 'initialized':
      return undefined;
    case 'thread/start':
    case 'thread/resume': {
      if (method === 'thread/resume') {
        const saved = (await readState(config)).sessions[params.threadId];
        if (!saved) return send({ id, error: { code: -32602, message: 'Unknown thread.' } });
        thread = { id: params.threadId, ...saved };
      } else {
        thread = { id: `fake-thread-${randomUUID()}`, model: params.model ?? config.model ?? 'fake-codex', effort: null, total: { ...zero } };
      }
      reply(id, {
        thread: { id: thread.id, status: { type: 'idle' } }, model: thread.model,
        sandbox: { type: params.sandbox === 'workspace-write' ? 'workspaceWrite' : 'readOnly' },
        approvalPolicy: params.approvalPolicy, approvalsReviewer: 'user',
      });
      // A resumed thread first reports its running total; the adapter uses it as the per-turn baseline.
      if (method === 'thread/resume') notify('thread/tokenUsage/updated', { threadId: thread.id, turnId: 'earlier', tokenUsage: { total: reportUsage(thread.total), last: reportUsage(zero) } });
      return undefined;
    }
    case 'model/list':
      return reply(id, { data: [{ id: thread?.model, model: thread?.model, supportedReasoningEfforts: ['low', 'medium', 'high'].map((reasoningEffort) => ({ reasoningEffort })) }], nextCursor: null });
    case 'turn/start': {
      const turnId = `fake-turn-${randomUUID()}`;
      thread.effort = params.effort;
      reply(id, { turn: { id: turnId, status: 'inProgress', items: [] } });
      const state = await readState(config);
      const turn = await simulateTurn(config, state, { cwd: params.cwd, effort: params.effort, canWrite: params.sandboxPolicy?.type === 'workspaceWrite' });
      thread.total = Object.fromEntries(Object.keys(zero).map((key) => [key, thread.total[key] + turn.usage[key]]));
      state.sessions[thread.id] = { model: thread.model, effort: thread.effort, total: thread.total };
      await writeState(config, state);
      notify('item/completed', { threadId: thread.id, turnId, item: { id: `message-${turnId}`, type: 'agentMessage', phase: 'final_answer', text: turn.text } });
      notify('thread/tokenUsage/updated', { threadId: thread.id, turnId, tokenUsage: { total: reportUsage(thread.total), last: reportUsage(turn.usage) } });
      return notify('turn/completed', { threadId: thread.id, turn: { id: turnId, status: 'completed', items: [], error: null } });
    }
    case 'thread/read':
      return reply(id, { thread: { id: thread?.id, reasoningEffort: thread?.effort } });
    case 'turn/interrupt':
      return reply(id, {});
    default:
      if (id !== undefined) send({ id, error: { code: -32601, message: `The fake Codex CLI does not implement ${method}.` } });
      return undefined;
  }
}

// Handle messages one at a time, in order, like a single-threaded server.
let queue = Promise.resolve();
createInterface({ input: process.stdin })
  .on('line', (line) => {
    if (!line.trim()) return;
    const message = JSON.parse(line);
    queue = queue.then(() => handle(message)).catch((error) => {
      process.stderr.write(`fake codex: ${error.message}\n`);
      process.exitCode = 1;
    });
  })
  .on('close', () => { queue.finally(() => process.exit()); });
