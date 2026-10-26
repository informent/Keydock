# Contributing to Keydock

Create a feature branch for a focused change, include relevant documentation and tests, and open a pull request against `main`.

Before submitting, run:

```sh
npm ci
npm run verify
npm run test:ui
python -m unittest discover -s sdk/python -p test_keydock.py -v
npm audit --audit-level=high
```

Install the Python client with `python -m pip install ./sdk/python` if needed. Linux browser checks also require `npx playwright install --with-deps chromium`; Windows uses Edge when available. Use the disposable demo or browser fixtures for screenshots, and never include real customer records, raw keys, tokens, or identity files.

## Protected main branch

`main` requires a pull request, an up-to-date branch, and successful `api (ubuntu-latest)` and `api (windows-latest)` checks from GitHub Actions. Resolve review conversations before merging. Linear history is required; use squash or rebase merges.

The rules apply to administrators. Force pushes and branch deletion are disabled. A separate approving reviewer is not currently required. Do not bypass or disable protections to publish a change; fix the failed check on the feature branch instead.
