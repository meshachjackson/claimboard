<script setup lang="ts">
// Phone Fleet: search and filter rows, the board's swipeable tab strip across lifecycle, one list, a floating
// New agent button, and the filter sheet. Lifecycle moves go through "Move to…" in the agent sheet.
import type { AgentView } from '~/stores/registry'
import type { Lifecycle } from '~/types/registry'
import { LIFECYCLE_PILLS } from '~/types/registry'

const props = defineProps<{ views: AgentView[], ghosts: { name: string, detail: string }[] }>()
const emit = defineEmits<{ open: [agentId: string] }>()

const TABS: { id: Lifecycle, name: string }[] = [
  { id: 'active', name: 'Active' },
  { id: 'in_development', name: 'In development' },
  { id: 'proposed', name: 'Proposed' },
  { id: 'paused', name: 'Paused' }
]
const tab = ref<Lifecycle>('active')
const list = computed(() => props.views.filter(v => v.row.lifecycle_status === tab.value))
const count = (id: Lifecycle) => props.views.filter(v => v.row.lifecycle_status === id).length

const { query, set } = useRegistryFilters()
const facets = useRegistryFacets()
const filtersOpen = ref(false)
</script>

<template>
  <div class="flex flex-1 flex-col">
    <div class="border-b border-line bg-(--ab-bar)">
      <PhoneFilterRow
        search-label="Search agents"
        :q="query.q"
        :pills="facets.pills.value"
        :tokens="facets.tokens.value"
        :facet-count="facets.facetCount.value"
        @search="set({ q: $event })"
        @pill="facets.toggle('show', $event)"
        @remove-token="facets.removeToken"
        @open="filtersOpen = true"
      />
    </div>
    <div role="tablist" aria-label="Lifecycle" class="ab-row flex gap-1 overflow-x-auto border-b border-line bg-surface px-4">
      <button
        v-for="t in TABS"
        :key="t.id"
        type="button"
        role="tab"
        :aria-selected="tab === t.id"
        class="-mb-px inline-flex h-12 flex-none cursor-pointer items-center gap-2 border-b-2 px-2.5 text-[15px]"
        :class="tab === t.id ? 'border-ink font-bold text-ink' : 'border-transparent font-medium text-text3'"
        @click="tab = t.id"
      >
        <span class="size-2 rounded-full" :style="{ background: LIFECYCLE_PILLS[t.id].dot }" />
        {{ t.name }}
        <span class="rounded-full bg-(--ab-neutral-strong) px-2 py-px font-mono text-xs text-text2">{{ count(t.id) }}</span>
      </button>
    </div>
    <main class="flex flex-col gap-2.5 px-4 pt-3 pb-28">
      <template v-if="tab === 'proposed'">
        <RegistryGhostCard v-for="g in ghosts" :key="g.name" :name="g.name" :detail="g.detail" />
      </template>
      <RegistryAgentCard v-for="v in list" :key="v.row.agent_id" :view="v" phone @open="emit('open', $event)" />
      <p v-if="!list.length" class="m-0 py-6 text-center text-sm text-text3">No matches</p>
    </main>
    <NuxtLink
      to="/registry/new"
      class="fixed right-4 bottom-[calc(16px+env(safe-area-inset-bottom))] z-10 inline-flex h-14 items-center gap-2 rounded-full bg-ink px-5 text-[15px] font-semibold text-surface shadow-[0_8px_24px_rgba(16,24,40,0.25)]"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
      New agent
    </NuxtLink>
    <FilterSheet
      v-model:open="filtersOpen"
      :columns="facets.columns.value"
      :show-label="`Show ${views.length} ${views.length === 1 ? 'agent' : 'agents'}`"
      @toggle="facets.toggle"
      @clear-all="facets.clearAll"
    />
  </div>
</template>
