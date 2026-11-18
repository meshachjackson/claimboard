# Contributing

Thanks for helping. This guide covers setup, tests and pull requests.

## Set up

You need Node 24 (`.nvmrc`; with nvm, run `nvm use`) and pnpm.

```
pnpm install
pnpm run setup      # writes .env and an empty .data/access.json (plain `pnpm setup` is a different pnpm command)
pnpm dev            # http://localhost:3000
```

`pnpm run setup` picks the SQLite backend (`NUXT_BOARD_BACKEND=reference`, also the default when unset). To sign in without GitHub while you develop, set `NUXT_DEV_LOGIN=1` in `.env` and open `/auth/dev`. The README has the full install, including the GitHub OAuth app.

To check a production build, run `pnpm build && pnpm preview`.

## Read first

- [`docs/architecture.md`](docs/architecture.md): the model, columns, steps and the storage seam.
- [`docs/schema.md`](docs/schema.md): field names and allowed values. Match them exactly. Do not rename them in the UI.
- [`docs/design/open-source.md`](docs/design/open-source.md): the two storage adapters and what is configuration.
- [`docs/ux/glossary.md`](docs/ux/glossary.md): every on-screen label.

## Test

```
pnpm test           # node --test 'test/*.test.ts'
pnpm typecheck
```

Run both before you open a pull request. Add a test for new behavior. Tests use synthetic data only.

## Pull requests

- Keep each pull request to one change, small enough to review in one sitting.
- Write the description in plain language: what changed, why, and how you checked it.
- A change to what the board does needs an entry in `app/utils/changelog.ts` with one to four steps in the form "Click X. Expect Y." A change with no visible effect (scripts, docs, flag-off code) goes in `INTERNAL_PRS` with a reason.
- A change to labels, navigation, settings or shortcuts also updates `docs/ux/glossary.md`, the `/help` page and the shortcuts list, and fills in `docs/ux/review-checklist.md` in the description.
- Use American date format in the UI: 10/25/2026, 9:05 AM.
- Keep components small. Comment logic that is not obvious. Ask before you add a dependency.

## Never commit secrets or private data

- No tokens, keys, passwords or credential values in code, fixtures, docs, logs or commit messages. Name the credential instead, and put the value in `.env` (git-ignored).
- No private or customer data. Use the synthetic rows in `mock/`.
- Do not paste real hostnames, internal IDs or personal details into docs or tests. Use placeholders such as `https://your-host.example`.
- If you find a leaked secret, rotate it first, then report it.

## Report a problem

Open an issue. List the steps, what you expected and what happened. Leave out secrets and private data.
