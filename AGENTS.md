# Agent instructions

## CI is permanently off

GitHub Actions is disabled for this repository on purpose. The owner wants it to stay off.

- Do not enable GitHub Actions or any workflow (no `gh workflow enable`, no `gh api .../actions/permissions`, no repository settings changes).
- Do not add, edit, or restore files under `.github/workflows/`, and do not add Dependabot or other CI configuration.
- Do not wait for, poll, or rely on CI checks. Verify locally instead: `npm test` and `npm run check`.
