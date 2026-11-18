<script setup lang="ts">
const agentTabs = useAgentTabs()
// Registry's desktop header: the board's bar with Registry's pills, Approvals and Activity before the Filters
// toggle, Live, New agent, the account menu, then the filter panel and the Fleet | Table | Map row.
import { REGISTER_API_AGENT_HINT, REGISTER_API_AGENT_LABEL } from '~/types/board'

const registry = useRegistryStore()
const route = useRoute()
const toast = useToast()
const { query, set } = useRegistryFilters()
const facets = useRegistryFacets()
const { gate, composer } = useRegistryUi()
const { filtersExpanded, setFiltersExpanded } = useSettings()

const bar = ref<{ focusSearch: () => void, focusToggle: () => void }>()
const isOn = (to: string) => route.path === to

function close() {
  setFiltersExpanded(false)
  nextTick(() => bar.value?.focusToggle())
}

function reset() {
  if (!confirm('Reset Registry fixtures? This drops every local request and decision.')) return
  registry.reset()
  toast.add({ title: 'Registry fixtures reloaded', color: 'neutral' })
}

// Fleet, Table and Map are views of the roster; Problems, Approvals and Activity are queues. One row of tabs, same labels as the phone.
const tabs = computed(() => [
  { to: '/registry', label: 'Fleet' },
  { to: '/registry/table', label: 'Table' },
  { to: '/registry/map', label: 'Map' },
  { to: '/registry/attention', label: `Problems · ${registry.counts.attention}` },
  { to: '/registry/approvals', label: `Approvals · ${registry.counts.awaiting}` },
  { to: '/registry/activity', label: 'Activity' }
])
const showTabs = computed(() => tabs.value.some(t => isOn(t.to)))

useBoardKeys({
  filters: () => setFiltersExpanded(!filtersExpanded.value),
  search: () => bar.value?.focusSearch()
}, () => !!route.query.agent || !!gate.value || !!composer.value)
</script>

<template>
  <!-- `contents` so the bar sticks against the page, not this wrapper. The filter panel and view row scroll away. -->
  <div class="contents">
    <TopBar
      ref="bar"
      class="sticky top-0 z-30"
      title="Agents"
      search-label="Search agents"
      :q="query.q"
      :pills="facets.pills.value"
      :tokens="facets.tokens.value"
      :count-label="facets.countLabel.value"
      :facet-count="facets.facetCount.value"
      :has-active="facets.hasActive.value"
      :expanded="filtersExpanded"
      @search="set({ q: $event })"
      @pill="facets.toggle('show', $event)"
      @remove-token="facets.removeToken"
      @toggle="setFiltersExpanded(!filtersExpanded)"
      @clear-all="facets.clearAll"
    >
      <template #tabs>
        <PageTabs :tabs="agentTabs" />
      </template>
      <template #actions>
        <LiveStatus
          resettable
          :source="registry.source"
          :read-only="registry.readOnly"
          :updated-at="registry.updatedAt"
          :refreshing="registry.refreshing"
          @refresh="registry.refresh(true)"
          @reset="reset"
        />
        <NuxtLink
          v-if="!registry.registration"
          :to="{ path: '/registry/new', query: { lane: 'api' } }"
          :title="REGISTER_API_AGENT_HINT"
          class="ab-narrow-hide inline-flex h-8 items-center rounded-lg border border-input bg-surface px-2.5 text-[13px] font-semibold text-ink"
        >{{ REGISTER_API_AGENT_LABEL }}</NuxtLink>
        <NuxtLink
          :to="registry.registration ? '/registry/join' : '/registry/new'"
          aria-label="New agent"
          title="New agent"
          class="inline-flex h-8 items-center gap-1.5 rounded-lg bg-ink px-2.5 text-[13px] font-semibold text-surface"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          <span class="ab-narrow-hide pr-0.5">New</span>
        </NuxtLink>
      </template>
    </TopBar>
    <RegistryFilterPanel
      v-if="filtersExpanded"
      :columns="facets.columns.value"
      @toggle="facets.toggle"
      @clear="facets.clear"
      @close="close"
    >
      <template v-if="isOn('/registry')" #display>
        <RegistryDisplay />
      </template>
    </RegistryFilterPanel>
    <div v-if="showTabs" class="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 pt-3">
      <!-- Links to six pages, so a nav with aria-current, not a tablist. -->
      <nav aria-label="Registry views" class="ab-seg">
        <NuxtLink v-for="t in tabs" :key="t.to" :to="{ path: t.to, query: route.query }" :aria-current="isOn(t.to) ? 'page' : undefined">{{ t.label }}</NuxtLink>
      </nav>
      <p v-if="isOn('/registry')" class="m-0 text-sm text-text3">Drag a card to another column to request a lifecycle change. Nothing moves until you approve it.</p>
    </div>
  </div>
</template>
