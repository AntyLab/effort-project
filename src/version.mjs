import { readFileSync } from 'node:fs';

/** The package manifest is the only place the release version is written. */
export const VERSION = (() => {
  // npm always ships package.json; a copied src/ folder must still load, so report unknown.
  try { return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version ?? 'unknown'; }
  catch { return 'unknown'; }
})();
