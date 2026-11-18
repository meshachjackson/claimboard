// GET /api/registry: the Registry's rows, from fixtures or from gw.gov-registry-read (cached 5 minutes).
// `?fresh=1` (the Refresh button) skips the cache and costs one gateway run.
import type { RegistryData, RegistrySource } from '~~/app/types/registry'

export default defineEventHandler(async (event): Promise<RegistryData & { source: RegistrySource, registration: boolean }> => {
  await requireAllowedUser(event)
  const store = boardStore()
  // registration: this board has its own approval path (the reference install), so the page offers /registry/join.
  return { source: store.registrySource(), registration: !!store.registration, ...await store.readRegistry(getQuery(event).fresh === '1') }
})
