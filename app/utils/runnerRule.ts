// "Create and start" picks an agent for a card nobody was named for. Pure, so a test can run it on plain rows.
// Order: the project's runner, then an agent that holds the card's class tag, then NUXT_PUBLIC_DEFAULT_RUNNER, else '' (the pool).
// "Project runner" has no setting of its own: it is the assignee of the project's most recent card that reached Build.
import type { ColumnRole, GovTask, RegistryAgent } from '~/types/board'
import { classMismatch, cardClasses, heldClasses } from '~/utils/agentLane'
import { roleAssignee } from '~/utils/boardOps'

const REACHED_BUILD = ['build', 'review', 'done']

export interface RunnerInput {
  tasks: GovTask[]
  registry: RegistryAgent[]
  /** The builder role of the Build column; an agent counts only when assigneeFor would hand it a step. */
  role: ColumnRole
  project: string
  tags: string[]
  fallback: string
  /** The card's stage. Gateway rows can carry a blank stage, so the caller derives it (the store's stageOf). */
  stageOf: (t: GovTask) => string
}

export function pickRunner({ tasks, registry, role, project, tags, fallback, stageOf }: RunnerInput): string {
  const usable = (id: string) => {
    const a = registry.find(x => x.agent_id === id)
    return !!a && a.switch !== 'off' && roleAssignee(id, role, registry) === id
  }
  if (project) {
    const past = tasks
      .filter(t => t.project_id === project && REACHED_BUILD.includes(stageOf(t)) && usable(t.assignee))
      .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))
    if (past[0]) return past[0].assignee
  }
  if (cardClasses(tags).length) {
    const byClass = registry
      .filter(a => heldClasses(a).length && usable(a.agent_id) && classMismatch(tags, a) === '')
      .map(a => a.agent_id)
      .sort()
    if (byClass[0]) return byClass[0]
  }
  return fallback && usable(fallback) ? fallback : ''
}
