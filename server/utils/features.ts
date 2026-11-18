// The orchestrator feature flag on the server (shared/features.ts has the rules). Off unless NUXT_PUBLIC_FEATURE_ORCHESTRATOR is set.
import { featureOn } from '~~/shared/features'

/** True when this board runs the orchestrator and Claude connector features. */
export function orchestratorOn(): boolean {
  return featureOn(useRuntimeConfig().public.featureOrchestrator)
}
