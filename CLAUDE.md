Instance rules: read `instance/CLAUDE.md` first. It holds the owner's rules for this checkout and overrides what follows. In a public clone the folder does not exist, so skip this line.
@instance/CLAUDE.md

# agent-board

A kanban board for people who work with AI agents. Read `README.md` for the install and `CONTRIBUTING.md` for how to work on it.

## Contributor basics

- Read `docs/architecture.md` (the model, columns, steps and the storage seam) and `docs/schema.md` (field names and allowed values) before changing board logic.
- Node 24 (`.nvmrc`) and pnpm. Run `pnpm dev`, `pnpm test` and `pnpm typecheck`.
- Field names and enum values match `docs/schema.md` exactly. Labels and colors live only in `app/types/board.ts`.
- No secrets, tokens or credential values in the repo, fixtures or logs. Refer to credentials by name. Values go in `.env`, which is git-ignored.
- No private or client data in the repo or the fixtures. Use synthetic rows.
- Dates in the UI use American format: 10/25/2026, 9:05 AM.
- Keep components small. Comment logic that is not obvious. No clever abstractions.
- Ask before adding a dependency.
- Plain language and active voice in docs and UI text.

## Public vs private

This repository is a public, MIT-licensed project. Treat everything in it, and
every issue, pull request and commit message, as readable by strangers.

**Where a change goes.** Ask: would this help any user, with no personal data?

- Yes: it belongs here, in core.
- No: it belongs in a private fork of this repository (an "instance"), not here.
- Unsure: do not put it here. Raise it with the maintainer.

**Never put in this repository:**

- Real names of clients or companies, account IDs, internal URLs, hostnames.
- Ticket IDs from a private tracker.
- Keys, tokens, passwords, or personal data of any kind.
- Settings that only make sense for one person. Read them from environment
  variables or an `instance/` folder instead.

**Fixes.** A bug in core is fixed here first. Forks pull the fix with a normal
`git merge`.

**Before any push to the public remote,** run the maintainer's pre-push check
and fix everything it reports.

**Commits.** Use the GitHub noreply email for the author on this repository.

**Security reports** go through a private advisory, never a public issue. See
`SECURITY.md`.
