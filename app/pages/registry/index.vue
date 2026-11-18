<script setup lang="ts">
// Registry · Fleet (default view): a board of agents whose columns are lifecycle_status.
import type { Lifecycle } from '~/types/registry'

useHead({ title: 'Agents' })
const registry = useRegistryStore()
const { query, matches, showGhosts } = useRegistryFilters()
const { gate, openAgent } = useRegistryUi()

const inService = computed(() => registry.views.filter(v => v.row.lifecycle_status !== 'template'))
const shown = computed(() => inService.value.filter(v => matches(v)))
const templates = computed(() => registry.views.filter(v => v.row.lifecycle_status === 'template'))

// One ghost card per finding with a name; the rest are counted in its detail line.
const ghosts = computed(() => {
  const found = registry.deployed?.unregistered ?? []
  const named = found.filter(u => !u.synthetic)
  if (!showGhosts.value || !named.length) return []
  return named.map(u => ({ name: u.name, detail: `Workflow on the hosted instance outside any registered agent · found by ${u.review_id} with ${found.length - 1} others` }))
})

function onDrop(agentId: string, to: Lifecycle) {
  if (registry.lifecycleOf(agentId) === to) return
  gate.value = { agentId, to }
}
</script>

<template>
  <RegistryShell v-slot="{ phone }">
    <RegistryPhoneFleet v-if="phone" :views="shown" :ghosts="ghosts" @open="openAgent" />
    <template v-else>
      <main class="flex flex-1 flex-col gap-5 px-5 pt-3 pb-10">
        <RegistryFleetColumns
          :views="shown"
          :lanes="query.lanes"
          :show-retired="query.retired"
          :ghosts="ghosts"
          @open="openAgent"
          @drop="onDrop"
        />
        <RegistryTemplatesShelf :views="templates" @open="openAgent" />
        <p class="m-0 text-xs text-text3">{{ registry.source === 'gateway' ? 'Live rows from gw.gov-registry-read. Drift snapshot as of the latest loader run.' : registry.source === 'file' ? 'Read-only copy of the live tables, as of the last scripts/registry-pull.mjs run. Pull again for newer rows.' : 'Prototype on fixtures: live registry rows from 10/25/2026 plus the 10/12/2026 export. Synthetic values are listed in mock/registry/README.md.' }}</p>
      </main>
    </template>
  </RegistryShell>
</template>
