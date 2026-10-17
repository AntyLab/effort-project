// UserPromptSubmit hook of the Effort Project Claude Code plugin (hooks.json).
// Advisory only; see docs/claude-code-plugin.md. It always exits 0, so a broken
// install or a failure can never block a prompt.
process.stdout.on('error', () => {});
try {
  const { runPromptHook } = await import('../src/integrations/claude-code-hook.mjs');
  await runPromptHook();
} catch {
  // Nothing to report into the session: staying silent is the fail-open path.
} finally {
  process.exit(0);
}
