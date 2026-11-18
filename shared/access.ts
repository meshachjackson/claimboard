// Group-based access to boards, projects and cards (docs/design/permissions.md).
// Pure functions with no Nitro auto-imports, so the app, the server and the tests all use the same rules.
//
// Model: people and agents belong to groups. A rule says "this group gets this level on this board, project or card".
// Levels run none < view < edit < manage. The most specific rule that names one of your groups wins:
// card, then project, then board, then the policy default. Within one scope you get the highest level any of your groups holds,
// except that an explicit `none` from any of your groups at that scope hides it (a deny beats a grant at the same scope).
// The owner group (admins) always has manage on everything, so a mistake in a rule can never lock the owner out.
import type { BoardData, GovTask } from '~~/app/types/board'

export const LEVELS = ['none', 'view', 'edit', 'manage'] as const
export type Level = typeof LEVELS[number]

export const SCOPES = ['board', 'project', 'card'] as const
export type Scope = typeof SCOPES[number]

/** The group every person and agent is in. It cannot be deleted or emptied. */
export const EVERYONE = 'everyone'
/** The group whose members administer groups and rules. It cannot be deleted, and always keeps manage. */
export const ADMINS = 'admins'
/** A card with no board_id belongs here. */
export const DEFAULT_BOARD = 'main'

export interface Group { id: string, name: string, members: string[] }
/** `target` is a board id, a project_id or a task_id, depending on `scope`. */
export interface Rule { scope: Scope, target: string, group: string, level: Level }
export interface Policy {
  groups: Group[]
  rules: Rule[]
  /** What a resource with no matching rule gives. A new install uses `edit`, so nothing changes until an admin adds rules. */
  default: Level
}

/** A policy that restricts nothing: one everyone group, the owner as admin. What a fresh install and an upgraded one start with. */
export function openPolicy(owner: string): Policy {
  return {
    groups: [
      { id: ADMINS, name: 'Admins', members: [owner] },
      { id: EVERYONE, name: 'Everyone', members: [owner] }
    ],
    rules: [],
    default: 'edit'
  }
}

const rank = (l: Level): number => LEVELS.indexOf(l)
export const atLeast = (have: Level, need: Level): boolean => rank(have) >= rank(need)

/** The ids of the groups a person or agent is in. Everyone is implicit; admins come from the admins group's members. */
export function groupsOf(policy: Policy, who: string): string[] {
  const ids = policy.groups.filter(g => g.members.includes(who)).map(g => g.id)
  return ids.includes(EVERYONE) ? ids : [...ids, EVERYONE]
}

/** The level `who` holds at one scope, or null when no rule at that scope names one of their groups. */
function levelAt(policy: Policy, mine: string[], scope: Scope, target: string): Level | null {
  const hits = policy.rules.filter(r => r.scope === scope && r.target === target && mine.includes(r.group))
  if (!hits.length) return null
  if (hits.some(r => r.level === 'none')) return 'none'
  return hits.reduce<Level>((best, r) => (rank(r.level) > rank(best) ? r.level : best), 'none')
}

export interface Resource { board?: string, project?: string, card?: string }

/** The effective level of `who` on a resource: most specific scope with a rule for them, else the default. */
export function levelFor(policy: Policy, who: string, res: Resource): Level {
  const mine = groupsOf(policy, who)
  if (mine.includes(ADMINS)) return 'manage'
  const steps: [Scope, string | undefined][] = [['card', res.card], ['project', res.project], ['board', res.board ?? DEFAULT_BOARD]]
  for (const [scope, target] of steps) {
    if (!target) continue
    const level = levelAt(policy, mine, scope, target)
    if (level) return level
  }
  return policy.default
}

/** The resource a card sits in. A card is also gated by its board: a hidden board hides all of its cards, whatever the card rule says. */
export function cardResource(task: Pick<GovTask, 'task_id' | 'project_id'> & { board_id?: string }): Resource {
  return { board: task.board_id || DEFAULT_BOARD, project: task.project_id || undefined, card: task.task_id }
}

/** A card is visible only when its board is visible and the card's own level is view or more. */
export function canViewCard(policy: Policy, who: string, task: Parameters<typeof cardResource>[0]): boolean {
  const res = cardResource(task)
  if (!atLeast(levelFor(policy, who, { board: res.board }), 'view')) return false
  return atLeast(levelFor(policy, who, res), 'view')
}

export function canEditCard(policy: Policy, who: string, task: Parameters<typeof cardResource>[0]): boolean {
  return canViewCard(policy, who, task) && atLeast(levelFor(policy, who, cardResource(task)), 'edit')
}

/** The board data `who` may see: their cards and those cards' steps and notes. Columns and the registry are not card data and pass through. */
export function filterBoard(policy: Policy, who: string, data: BoardData): BoardData {
  const tasks = data.tasks.filter(t => canViewCard(policy, who, t))
  const ids = new Set(tasks.map(t => t.task_id))
  return {
    ...data,
    tasks,
    steps: data.steps.filter(s => ids.has(s.task_id)),
    notes: data.notes.filter(n => ids.has(n.task_id))
  }
}

/** Onboarding step 2: the owner names the groups their team needs and who is in them. Admins and everyone are always added. */
export function startingPolicy(owner: string, groups: { name: string, members?: string[] }[]): Policy | string {
  const policy = openPolicy(owner)
  for (const g of groups) {
    const id = g.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    if (!id) return 'every group needs a name'
    if (policy.groups.some(x => x.id === id)) continue
    policy.groups.push({ id, name: g.name.trim(), members: [...new Set(g.members ?? [])] })
  }
  const everyone = policy.groups.find(g => g.id === EVERYONE)!
  everyone.members = [...new Set(policy.groups.flatMap(g => g.members))]
  return checkPolicy(policy) ?? policy
}

/** Why a policy is unusable, or null. Run before saving, so a bad edit never reaches the file. */
export function checkPolicy(policy: unknown): string | null {
  if (!policy || typeof policy !== 'object') return 'the policy must be an object'
  const p = policy as Policy
  if (!Array.isArray(p.groups) || !Array.isArray(p.rules)) return 'the policy needs groups and rules'
  if (!(LEVELS as readonly string[]).includes(p.default)) return `default must be one of ${LEVELS.join(', ')}`
  const ids = new Set<string>()
  for (const g of p.groups) {
    if (!g || !/^[a-z0-9_-]{1,40}$/.test(String(g.id))) return 'group ids are lowercase slugs, such as developers'
    if (ids.has(g.id)) return `group ${g.id} is listed twice`
    if (!Array.isArray(g.members)) return `group ${g.id} needs a members list`
    ids.add(g.id)
  }
  const admins = p.groups.find(g => g.id === ADMINS)
  if (!ids.has(EVERYONE) || !admins) return 'the everyone and admins groups cannot be removed'
  if (!admins.members.length) return 'the admins group needs at least one member'
  // An agent-only admins group would lock the owner out of the access screen.
  if (!admins.members.some(m => String(m).startsWith('person:'))) return 'the admins group needs at least one person, not only agents'
  for (const r of p.rules) {
    if (!(SCOPES as readonly string[]).includes(r.scope)) return `rule scope must be one of ${SCOPES.join(', ')}`
    if (!(LEVELS as readonly string[]).includes(r.level)) return `rule level must be one of ${LEVELS.join(', ')}`
    if (!r.target) return 'every rule needs a target'
    if (!ids.has(r.group)) return `rule names unknown group ${r.group}`
  }
  return null
}

/** Ops that only read one card. Every other op that names a card or a step changes it and needs edit. */
export const CARD_READ_OPS = ['get_task', 'read_task']
/** Ops that answer a summary across every card. The answer cannot be cut per card, so an agent needs view on the main board. */
export const BRIEF_OPS = ['read_brief', 'vera_brief']

/**
 * Why an agent may not run this op, or null. Pure, so the tests cover the gate without a server.
 * `task` is the card the op names (already resolved from a step id). `create_task` is checked against the board and
 * project the new card would land in. The "changed" event streams carry no rows, so they are not gated.
 */
export function agentRefusal(
  policy: Policy,
  agentId: string,
  op: string,
  args: Record<string, unknown>,
  task: Parameters<typeof cardResource>[0] | undefined
): string | null {
  if (BRIEF_OPS.includes(op)) {
    return atLeast(levelFor(policy, agentId, { board: DEFAULT_BOARD }), 'view') ? null : `${agentId} may not read the brief`
  }
  if (op === 'create_task') {
    const board = String(args.board_id ?? '') || DEFAULT_BOARD
    const project = String(args.project_id ?? '') || undefined
    return atLeast(levelFor(policy, agentId, { board, project }), 'edit') ? null : `${agentId} may not create cards on ${board}`
  }
  if (!task) return null // no card named, or a card that does not exist: the op reports its own error
  const reads = CARD_READ_OPS.includes(op)
  const allowed = reads ? canViewCard(policy, agentId, task) : canEditCard(policy, agentId, task)
  return allowed ? null : `${agentId} may not ${reads ? 'view' : 'edit'} ${task.task_id}`
}

/** The card an op names: its task_id, or else the card its step_id belongs to (cancel_step and the step ops name only a step). */
export function cardIdFor(args: Record<string, unknown>, steps: { step_id: string, task_id: string }[]): string {
  const taskId = String(args.task_id ?? '')
  if (taskId || !args.step_id) return taskId
  return steps.find(s => s.step_id === args.step_id)?.task_id ?? ''
}

/**
 * Why a signed-in person may not run this board write, or null. Every owner op changes something, so the card needs edit.
 * `create_task` needs edit on the board and project the new card lands in. Pure, so the tests cover the person route too.
 */
export function personRefusal(
  policy: Policy,
  who: string,
  op: string,
  args: Record<string, unknown>,
  board: Pick<BoardData, 'tasks' | 'steps'>
): string | null {
  if (op === 'create_task') {
    const target = String(args.board_id ?? '') || DEFAULT_BOARD
    const project = String(args.project_id ?? '') || undefined
    return atLeast(levelFor(policy, who, { board: target, project }), 'edit') ? null : 'You may not create cards there'
  }
  const taskId = cardIdFor(args, board.steps)
  const task = board.tasks.find(t => t.task_id === taskId)
  if (!task) return null // no card named, or a card that does not exist: the op reports its own error
  return canEditCard(policy, who, task) ? null : `${who} may not edit ${taskId}`
}

/** The boards `who` can see: the main board, every board a rule names, and every board a card sits on, minus the hidden ones. */
export function visibleBoards(policy: Policy | null, who: string, tasks: { board_id?: string }[]): string[] {
  const ids = new Set<string>([DEFAULT_BOARD, ...tasks.map(t => t.board_id || '').filter(Boolean)])
  for (const r of policy?.rules ?? []) if (r.scope === 'board') ids.add(r.target)
  return [...ids].filter(b => !policy || atLeast(levelFor(policy, who, { board: b }), 'view')).sort()
}

/** The steps in a list_claimable answer whose card `agentId` may edit. A step whose card is not on the board stays in. */
export function claimableFor<S extends { task_id: string }>(policy: Policy, agentId: string, steps: S[], tasks: Parameters<typeof cardResource>[0][]): S[] {
  return steps.filter((s) => {
    const t = tasks.find(x => x.task_id === s.task_id)
    return !t || canEditCard(policy, agentId, t)
  })
}

/** An event stream carries no rows, but a caller who can see no board has no business watching for changes. */
export function mayWatch(policy: Policy | null, who: string): boolean {
  return visibleBoards(policy, who, []).length > 0
}
