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
// report these as failing tests, but another model attempt cannot fix them.
const BLOCKERS = [
  ['environment', /\bERR_MODULE_NOT_FOUND\b|\bMODULE_NOT_FOUND\b|\bCannot find (?:module|package) ['"]|\bModuleNotFoundError\b|\bNo module named\b|\[setup failed\]/],
  ['environment', /\bconnect ECONNREFUSED\b|\bgetaddrinfo (?:ENOTFOUND|EAI_AGAIN)\b|\bConnectionRefusedError\b|\bconnection refused\b|\bnetwork is unreachable\b/i],
  ['environment', /\bcommand not found\b|is not recognized as an internal or external command/i],
  ['permission', /\bEACCES\b|\bEPERM\b|\bPermissionError\b|\bOperation not permitted\b|\bPermission denied\b/],
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

/**
 * 'environment' or 'permission' when the output shows the suite could not run, else null.
 * Test-name lines are ignored, so a test named "permission denied for guests" still counts as a test.
 */
export function suiteBlocker(plain) {
  const context = NAME_PATTERNS.reduce((text, pattern) => text.replace(pattern, ''), plain);
  return BLOCKERS.find(([, pattern]) => pattern.test(context))?.[0] ?? null;
}
