<script setup lang="ts">
const agentTabs = useAgentTabs()
// Registry phone header: the Agents title with its Live | Roster tabs, Live, account, then the views and queues as a chip row.
// The desktop header is RegistryBar.
const registry = useRegistryStore()
const route = useRoute()
const isOn = (to: string) => route.path === to

const views = computed(() => [
  { to: '/registry', label: 'Fleet' },
  { to: '/registry/map', label: 'Map' },
  { to: '/registry/attention', label: `Problems · ${registry.counts.attention}` },
  { to: '/registry/approvals', label: `Approvals · ${registry.counts.awaiting}` },
  { to: '/registry/activity', label: 'Activity' }
])
</script>

<template>
  <header class="sticky top-0 z-30 flex flex-col border-b-2 border-rule bg-(--ab-bar) pb-2.5">
    <div class="flex h-14 items-stretch gap-4 pr-3 pl-4">
      <PageTitle class="self-center" />
      <PageTabs :tabs="agentTabs" />
      <div class="ml-auto flex items-center gap-2.5">
        <LiveStatus phone :source="registry.source" :read-only="registry.readOnly" :updated-at="registry.updatedAt" :refreshing="registry.refreshing" />
        <AccountMenu />
      </div>
    </div>
    <nav aria-label="Registry views" class="ab-row flex gap-1.5 overflow-x-auto px-4">
      <NuxtLink
        v-for="v in views"
        :key="v.to"
        :to="v.to"
        :aria-current="isOn(v.to) ? 'page' : undefined"
        class="inline-flex h-11 flex-none items-center rounded border-2 px-3.5 text-[15px] font-semibold"
        :class="isOn(v.to) ? 'border-ink bg-ink text-surface' : 'border-line bg-surface text-ink'"
      >
        {{ v.label }}
      </NuxtLink>
    </nav>
  </header>
</template>
