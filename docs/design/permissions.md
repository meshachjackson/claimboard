# Groups and permissions for boards, projects and cards

Status: **Proposed.** The rules are designed and not yet merged. Part of the open-source work in `docs/design/open-source.md`. This extends that design's `access.json` agent check and the single allowed login. It does not replace them.

## The rules

- People and agents belong to **groups**. `admins` and `everyone` always exist and cannot be removed. The owner who runs onboarding is the first admin.
- A **rule** gives one group one **level** on one **board, project or card**. Levels: `none`, `view`, `edit`, `manage`.
- The **most specific rule** that names one of your groups wins: card, then project, then board, then the policy default.
- Inside one scope you get the highest level your groups hold, except `none`: a `none` from any of your groups at that scope hides it.
- A hidden board hides every card on it, whatever the card's own rule says.
- `admins` always have `manage`, so a bad rule never locks the owner out. A policy that removes `admins`, empties it, or names an unknown group is refused before it is saved.
- A card with no `board_id` is on the `main` board. `board_id` is a new optional card field.

Example: an `exec` board with `developers` set to `none` and `executives` set to `edit`; the `main` board open to `everyone`; one project that developers may only `view`.

## Where it runs

| Piece | File |
|---|---|
| Rules, levels, filtering, onboarding builder, policy check (pure) | `shared/access.ts` |
| Policy file `.data/access-policy.json`, admin check, card check | `server/utils/policy.ts` |
| People: rows cut to what their groups may see | `server/api/board.get.ts` |
| People: edit ops need `edit` on the card | `server/api/board/[op].post.ts` |
| Agents: same policy under the agent id; `list_claimable` drops hidden work | `server/utils/agentOps.ts` (`runAgentOp`) |
| Admin API | `server/api/access/` (GET, PUT, `onboard` POST) |

**No policy file means no limits.** Existing installs behave as before until onboarding runs. A damaged policy file refuses every request rather than opening the board.

## Onboarding

1. Sign in (the first allowed login).
2. Name the groups the team needs (for example executives, developers) and who is in each: `POST /api/access/onboard` with `{ groups: [{ name, members }] }`. Members are `person:<github login>` or `agt-<id>`.
3. The server writes the starting policy: the caller is admin, everyone is in `everyone`, and the default level is `edit` so nothing is hidden yet.
4. The admin adds rules with `PUT /api/access`, then registers agents (the existing form) and puts them in groups.

## The board manager agent

The board manager is an ordinary agent. It reaches the board only through `runAgentOp`, so it is held to the same policy under its agent id: it cannot read, claim or write a card its groups cannot reach, and it sees only permitted cards in `list_claimable`.

## Known limits

- **n8n-gateway mode.** The checks run in this server, not in n8n. The cache path `get_task` and `list_claimable` are covered; a sealed (OAuth) call that goes through `runViaGateway` is still checked first, because the gate runs before it. Rules do not reach `gov_access`, which stays Regina's.
- **Sign-in is still the allowed-logins list.** A person must be on `NUXT_ALLOWED_LOGINS` before groups apply.
- **Briefs.** `read_brief` and `vera_brief` answer across every card and cannot be cut per card, so an agent needs view on the `main` board to get one (`agentRefusal`). An agent with view on `main` can still see cards from other boards in a brief.
- **Creating a card** needs edit on the card's board and project, for people (`/api/board/create_task`) and agents (`agentRefusal`).
- **Real-time events** (`/api/board/events`, `/api/agent/events`) are not filtered. They carry only a "changed" timestamp and no rows, so nothing about a hidden card leaves.
- **Screens.** `/onboarding` (first run: name groups and members), `/access` (admins: groups, members, rules, default) and a Board picker in the ticket editor. The account menu links to them. None has been clicked through in a browser yet.

## Related design

This design builds on `docs/design/open-source.md`, which holds the install, the registration form and `access.json`. This page adds who may see and edit what.
