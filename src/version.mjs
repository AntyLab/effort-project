import { readFileSync } from 'node:fs';

/** The package manifest is the only place the release version is written. */
export const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
