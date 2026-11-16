import * as codex from './adapters/codex.mjs';
import * as claude from './adapters/claude.mjs';
import * as gemini from './adapters/gemini.mjs';
export const adapters = {codex,claude,gemini};
export const capabilities = () => [codex.capabilities,{...claude.capabilities,notes:claude.capabilities.notes+' The experimental effort auto claude command selects effort before each prompt in an Effort-managed conversation; it does not attach to the native Claude UI.'},
  {...gemini.capabilities,notes:gemini.capabilities.notes+' The experimental effort auto gemini command selects effort before each prompt in an Effort-managed conversation.'},
  {id:'opencode',name:'OpenCode native plugin',levels:['low','medium','high','xhigh','max'],control:'automatic-per-prompt',notes:'Opt-in project plugin selects only an advertised model variant before requests. Explicit settings win; the selected model stays unchanged. Listed levels are potential variants, not guaranteed model support. Offline hook contracts tested; native model acceptance unverified. Use effort config opencode.'},
  {id:'desktop',name:'Codex app / Claude app / other MCP hosts',levels:['low','medium','high'],control:'advisory',notes:'MCP recommendations only. The host must support local stdio MCP. This server cannot change the effort of the host conversation. No universal desktop control is claimed.'}];

export function getAdapter(name) {
  if (!Object.hasOwn(adapters,name)) throw new Error('Managed runs support codex, claude, or gemini. Other hosts can use advisory MCP tools.');
  return adapters[name];
}
