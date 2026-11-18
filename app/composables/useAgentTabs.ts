// The Agents section tabs, and whether the orchestrator feature is on (NUXT_PUBLIC_FEATURE_ORCHESTRATOR, shared/features.ts).
// With the feature off, the orchestrator history tab is left out and /orchestrator sends you to /agents.
import { orchestratorName } from '~/types/board'
import { featureOn } from '~~/shared/features'

export function useOrchestratorFeature(): boolean {
  return featureOn(useRuntimeConfig().public.featureOrchestrator)
}

export function useAgentTabs(): { to: string, label: string }[] {
  const tabs = [{ to: '/agents', label: 'Live' }, { to: '/registry', label: 'Roster' }]
  if (useOrchestratorFeature()) tabs.push({ to: '/orchestrator', label: orchestratorName() })
  return tabs
}
