# Contributing to MergeRisk

Thanks for helping improve MergeRisk. Please search existing issues before
opening a new one and keep pull requests focused on one change.

## Development setup

MergeRisk requires Node.js 24.x and npm.

```bash
npm ci
npm test
npm run typecheck
npm run build
git diff --exit-code -- dist/
```

The Action ships the generated `dist/` bundle. Any change that affects the
bundle must include the freshly generated `dist/` output in the same pull
request.

## Pull requests

- Add or update focused tests for behavior changes.
- Run the commands above before requesting review.
- Describe user-visible behavior and any changes to inputs, outputs, or
  permissions.
- Do not include secrets, production tokens, or private pull-request content.

## Reporting issues

Use GitHub Issues for reproducible bugs and feature requests. For a security
vulnerability, follow [SECURITY.md](SECURITY.md) instead of opening a public
issue.

## Conduct

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).
