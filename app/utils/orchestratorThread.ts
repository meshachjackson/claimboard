// The standing orchestrator thread. One reserved card per person per month holds
// the conversation: gov_task_notes are the entries, the card carries the inbox tag. No schema change. The notes have no
// `surface` column, so the surface rides as a fixed prefix on the body ("[telegram] ...") and is parsed back here.
// Pure helpers only: nothing here reads or writes the board.

// The two card tags. Defaults below; a deployment with older cards sets NUXT_PUBLIC_ORCHESTRATOR_INBOX_TAG and
// NUXT_PUBLIC_ORCHESTRATOR_BOARD_TAG to the tags those cards already carry (applyInstanceConfig).
let inboxTag = 'orchestrator-inbox'
let boardTag = 'orchestrator-board'
export function setThreadTags(inbox: string, board: string): void {
  if (inbox) inboxTag = inbox
  if (board) boardTag = board
}
/** The tag on the standing inbox card that Telegram, Slack and voice write to. */
export const inboxThreadTag = (): string => inboxTag
/** Board conversations with the orchestrator live on their own cards, one per thread, tagged with this. The inbox card is not one. */
export const boardThreadTag = (): string => boardTag
export const SURFACES = ['board', 'telegram', 'slack', 'voice'] as const
export type Surface = typeof SURFACES[number]

/** The message envelope the board hands the secretary. Only `surface`, `sender` and `text` are required. */
export interface Envelope {
  surface: Surface
  sender: string // person:<name>, never the connector's identity
  text: string
  card?: string // task_id the person was looking at (board only)
  step?: string
  view?: string
}

/** The notes body cap (schema rule 7, raised to 2,000 characters). */
export const BODY_LIMIT = 2000

const PREFIX = /^\[(board|telegram|slack|voice)\] /

/** True for an orchestrator inbox card, from its tags. */
export function isInboxCard(tags: string | undefined): boolean {
  return (tags ?? '').split(',').map(x => x.trim()).includes(inboxTag)
}

/** True for a board thread card, from its tags. The Telegram inbox card is not one. */
export function isBoardThread(tags: string | undefined): boolean {
  return (tags ?? '').split(',').map(x => x.trim()).includes(boardTag)
}

/** True when a message is only a reset command (/new or /clear, any case). It starts a new thread and is not sent to the orchestrator. */
export function isResetCommand(text: string): boolean {
  return /^\/(new|clear)$/i.test(text.trim())
}

/** "Board chat 11/7/2026 9:05 AM": the title of a new thread card. */
export function threadTitle(date: Date): string {
  const h = date.getHours()
  const time = `${h % 12 || 12}:${String(date.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
  return `Board chat ${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()} ${time}`
}

/** "<name> inbox 2026-11" for a date. One card per person per month keeps the append-only notes bounded. */
export function inboxTitle(date: Date, name = 'Orchestrator'): string {
  return `${name} inbox ${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/** The note body for a message: the surface prefix, then the words. Throws when it would pass the cap. */
export function withSurface(surface: Surface, text: string): string {
  const body = `[${surface}] ${text.trim()}`
  if (body.length > BODY_LIMIT) throw new Error(`message is ${body.length} characters; the cap is ${BODY_LIMIT}`)
  return body
}

/** Splits a note body into its surface and words. A body with no prefix (the orchestrator's answers, older notes) has no surface. */
export function parseSurface(body: string): { surface: Surface | '', text: string } {
  const m = PREFIX.exec(body)
  return m ? { surface: m[1] as Surface, text: body.slice(m[0].length) } : { surface: '', text: body }
}

/** Checks an envelope before it is sent. Returns the problem, or '' when it is fine. */
export function envelopeProblem(e: Envelope): string {
  if (!SURFACES.includes(e.surface)) return `unknown surface ${e.surface}`
  if (!/^person:[a-z0-9_-]+$/.test(e.sender)) return 'sender must be person:<name>'
  if (!e.text.trim()) return 'message is empty'
  // Page context only exists on the board. A surface that cannot see a card must not claim one.
  if (e.surface !== 'board' && (e.card || e.step || e.view)) return `${e.surface} has no page context`
  return ''
}

// ---------- Full history (the orchestrator screen) ----------

/** One entry on the orchestrator screen: a note from any orchestrator-inbox card, with its surface split off. */
export interface HistoryEntry {
  id: string
  mine: boolean // a person wrote it (the rest are the orchestrator's answers and board status notes)
  system: boolean
  surface: Surface | ''
  text: string
  at: string // ISO time
}

/** A piece of message text: plain words, or a card id that links to its card. */
export type TextPart = { text: string } | { card: string }

const CARD_ID = /\bTSK-\d{6}\b/g

/** Splits text so each TSK-nnnnnn can be rendered as a link. Joining the parts gives the original text back. */
export function linkCardIds(text: string): TextPart[] {
  const parts: TextPart[] = []
  let last = 0
  for (const m of text.matchAll(CARD_ID)) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index) })
    parts.push({ card: m[0] })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last) })
  return parts
}

/** The local calendar day of a time, as 2026-11-02. Entries group and filter by the day the person lived. */
export function dayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Keeps the entries that match the search words (every word, any case, in the text, a card id or the surface name) and fall between the
 * two days, both included. A blank search or day filters nothing.
 */
export function filterHistory(entries: HistoryEntry[], search: string, from: string, to: string): HistoryEntry[] {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean)
  return entries.filter((e) => {
    const day = dayKey(e.at)
    if (from && day < from) return false
    if (to && day > to) return false
    const hay = `${e.surface} ${e.text}`.toLowerCase() // the surface counts, so "telegram" finds what came in there
    return words.every(w => hay.includes(w))
  })
}

/** Groups entries (already oldest first) by local day, keeping their order. */
export function groupByDay(entries: HistoryEntry[]): { day: string, entries: HistoryEntry[] }[] {
  const groups: { day: string, entries: HistoryEntry[] }[] = []
  for (const e of entries) {
    const day = dayKey(e.at)
    const last = groups[groups.length - 1]
    if (last?.day === day) last.entries.push(e)
    else groups.push({ day, entries: [e] })
  }
  return groups
}

// ---------- Threads (board conversations) ----------

/** One board thread for the orchestrator screen: its card, its messages oldest first. */
export interface HistoryThread {
  id: string // the card's task_id
  title: string
  at: string // when the thread started
  entries: HistoryEntry[]
}

/** Threads newest first, each with the entries that pass the search and day filters. A thread with none left is dropped when filtering. */
export function historyThreads(
  cards: { task_id: string, title: string, created_at: string }[],
  entriesByCard: Record<string, HistoryEntry[]>,
  search: string, from: string, to: string
): HistoryThread[] {
  const filtering = !!(search.trim() || from || to)
  return [...cards]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map(c => ({ id: c.task_id, title: c.title, at: c.created_at, entries: filterHistory(entriesByCard[c.task_id] ?? [], search, from, to) }))
    .filter(t => !filtering || t.entries.length)
}

/** The thread the panel is on: the newest live board thread card. Telegram's inbox card never qualifies. */
export function newestBoardThread<T extends { tags?: string, created_at: string, archived_at?: string | null }>(tasks: T[]): T | null {
  return tasks.filter(t => isBoardThread(t.tags) && !t.archived_at).sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null
}
