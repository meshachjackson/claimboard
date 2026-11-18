// How the board report paints one card: a square's fill by Project, State or Priority, and the legend that explains it.
// Pure, so the map, the lists and the tests agree. Colors are CSS values from app/types/board.ts (they follow the theme).
import type { Stage, WorkState } from '~/types/board'
import { PRIORITY_FACET_DOTS, PRIORITY_FACET_ORDER, PRIORITY_LABELS, projectColor, STATE_FILTER_DOTS, STATE_FILTER_ORDER, WORK_STATE_PILLS } from '~/types/board'
import { normalizePriority } from '~/utils/priority'

export type ColorBy = 'project' | 'state' | 'priority'
export const COLOR_BY: { id: ColorBy, label: string }[] = [{ id: 'project', label: 'Project' }, { id: 'state', label: 'State' }, { id: 'priority', label: 'Priority' }]

/** What the report needs to know about a card. Titles are untrusted: always bind them as text. */
export interface ReportCard {
  id: string
  title: string
  project: string
  stage: Stage
  state: WorkState
  /** Who is on it, as a display name ('Unassigned' when nobody). */
  who: string
  priority: string
  created: string
}

/** One legend value. `hollow` draws a ring in `color` instead of a fill (Backlog, Low priority). */
export interface Swatch { key: string, label: string, color: string, hollow: boolean }

const NONE_KEY = '_none'
const RING = 'var(--ab-neutral-dot)'

/** Legend order for a mode. For Project: the board's projects in the order given, then No project. */
export function legendFor(mode: ColorBy, projects: readonly string[]): Swatch[] {
  if (mode === 'state') {
    return STATE_FILTER_ORDER.map(s => ({
      key: s, label: s === 'backlog' ? 'Backlog' : WORK_STATE_PILLS[s].label,
      color: STATE_FILTER_DOTS[s] || RING, hollow: s === 'backlog'
    }))
  }
  if (mode === 'priority') {
    return PRIORITY_FACET_ORDER.map(p => ({ key: p, label: PRIORITY_LABELS[p] ?? p, color: PRIORITY_FACET_DOTS[p] || RING, hollow: !PRIORITY_FACET_DOTS[p] }))
  }
  return [...projects.map(p => ({ key: p, label: p, color: projectColor(p, projects), hollow: false })), { key: NONE_KEY, label: 'No project', color: projectColor(''), hollow: false }]
}

/** The legend value a card falls under. */
export function keyOf(card: ReportCard, mode: ColorBy): string {
  if (mode === 'state') return card.state
  if (mode === 'priority') return normalizePriority(card.priority)
  return card.project || NONE_KEY
}

export function swatchOf(card: ReportCard, mode: ColorBy, legend: readonly Swatch[]): Swatch {
  const key = keyOf(card, mode)
  return legend.find(s => s.key === key) ?? legend[legend.length - 1]!
}

/** The card's own project color, for lists that always color by project. */
export const projectSwatch = (card: ReportCard, projects: readonly string[]) => projectColor(card.project, projects)

/** The board's project ids, sorted: the order a project takes its color slot in when PROJECT_COLORS lacks it. */
export const projectsOf = (cards: readonly { project: string }[]): string[] => [...new Set(cards.map(c => c.project).filter(Boolean))].sort()
