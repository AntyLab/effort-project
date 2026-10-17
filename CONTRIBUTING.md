# Contributing

Small, testable contributions are welcome. Open an issue describing the behavior, provider/CLI version, and reproduction steps before a large adapter or architecture change. Never include account tokens, prompt transcripts, or private code.

Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Choose an [issue form](https://github.com/AntyLab/effort-project/issues/new/choose) for a bug report, a feature request, or an integration report (how a particular agent CLI or host behaves with Effort). Issues labeled `good first issue` or `help wanted` are good places to start. Report a suspected vulnerability privately as described in [SECURITY.md](SECURITY.md), not in a public issue.

Use Node 22+ and the built-in test runner. No dependency installation is required. Run `npm test`, `npm run check`, and `npm run smoke:package`. The smoke check requires npm and uses only a temporary offline installation of the local package. Tests must use temporary directories and fake processes by default; do not silently consume a contributor's model quota or edit their provider configuration.

For adapter changes, provide the exact supported effort control, resume semantics, cancellation behavior, permission boundary, and usage accounting scope. Test unsupported versions and failure cases. UI and docs must distinguish advice, requested effort, accepted configuration, and measured quality.

Performance/quality claims need an evaluation protocol with held-out tasks, independent acceptance checks, repeat runs, fixed model versions, all-attempt costs, and uncertainty. A lower escalation rate or shorter answer alone is not proof of success.

Pull requests start from a template that mirrors these checks. Add a line under **Unreleased** in [CHANGELOG.md](CHANGELOG.md) for any user-visible change.

Follow the MIT license. You do not need to sign a CLA for this project.
