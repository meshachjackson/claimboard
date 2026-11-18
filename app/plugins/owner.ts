// Applies the instance values (owner, orchestrator, agent targets, avatars, project colors) for the browser from runtime config
// before any component reads them.
import { applyInstanceConfig } from '~/utils/instanceConfig'

export default defineNuxtPlugin(() => {
  applyInstanceConfig(useRuntimeConfig().public)
})
