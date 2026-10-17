// Test-runner report formats, shared by failure classification (policy.mjs) and
// failure fingerprints (verify.mjs) so the two cannot drift apart. Line anchors
// use [ \t]*, never \s*: under the m flag \s* backtracks across runs of blank
// lines, which made a 32 KB tail of newlines take seconds to scan.
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]/g;

// `markers` say a runner reported failing tests. `names` capture one failing test
// (or test file) per match, which identifies a repeated failure.
const REPORTS = [
  { runner: 'node:test spec', markers: [/^[ \t]*✖ \S.*\(\d+(?:\.\d+)?m?s\)$/m, /^ℹ fail [1-9]/m], names: [/^[ \t]*✖ (.+?) \(\d+(?:\.\d+)?m?s\)$/gm] },
  { runner: 'TAP', markers: [/^[ \t]*not ok \d+\b/m, /^# fail [1-9]/m], names: [/^[ \t]*not ok \d+ - (.+)$/gm] },
  { runner: 'jest', markers: [/^[ \t]*FAIL[ \t]+\S/m, /^[ \t]*● (?:.+ › .+|Test suite failed to run)$/m, /^[ \t]*Tests?\b.*\b[1-9]\d* failed\b/m],
    names: [/^[ \t]*● (.+ › .+)$/gm, /^[ \t]*FAIL[ \t]+(\S+?)(?:[ \t]+\(\d+(?:\.\d+)? ?m?s\))?$/gm] },
  { runner: 'vitest', markers: [], names: [/^[ \t]*FAIL[ \t]+(\S+ > .+)$/gm] },
  { runner: 'pytest', markers: [/^FAILED \S+::\S+/m, /^=+ .*\b[1-9]\d* failed\b.* =+$/m], names: [/^FAILED (\S+::\S+)/gm] },
  { runner: 'unittest', markers: [/^FAIL: \S+/m, /^ERROR: \S+ \([^)\n]+\)$/m], names: [/^(?:FAIL|ERROR): (\S+ \([^)\n]+\))$/gm] },
  { runner: 'go test', markers: [/^[ \t]*--- FAIL: \S+/m], names: [/^[ \t]*--- FAIL: (\S+)/gm] },
  { runner: 'cargo test', markers: [/^test \S+ \.\.\. FAILED$/m, /^test result: FAILED\b/m], names: [/^test (\S+) \.\.\. FAILED$/gm] },
  { runner: 'mocha', markers: [/^[ \t]*[1-9]\d* failing$/m], names: [] },
  { runner: 'assertion', markers: [/\bAssertionError\b|\bERR_ASSERTION\b/], names: [] },
];
const NAME_PATTERNS = REPORTS.flatMap((report) => report.names);

// Signs that the suite could not run at all: a missing dependency, an unreachable
// service, an operating-system permission error or a missing command. A runner can
// report these as failing tests, but another model attempt cannot fix them. Each
// pattern matches the form the error takes when it is thrown, never a bare word, so
// a test named "maps EACCES to a 403" or an assertion 'EACCES' !== 'ENOENT' is a test failure.
const SHELL = '^(?:/bin/)?(?:ba|da|z)?sh: (?:line \\d+: |\\d+: )?[^\\n:]+: ';
const BLOCKERS = [
  ['environment', /\bError \[ERR_MODULE_NOT_FOUND\]: Cannot find (?:package|module) |^[ \t]*Error: Cannot find module ['"]|\bCannot find module ['"][^'"\n]+['"] from ['"]|\bModuleNotFoundError: No module named |^ImportError while importing test module |\[setup failed\]/m],
  ['environment', /\bconnect ECONNREFUSED (?:\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:]+\]|[\w.-]+):\d+|\bgetaddrinfo (?:ENOTFOUND|EAI_AGAIN) [\w.-]+|\bConnectionRefusedError: \[Errno \d+\]/],
  ['environment', new RegExp(`${SHELL}(?:command )?not found$|\\bis not recognized as an internal or external command\\b`, 'm')],
  ['permission', new RegExp(`\\b(?:EACCES: permission denied|EPERM: operation not permitted), [a-z]+ ['"]|\\bPermissionError: \\[Errno 1?3\\]|${SHELL}Permission denied$`, 'm')],
];

/** Output without color codes and with Unix line endings. */
export const plainReport = (text) => String(text).replace(ANSI, '').replace(/\r\n?/g, '\n');

/** True when a recognized test runner reported failures. */
export const reportsTestFailure = (plain) => REPORTS.some((report) => report.markers.some((marker) => marker.test(plain)));

/** Failing test names and files a runner printed, each exactly as captured. */
export function failingTestNames(plain) {
  const names = new Set();
  for (const pattern of NAME_PATTERNS) for (const match of plain.matchAll(pattern)) names.add(match[1].trim());
  return names;
}

/** 'environment' or 'permission' when the output shows the suite could not run, else null. */
export function suiteBlocker(plain) {
  const context = NAME_PATTERNS.reduce((text, pattern) => text.replace(pattern, ''), plain);
  return BLOCKERS.find(([, pattern]) => pattern.test(context))?.[0] ?? null;
}
