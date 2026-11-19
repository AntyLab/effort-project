import { plainReport, reportsTestFailure, suiteBlocker } from './test-reports.mjs';

export const POLICY_VERSION = 'rules-0.5';
export const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
export const MODELS = Object.freeze({
  claude: Object.freeze({ fast: 'haiku', daily: 'sonnet', frontier: 'fable' }),
  codex: Object.freeze({ fast: 'gpt-6-luna', daily: 'gpt-6.2-sol', frontier: 'gpt-6.2-astra' }),
  gemini: Object.freeze({ fast: 'gemini-4-hydrogen', daily: 'gemini-4-argon', frontier: 'gemini-4-argon' }),
});
export const TIERS = ['fast', 'daily', 'frontier'];

// Regex sources, grouped by language: English, Spanish, French, German,
// Portuguese and Italian. Compile once; Unicode boundaries keep accented words
// whole too (JavaScript's \b only recognizes ASCII word characters).
function keywordPattern(terms) {
  return new RegExp(`(?<![\\p{L}\\p{N}_])(?:${terms.join('|')})(?![\\p{L}\\p{N}_])`, 'iu');
}

const criticalWords = keywordPattern([
  String.raw`auth(?:entication|orization)?|permission|cryptograph\w*|encrypt\w*|payments?|migrations?|race condition|deadlock|data loss|security|vulnerability`,
  String.raw`logins?|log\s+in|sign[- ]?in|sign[- ]?up|passwords?|tokens?|secrets?|credentials?|billing|invoices?|(?:production|prod)\s+outage|drop\s+table|truncate|wipe|delet(?:e[sd]?|ing)\s+(?:[\p{L}\p{N}_-]+\s+){0,6}data|PII|privacy`,
  // Money movement. "transfer" alone is too often files or ownership, so it needs a money word.
  String.raw`funds|balances?|ledgers?|refunds?|payouts?|withdrawals?|deposits?|(?:money|funds?|bank|wire|account)\s+transfers?|transfer(?:s|ring)?\s+(?:of\s+)?(?:money|funds)`,
  String.raw`seguridad|saldos?|fondos|reembolsos?|transferencias?\s+bancarias|libro\s+mayor|autenticación|pagos?|migración|pérdida\s+de\s+datos|contraseñas?`,
  String.raw`sécurité|soldes?|virements?|remboursements?|grand\s+livre|authentification|paiements?|migration|perte\s+de\s+données|mot\s+de\s+passe`,
  String.raw`Sicherheit|Guthaben|Kontostand|Überweisung(?:en)?|Rückerstattung(?:en)?|Hauptbuch|Authentifizierung|Zahlung|Migration|Datenverlust|Passwort`,
  String.raw`segurança|saldos?|fundos|reembolsos?|transferências?\s+bancárias|livro[- ]razão|autenticação|pagamentos?|migração|perda\s+de\s+dados|senhas?`,
  String.raw`sicurezza|saldi|saldo|bonific[oi]|rimborsi?|libro\s+mastro|autenticazione|pagamento|migrazione|perdita\s+di\s+dati|password`,
]);
const complexWords = keywordPattern([
  String.raw`architect\w*|investigate|diagnos\w*|refactor|concurren\w*|intermittent|distributed|across|root cause|regression|debug`,
  String.raw`crash(?:es|ing)?|flaky|leaks?|hang(?:s|ing)?|freez(?:e[sd]?|ing)|performance|slow(?:ness)?|bottlenecks?|randomly|sometimes\s+fails?|bisect`,
  String.raw`investigar|depurar|refactorizar|condición\s+de\s+carrera|intermitente`,
  String.raw`enquêter|déboguer|refactoriser|condition\s+de\s+course|intermittent|plantage`,
  String.raw`untersuchen|debuggen|refaktorieren|Race\s+Condition|sporadisch|Absturz`,
  String.raw`investigar|depurar|refatorar|condição\s+de\s+corrida|intermitente|travamento`,
  String.raw`indagare|debuggare|rifattorizzare|condizione\s+di\s+gara|intermittente|arresto\s+anomalo`,
]);
const mechanicalWords = keywordPattern([
  String.raw`rename|typo|spelling|translate|summarize|capitaliz\w*`,
  // "format" only as a request to format something ("Format src/a.js", "please format the table").
  // As a noun ("the format documented in X", "the key format.") it describes real work.
  String.raw`(?<=^\s*|[.!?;:,\n]\s*|(?<![\p{L}\p{N}_])(?:please|to|and|then|you|just|also|should|must|could|can|will)\s+)format(?=\s+\S)`,
  // Only a comment edit is mechanical: "follow its doc comment" or review comments are real work.
  String.raw`(?:add|write|fix|update|remove|delete|reword|improve)\s+(?:a\s+|an\s+|the\s+|some\s+|its\s+)?(?:code\s+|inline\s+)?(?:comments?|docstrings?)|lint|indent(?:ation)?|bump\s+the\s+version|version\s+bump|wording|reword|whitespace|sort\s+imports`,
  String.raw`errata|falta\s+de\s+ortografía|ortografía|renombrar|traducir|formatear`,
  String.raw`faute\s+de\s+frappe|orthographe|renommer|traduire|formater`,
  String.raw`Tippfehler|Rechtschreibung|umbenennen|übersetzen|formatieren`,
  String.raw`erro\s+de\s+digitação|ortografia|renomear|traduzir|formatar`,
  String.raw`refuso|errore\s+di\s+battitura|ortografia|rinominare|tradurre|formattare`,
]);

export function modelTier(features) {
  if (features.critical && features.complex) return 'frontier';
  if (features.mechanical && !features.broadEdit && !features.critical && !features.complex) return 'fast';
  return 'daily';
}

export function chooseModel(provider, tier, available) {
  if (!Object.hasOwn(MODELS, provider) || !Object.hasOwn(MODELS[provider], tier)) return undefined;
  const model = MODELS[provider][tier];
  return Array.isArray(available) && !available.includes(model) ? undefined : model;
}

export function validateLevel(level) {
  if (!LEVELS.includes(level)) throw new Error(`Unsupported effort: ${level}`);
  return level;
}

export function recommend({ prompt, provider = 'generic', facts = {}, maxEffort = 'high', minEffort = 'low' }) {
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 100_000) throw new Error('Prompt must contain 1–100,000 characters.');
  if (![...Object.keys(MODELS), 'generic'].includes(provider)) throw new Error('Provider must be codex, claude, gemini, or generic.');
  validateLevel(maxEffort); validateLevel(minEffort);
  if (LEVELS.indexOf(minEffort) > LEVELS.indexOf(maxEffort)) throw new Error('Minimum effort exceeds maximum.');
  const critical = criticalWords.test(prompt);
  const complex = complexWords.test(prompt);
  const mechanical = mechanicalWords.test(prompt) && prompt.length < 350;
  // Breadth comes from what the request names: five or more distinct workspace files
  // make an edit broad. The checkout's language count describes the repository, not
  // this request, so it is reported but never changes effort.
  const broadEdit = Number(facts.mentionedFiles) >= 5;
  const manyLanguages = Number(facts.languages?.length) >= 3;
  const narrow = mechanical && !broadEdit;
  let effort = critical || complex ? 'high' : narrow ? 'low' : 'medium';
  const reasons = [];
  if (critical) reasons.push('The request touches behavior where an incorrect change can be costly.');
  if (complex) reasons.push('The request suggests investigation or changes with interacting parts.');
  if (narrow && !critical && !complex) reasons.push('The request appears short and mechanical; verify the result before accepting it.');
  // A broad edit raises one level and never past high.
  if (broadEdit && LEVELS.indexOf(effort) < LEVELS.indexOf('high')) {
    const raised = LEVELS[LEVELS.indexOf(effort) + 1];
    reasons.push(`Repository breadth raised ${effort} to ${raised}: the request names five or more workspace files.`);
    effort = raised;
  }
  if (!reasons.length) reasons.push('Difficulty is uncertain; start at medium and use an independent check.');
  if (manyLanguages && !critical && !complex && !broadEdit) reasons.push('The workspace contains several languages; that describes the checkout, not this request, so it does not change effort.');
  const unclamped = effort;
  const index = Math.max(LEVELS.indexOf(minEffort), Math.min(LEVELS.indexOf(maxEffort), LEVELS.indexOf(effort)));
  effort = LEVELS[index];
  if (effort !== unclamped) reasons.push(`Your configured effort bounds changed ${unclamped} to ${effort}.`);
  const features = { promptCharacters: prompt.length, critical, complex, mechanical, broadEdit, manyLanguages, repositoryComplex: broadEdit };
  const tier = modelTier(features);
  return { effort, tier, model: chooseModel(provider, tier) ?? null, reasons, policyVersion: POLICY_VERSION, confidence: 'low',
    features,
    control: provider === 'generic' ? 'advisory' : 'managed-turns',
    caveat: 'A transparent heuristic, not a trained difficulty model or a measured quality guarantee.' };
}

export function classifyFailure(text = '', { timedOut = false } = {}) {
  if (timedOut) return 'timeout';
  const value = String(text).slice(0, 50_000);
  const plain = plainReport(value);
  // A suite that could not run stops, even inside a runner report. Otherwise a
  // runner's failure report wins, because a failing test may itself mention
  // authorization, permissions or missing files.
  const blocker = suiteBlocker(plain);
  if (blocker) return blocker;
  if (reportsTestFailure(plain)) return 'test';
  if (/unauthorized|authentication|invalid.api.key|not.logged.in|login.required|rate.limit|quota|insufficient.credit|usage.limit|out.of.extra.usage/i.test(value)) return 'access';
  if (/permission.denied|operation.not.permitted|EACCES|EPERM|approval.required|permission.request/i.test(value)) return 'permission';
  if (/command.not.found|MODULE_NOT_FOUND|cannot.find.module|ModuleNotFoundError|No module named|ENOENT|ECONNREFUSED|ENOTFOUND|network.unreachable|connection.refused/i.test(value)) return 'environment';
  if (/AssertionError|assertion|ERR_ASSERTION|\bFAIL(?:ED)?\b|\bnot ok\b|expected[\s\S]{0,100}(?:actual|received|but)/i.test(value)) return 'test';
  return 'unknown';
}

export function nextDecision({ effort, kind, repeatCount = 1, maxEffort = 'high', supportedLevels = ['low', 'medium', 'high'] }) {
  validateLevel(effort); validateLevel(maxEffort);
  if (!Array.isArray(supportedLevels) || !supportedLevels.length || supportedLevels.some(x => !LEVELS.includes(x))) throw new Error('Invalid supported effort levels.');
  if (!Number.isInteger(repeatCount) || repeatCount < 1 || repeatCount > 100) throw new Error('repeatCount must be an integer from 1 to 100.');
  if (!['test','access','permission','environment','timeout','unknown'].includes(kind)) throw new Error('Unknown failure kind.');
  if (kind !== 'test') return { action: 'stop', effort, reason: `${kind} failure: more reasoning is not an established remedy.` };
  if (repeatCount < 2) return { action: 'retry', effort, reason: 'One failed check: retry with the concrete test evidence at the current effort.' };
  const candidate = LEVELS.find(x => supportedLevels.includes(x) && LEVELS.indexOf(x) > LEVELS.indexOf(effort) && LEVELS.indexOf(x) <= LEVELS.indexOf(maxEffort));
  if (!candidate) return { action: 'stop', effort, reason: 'Repeated check failure at the configured effort ceiling; stop for review.' };
  return { action: 'escalate', effort: candidate, reason: 'The same check failed repeatedly; test a higher effort on the next managed turn.' };
}
