#!/usr/bin/env node
// Effort benchmark harness. Usage and cost notes: bench/README.md.
import { main } from './lib/cli.mjs';

const controller = new AbortController();
process.once('SIGINT', () => {
  process.stderr.write('\nStopping: cancelling the current run, then writing the summary. Press Ctrl+C again to quit at once.\n');
  controller.abort();
});
process.exitCode = await main(process.argv.slice(2), { signal: controller.signal });
