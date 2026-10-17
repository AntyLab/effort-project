<!--
Thanks for contributing. Small, focused pull requests are easiest to review. For a large adapter or
architecture change, open an issue first (see CONTRIBUTING.md).
Never include tokens, prompt transcripts, private code or .env contents anywhere in this pull
request, including logs and screenshots.
-->

## What does this change, and why?

<!-- Link the issue it closes or relates to, for example "Fixes #123". -->

## Checks

- [ ] `npm test` passes
- [ ] `npm run check` passes
- [ ] `npm run smoke:package` passes (it needs npm and uses only a temporary offline install)
- [ ] Tests use temporary directories and fake processes. They make no paid model calls, use none of my model quota and change no provider configuration
- [ ] Documentation and UI text keep advice, requested effort, accepted configuration and measured quality distinct
- [ ] The diff, logs and screenshots contain no tokens, transcripts, private code or `.env` content
- [ ] User-visible changes have a line under **Unreleased** in `CHANGELOG.md`

### Adapter or integration changes

<!-- Delete this section if it does not apply. -->

- [ ] Documents the exact supported effort control (flag, request field, hook or setting)
- [ ] Documents resume semantics
- [ ] Documents cancellation behavior
- [ ] Documents the permission boundary
- [ ] Documents the scope of usage accounting
- [ ] Tests cover unsupported versions and failure cases

### Performance or quality claims

<!-- Delete this section if the pull request makes no such claim. -->

A claim needs an evaluation protocol: held-out tasks, independent acceptance checks, repeat runs, fixed model versions, all-attempt costs and uncertainty. A lower escalation rate or a shorter answer alone is not proof of success. Describe the protocol and link the results.

## How I tested

<!--
Commands you ran, platforms and Node.js versions, and what you saw. If you ran a live provider check
yourself, give the provider, CLI version and model, say that it used a disposable workspace, and
state what it does and does not establish.
-->
