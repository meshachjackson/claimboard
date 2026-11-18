<script setup lang="ts">
// Fleet: one column per lifecycle_status, optional swimlanes by host or domain, ghost cards at the top of Proposed.
import type { AgentView } from '~/stores/registry'
import type { Lifecycle } from '~/types/registry'
import { DOMAIN_LABELS, FLEET_COLUMNS, HOST_LABELS, LIFECYCLE_PILLS } from '~/types/registry'

const props = defineProps<{ views: AgentView[], lanes: 'none' | 'host' | 'domain', showRetired: boolean, ghosts: { name: string, detail: string }[] }>()
const emit = defineEmits<{ open: [agentId: string], drop: [agentId: string, to: Lifecycle] }>()

const columns = computed(() => FLEET_COLUMNS.filter(c => c.id !== 'retired' || props.showRetired))

const laneIds = computed<(string | null)[]>(() => {
  if (props.lanes === 'none') return [null]
  const order = props.lanes === 'host' ? ['laptop', 'hosted', 'catalyst_cloud', ''] : ['personal', 'catalyst', 'infrastructure', 'cross_domain', '']
  return order.filter(k => props.views.some(v => v.row[props.lanes] === k))
})
const laneLabel = (k: string) => (props.lanes === 'host' ? HOST_LABELS[k] ?? 'Host unknown' : DOMAIN_LABELS[k] ?? 'Domain unknown')

function cell(col: Lifecycle, lane: string | null) {
  return props.views.filter(v => v.row.lifecycle_status === col && (lane === null || v.row[props.lanes] === lane))
}
const countFor = (col: Lifecycle) => props.views.filter(v => v.row.lifecycle_status === col).length
</script>

<template>
  <div class="flex flex-col gap-4 overflow-x-auto pb-1">
    <!-- Column headers -->
    <div class="flex min-w-max gap-4">
      <div v-for="col in columns" :key="col.id" class="flex w-[272px] flex-none flex-col gap-0.5 px-1">
        <!-- Column heads read like the board's: the name in the display face, the count beside it. -->
        <div class="flex items-center gap-2">
          <span class="size-2.5 rounded-full" :style="{ background: LIFECYCLE_PILLS[col.id].dot }" />
          <h2 class="m-0 font-display text-[24px] leading-none font-bold text-ink">{{ col.name }}</h2>
          <span class="font-display text-[20px] leading-none font-semibold text-text3">{{ countFor(col.id) }}</span>
        </div>
        <span class="text-sm text-text3">{{ col.hint }}</span>
      </div>
    </div>

    <section
      v-for="(lane, li) in laneIds"
      :key="lane ?? 'all'"
      :aria-label="lane === null ? 'Fleet' : laneLabel(lane)"
      class="flex min-w-max flex-col gap-2"
    >
      <h3 v-if="lane !== null" class="m-0 flex items-baseline gap-2 px-1 font-display text-lg font-bold text-text2">
        {{ laneLabel(lane) }}<span class="font-semibold text-text3">{{ views.filter(v => v.row[lanes] === lane).length }}</span>
      </h3>
      <div class="flex items-start gap-4">
        <div
          v-for="col in columns"
          :key="col.id"
          role="region"
          :aria-label="lane === null ? col.name : `${col.name}, ${laneLabel(lane)}`"
          class="flex w-[272px] flex-none flex-col gap-3 rounded-sm bg-lane p-2 pt-3"
        >
          <template v-if="col.id === 'proposed' && li === 0">
            <RegistryGhostCard v-for="g in ghosts" :key="g.name" :name="g.name" :detail="g.detail" />
          </template>
          <div class="relative">
            <RegistryFleetDrop :views="cell(col.id, lane)" @drop="emit('drop', $event, col.id)" @open="emit('open', $event)" />
            <p v-if="cell(col.id, lane).length === 0" class="pointer-events-none absolute inset-x-0 top-0 m-0 px-2 py-4 text-center text-sm text-text3">
              {{ col.id === 'paused' ? 'Nothing paused' : col.id === 'retired' ? 'Nothing retired' : 'No matches' }}
            </p>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
