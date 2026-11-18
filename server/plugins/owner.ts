// Applies the instance values for server code (routes and agent ops) from runtime config at startup.
import { applyInstanceConfig } from '~~/app/utils/instanceConfig'

export default defineNitroPlugin(() => {
  applyInstanceConfig(useRuntimeConfig().public)
})
