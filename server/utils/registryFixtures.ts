// Registry fixtures mode: mock/registry/*.json in the shape gw.gov-registry-read will return.
// R1 adds the gateway; until then /api/registry always serves these rows.
import type { RegistryData } from '~~/app/types/registry'

import registry from '~~/mock/registry/gov_registry.json'
import access from '~~/mock/registry/gov_access.json'
import reviews from '~~/mock/registry/gov_review.json'
import history from '~~/mock/registry/gov_history.json'
import assets from '~~/mock/registry/gov_assets.json'
import policy from '~~/mock/registry/gov_policy.json'
import deployed from '~~/mock/registry/deployed.json'

export function fixtureRegistry(): RegistryData {
  return {
    generated_at: new Date().toISOString(),
    registry,
    access,
    reviews,
    history,
    assets,
    policy,
    deployed
  } as unknown as RegistryData
}
