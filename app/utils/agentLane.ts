// Agent lanes and the class rule (sections 5 and 7). Pure functions. The real check runs in n8n
// (the task-write workflow); this only shows the owner the refusal before he drags.
import type { Lane, RegistryAgent } from '~/types/board'
import { API_DEPLOY_REF, CLASS_TAG_PREFIX, GENERAL_CLASS, HARNESS_RUNTIME, LANE_LABELS, classMismatchLabel } from '~/types/board'

/** API when deploy_ref is gw.api-run, Harness when runtime is local_harness, else null (an ordinary agent). */
export function laneOf(agent: Pick<RegistryAgent, 'deploy_ref' | 'runtime'> | undefined): Lane | null {
  if (!agent) return null
  if (agent.deploy_ref === API_DEPLOY_REF) return 'api'
  if (agent.runtime === HARNESS_RUNTIME) return 'harness'
  return null
}

/** The class slugs on a card: ['class-general', 'urgent'] gives ['general']. */
export function cardClasses(tags: string[]): string[] {
  return tags.filter(t => t.startsWith(CLASS_TAG_PREFIX)).map(t => t.slice(CLASS_TAG_PREFIX.length))
}

/** The classes an agent may be handed. An API agent holds general even before its access row is read back. */
export function heldClasses(agent: Pick<RegistryAgent, 'deploy_ref' | 'classes'>): string[] {
  const held = agent.classes ?? []
  return held.length || agent.deploy_ref !== API_DEPLOY_REF ? held : [GENERAL_CLASS]
}

/**
 * Why a card will not run for this agent, or '' when it will. An agent with no class rows is not scoped and sees
 * any card. A scoped agent gets a general card, and any card whose other classes it holds. An untagged card is
 * refused: a person has to tag it (the API lane only takes class-general).
 */
export function classMismatch(tags: string[], agent: RegistryAgent | undefined): string {
  if (!agent) return ''
  const held = heldClasses(agent)
  if (!held.length) return ''
  const needed = cardClasses(tags)
  const missing = needed.filter(c => c !== GENERAL_CLASS && !held.includes(c))
  if (needed.length && !missing.length) return ''
  return classMismatchLabel(missing, held)
}

/** "Name · API · general" for the assignee pickers; an ordinary agent keeps its plain name. A switched-off agent says so. */
export function pickerLabel(name: string, agent: RegistryAgent | undefined): string {
  const lane = laneOf(agent)
  const off = agent?.switch === 'off' ? 'switched off' : ''
  if (!lane || !agent) return [name, off].filter(Boolean).join(' · ')
  return [name, LANE_LABELS[lane], heldClasses(agent).join(', '), off].filter(Boolean).join(' · ')
}
