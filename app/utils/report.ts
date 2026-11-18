// Board reports: small report tools over plain rows. Each tool answers one question and returns a
// section with a one-line summary and a block the board draws (BoardReport.vue). A report is a list of tool names,
// so "show me the board report" needs no new code: the agent (or the URL) names the tools and the board draws them.
// Pure and one pass per tool, so a board with hundreds of cards stays fast. Lists are capped; `total` keeps the true count.
import type { GovTask, Stage } from '~/types/board'

/** Rows a report reads. Steps and notes are not needed yet. */
export interface ReportRows { tasks: GovTask[] }

/** `task_ids`, `project`, `type` and `who` are set on a batch row, so the page can draw its cards. */
export interface ReportItem { task_id: string, title: string, detail: string, task_ids?: string[], project?: string, type?: string, who?: string }
/** `task_ids` are the cards behind the bar, for the hover. */
export interface ReportBar { label: string, value: number, task_ids: string[] }
export interface ReportProject {
  /** The project id; '' is "No project", which only the progress tool returns. */
  project: string
  total: number
  done: number
  /** Not done and past the backlog stage (architecture, build, review). */
  in_flight: number
  open: number
  overdue: number
  /** The cards still open, when the project is close to done. */
  closers: ReportItem[]
  /** Every card in the project, for the row hover. */
  task_ids: string[]
}
/** One open card with a due date: late, or due within the next 90 days. */
export interface ReportDue { task_id: string, title: string, due_at: string, late: boolean }

/** What a section draws. */
export type ReportBlock =
  | { kind: 'cards', items: ReportItem[], total: number }
  | { kind: 'bars', rows: ReportBar[], total: number }
  | { kind: 'projects', rows: ReportProject[], total: number }
  | { kind: 'timeline', items: ReportDue[], total: number }

export interface ReportSection {
  tool: string
  title: string
  /** One sentence for the proactive briefing. */
  summary: string
  /** How many things the tool found; 0 means nothing to say. */
  count: number
  /** Every card the finding covers, uncapped. The page's highlight, tiles and "Select on the board" read it. */
  task_ids: string[]
  block: ReportBlock
}

export interface Report { as_of: string, sections: ReportSection[] }

export interface ReportOptions { now?: number, limit?: number }

const LIMIT = 8 // rows per section on screen
const BATCH_MIN = 3 // cards that make a batch
const CLOSE_MAX = 2 // open cards left that count as "close to done"
const BEHIND_MIN = 2 // overdue cards a project needs to count as behind
const DUE_AHEAD_DAYS = 90 // how far ahead the due-date timeline looks
const NO_PROJECT = '(no project)'

/** The stage the card sits in. The page passes the board's own; a bare row falls back to what work_state says. */
const stageOf = (t: GovTask): Stage => t.stage ?? (t.work_state === 'backlog' ? 'backlog' : t.work_state === 'verifying' ? 'review' : t.work_state === 'done' ? 'done' : 'build')
const isDone = (t: GovTask) => t.work_state === 'done' || stageOf(t) === 'done'
const isOpen = (t: GovTask) => !t.archived_at && !isDone(t)
/** Started and not finished: architecture, build or review. */
const inFlight = (t: GovTask) => !isDone(t) && stageOf(t) !== 'backlog'

/** A project with work done and only a couple of open cards left. The report's tool and its progress badges share these two rules. */
export const isCloseToDone = (p: { done: number, open: number }) => p.done > 0 && p.open > 0 && p.open <= CLOSE_MAX
/** A project where at least two open cards, and half or more of them, are past due. */
export const isBehind = (p: { open: number, overdue: number }) => p.overdue >= BEHIND_MIN && p.overdue * 2 >= p.open

/** When a card falls due: the end of a bare day, or the moment of a date-time. NaN for no due date. */
function dueMs(t: GovTask): number {
  if (!t.due_at) return NaN
  return /^\d{4}-\d{2}-\d{2}$/.test(t.due_at) ? Date.parse(`${t.due_at}T23:59:59.999`) : Date.parse(t.due_at)
}
/** A bare day is overdue once that day has ended; a date-time once it has passed. */
const overdue = (t: GovTask, now: number) => dueMs(t) < now

const item = (t: GovTask, detail: string): ReportItem => ({ task_id: t.task_id, title: t.title, detail })
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const day = (iso: string) => iso.slice(0, 10)

interface Ctx { open: GovTask[], all: GovTask[], now: number, limit: number }
type Tool = { title: string, run: (c: Ctx, arg: string) => Omit<ReportSection, 'tool' | 'title'> }

const ids = (cards: GovTask[]) => cards.map(t => t.task_id)

function cardsSection(items: ReportItem[], summary: string, task_ids: string[]): Omit<ReportSection, 'tool' | 'title'> {
  return { summary, count: items.length, task_ids, block: { kind: 'cards', items, total: items.length } }
}

interface ProjectStat extends ReportProject { openCards: GovTask[] }

/** Per project: totals, in-flight and overdue counts, and every card's id. Cards with no project are the "" group, kept only when asked. */
function projectStats(c: Ctx, withNone = false): ProjectStat[] {
  const by = new Map<string, { cards: GovTask[], done: number, flight: number, openCards: GovTask[], overdue: number }>()
  for (const t of c.all) {
    if (t.archived_at || (!t.project_id && !withNone)) continue
    const p = by.get(t.project_id) ?? { cards: [], done: 0, flight: 0, openCards: [], overdue: 0 }
    p.cards.push(t)
    if (isDone(t)) p.done++
    else {
      p.openCards.push(t)
      if (inFlight(t)) p.flight++
      if (overdue(t, c.now)) p.overdue++
    }
    by.set(t.project_id, p)
  }
  return [...by].map(([project, p]) => ({
    project, total: p.cards.length, done: p.done, in_flight: p.flight, open: p.openCards.length, overdue: p.overdue,
    closers: [], task_ids: ids(p.cards), openCards: p.openCards
  }))
}

/** The open cards of the listed projects: what a project finding covers. */
const openIds = (rows: ProjectStat[]) => rows.flatMap(p => ids(p.openCards))

function projectsSection(rows: ProjectStat[], summary: string, c: Ctx): Omit<ReportSection, 'tool' | 'title'> {
  return {
    summary, count: rows.length, task_ids: openIds(rows),
    block: { kind: 'projects', rows: rows.slice(0, c.limit).map(({ openCards, ...p }) => p), total: rows.length }
  }
}

export const REPORT_TOOLS: Record<string, Tool> = {
  // Open cards that belong to no project and have nobody on them.
  orphans: {
    title: 'Orphan cards',
    run(c) {
      const found = c.open.filter(t => !t.project_id && !t.assignee && !t.proposed_assignee)
      const items = found.map(t => item(t, `No project, no assignee. Created ${day(t.created_at)}`))
      const s = cardsSection(items, items.length ? `${plural(items.length, 'orphan card')} with no project and no assignee.` : 'No orphan cards.', ids(found))
      return { ...s, block: { kind: 'cards', items: items.slice(0, c.limit), total: items.length } }
    }
  },
  // Backlog cards of the same project and type, from the same person, that one agent could take in one go.
  batchable: {
    title: 'Cards to batch',
    run(c) {
      const groups = new Map<string, GovTask[]>()
      for (const t of c.open) {
        if (t.work_state !== 'backlog') continue
        const who = t.assignee || t.proposed_assignee
        const key = `${t.project_id || NO_PROJECT}|${t.task_type}|${who}`
        groups.set(key, [...(groups.get(key) ?? []), t])
      }
      const batches = [...groups].filter(([, g]) => g.length >= BATCH_MIN).sort((a, b) => b[1].length - a[1].length)
      const items: ReportItem[] = batches.map(([key, g]) => {
        const [project = '', type = '', who = ''] = key.split('|')
        return {
          task_id: g[0]!.task_id, title: `${plural(g.length, type + ' card')} in ${project}`,
          detail: `${who ? `For ${who}. ` : ''}${g.map(t => t.task_id).slice(0, 6).join(', ')}${g.length > 6 ? ', …' : ''}`,
          task_ids: ids(g), project: project === NO_PROJECT ? '' : project, type, who
        }
      })
      const cards = batches.reduce((n, [, g]) => n + g.length, 0)
      return {
        summary: items.length ? `${plural(cards, 'card')} fall into ${plural(items.length, 'batch', 'batches')} of ${BATCH_MIN} or more that one agent could take together.` : 'No groups of similar cards to batch.',
        count: cards,
        task_ids: batches.flatMap(([, g]) => ids(g)),
        block: { kind: 'cards', items: items.slice(0, c.limit), total: items.length }
      }
    }
  },
  // Projects with work done and only a couple of cards left.
  almost_done: {
    title: 'Projects close to done',
    run(c) {
      const rows = projectStats(c)
        .filter(isCloseToDone)
        .sort((a, b) => b.done / b.total - a.done / a.total)
        .map(p => ({ ...p, closers: p.openCards.map(t => item(t, t.work_state.replace('_', ' '))) }))
      const first = rows[0]
      const summary = first
        ? `${plural(rows.length, 'project')} close to done. ${first.project} needs ${plural(first.open, 'more card')} (${first.closers.map(t => t.task_id).join(', ')}).`
        : 'No project is close to done.'
      return projectsSection(rows, summary, c)
    }
  },
  // Projects where most open cards are past their due date.
  behind: {
    title: 'Projects behind',
    run(c) {
      const rows = projectStats(c)
        .filter(isBehind)
        .sort((a, b) => b.overdue - a.overdue)
      const first = rows[0]
      const summary = first
        ? `${plural(rows.length, 'project')} behind. ${first.project} has ${first.overdue} of ${plural(first.open, 'open card')} overdue.`
        : 'No project is behind.'
      return projectsSection(rows, summary, c)
    }
  },
  // Open cards with a due date, late or due within the next 90 days, oldest due date first. `count` is the late ones only.
  overdue: {
    title: 'Overdue cards',
    run(c) {
      const horizon = c.now + DUE_AHEAD_DAYS * 86_400_000
      const dated = c.open
        .filter(t => dueMs(t) <= horizon)
        .sort((a, b) => dueMs(a) - dueMs(b))
        .map(t => ({ task_id: t.task_id, title: t.title, due_at: t.due_at!, late: overdue(t, c.now) }))
      const late = dated.filter(d => d.late)
      const upcoming = dated.length - late.length
      const summary = late.length
        ? `${plural(late.length, 'open card')} past due${upcoming ? `, ${upcoming} more coming up` : ''}.`
        : upcoming ? `Nothing is overdue. ${upcoming} coming up.` : 'Nothing is overdue.'
      return { summary, count: late.length, task_ids: late.map(d => d.task_id), block: { kind: 'timeline', items: dated.slice(0, c.limit), total: dated.length } }
    }
  },
  // Every project, and the cards with none, by how much is done. A chart rather than a finding, so it never counts as news.
  progress: {
    title: 'Project progress',
    run(c) {
      const rows = projectStats(c, true)
        .sort((a, b) => (a.project ? 0 : 1) - (b.project ? 0 : 1) || b.done / b.total - a.done / a.total || b.total - a.total || a.project.localeCompare(b.project))
        .map(({ openCards, ...p }) => p)
      const total = rows.reduce((n, p) => n + p.total, 0)
      const done = rows.reduce((n, p) => n + p.done, 0)
      return {
        summary: `${done} of ${plural(total, 'card')} done across ${plural(rows.filter(p => p.project).length, 'project')}.`,
        count: 0, task_ids: rows.flatMap(p => p.task_ids), block: { kind: 'projects', rows, total: rows.length }
      }
    }
  },
  // Open cards counted by one field, e.g. breakdown:work_state. A chart rather than a finding, so it never counts as news.
  breakdown: {
    title: 'Open cards by field',
    run(c, arg) {
      const field = BREAKDOWN_FIELDS.includes(arg as BreakdownField) ? arg as BreakdownField : 'work_state'
      const groups = new Map<string, string[]>()
      for (const t of c.open) {
        const v = String(t[field] ?? '') || '(blank)'
        groups.set(v, [...(groups.get(v) ?? []), t.task_id])
      }
      const rows = [...groups].map(([label, task_ids]) => ({ label, value: task_ids.length, task_ids })).sort((a, b) => b.value - a.value)
      return { summary: `Open cards by ${field}.`, count: 0, task_ids: ids(c.open), block: { kind: 'bars', rows: rows.slice(0, c.limit), total: rows.length } }
    }
  }
}

const BREAKDOWN_FIELDS = ['work_state', 'stage', 'priority', 'assignee', 'project_id', 'task_type'] as const
type BreakdownField = typeof BREAKDOWN_FIELDS[number]

/** What the board manager says when the board opens: the findings, in this order. */
export const BRIEFING_TOOLS = ['orphans', 'batchable', 'almost_done', 'behind'] as const

/** What /report draws when the URL names no tools: the findings, then the progress chart. */
export const REPORT_PAGE_TOOLS = [...BRIEFING_TOOLS, 'progress'] as const

/** The tools whose result is a count of cards: the report's tiles, the briefing's chips and the board's ?report= filter. */
export const FINDING_TOOLS = ['orphans', 'batchable', 'almost_done', 'behind', 'overdue'] as const

export const REPORT_TOOL_NAMES = Object.keys(REPORT_TOOLS)

/** "orphans,breakdown:priority" → [{ name, arg }]. Unknown names are returned in `unknown`, so a typo is reported, not dropped. */
export function parseTools(spec: string | string[]): { tools: { name: string, arg: string }[], unknown: string[] } {
  const parts = (Array.isArray(spec) ? spec : spec.split(',')).map(s => s.trim()).filter(Boolean)
  const tools: { name: string, arg: string }[] = []
  const unknown: string[] = []
  for (const part of parts) {
    const [name = '', arg = ''] = part.split(':')
    if (REPORT_TOOLS[name]) tools.push({ name, arg })
    else unknown.push(name)
  }
  return { tools, unknown }
}

/** Runs the named tools over the rows. Anything archived is ignored by every tool. */
export function buildReport(rows: ReportRows, spec: string | string[] = BRIEFING_TOOLS as unknown as string[], options: ReportOptions = {}): Report & { unknown: string[] } {
  const now = options.now ?? Date.now()
  const ctx: Ctx = { open: rows.tasks.filter(isOpen), all: rows.tasks, now, limit: options.limit ?? LIMIT }
  const { tools, unknown } = parseTools(spec)
  const sections = tools.map(({ name, arg }) => {
    const tool = REPORT_TOOLS[name]!
    return { tool: arg ? `${name}:${arg}` : name, title: tool.title, ...tool.run(ctx, arg) }
  })
  return { as_of: new Date(now).toISOString(), sections, unknown }
}

/**
 * The cards behind a finding, for the board's ?report= filter: `orphans`, or `batchable:2` for the third batch.
 * Null when the key names no finding (or a batch that is gone), so an old link filters nothing instead of everything.
 */
export function reportFilter(rows: ReportRows, key: string, options: ReportOptions = {}): { tool: string, label: string, task_ids: string[] } | null {
  const [name = '', index = ''] = key.split(':')
  if (!(FINDING_TOOLS as readonly string[]).includes(name)) return null
  const section = buildReport(rows, name, { ...options, limit: Infinity }).sections[0]
  if (!section) return null
  if (index === '') return { tool: name, label: section.title, task_ids: section.task_ids }
  const batch = section.block.kind === 'cards' && /^\d+$/.test(index) ? section.block.items[Number(index)] : undefined
  return batch?.task_ids ? { tool: name, label: `${section.title} ${Number(index) + 1}`, task_ids: batch.task_ids } : null
}
