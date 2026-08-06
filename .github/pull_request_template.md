## What this changes

<!-- What the change does, and why it is needed. -->

## How it was verified

<!-- Tests added or run, and anything checked by hand. -->

- [ ] `pnpm test`
- [ ] `pnpm run test:e2e` (if the server changed)
- [ ] `mvn test` in `clients/spring-boot-starter` (if the starter changed)

## Checklist

- [ ] The base branch is `dev` (only a release PR targets `main`)
- [ ] Commits are signed off (`git commit -s`) — see [CONTRIBUTING.md](../CONTRIBUTING.md)
- [ ] Client code stays Apache-2.0; server and UI stay AGPL-3.0
- [ ] No new runtime dependency, or the reason for one is explained above
- [ ] The ingestion path is untouched, or the change keeps it free of ORM, guards,
      pipes, interceptors and outbound calls
