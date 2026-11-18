<script setup lang="ts">
// Agents / Roster / <agent name> on an agent's own page. Every part links except the last, which is the page you are on.
const props = defineProps<{ agentId: string }>()
const registry = useRegistryStore()
const crumbs = computed(() => [
  { to: '/agents', label: 'Agents' },
  { to: '/registry', label: 'Roster' },
  { label: registry.views.find(v => v.row.agent_id === props.agentId)?.row.name || props.agentId }
])
</script>

<template>
  <nav aria-label="Breadcrumb" class="px-4 pt-3 pb-1 text-sm text-text3 sm:px-0">
    <ol class="m-0 flex list-none flex-wrap items-center gap-x-2 p-0">
      <li v-for="(c, i) in crumbs" :key="c.label" class="flex items-center gap-x-2">
        <span v-if="i" aria-hidden="true">/</span>
        <NuxtLink v-if="c.to" :to="c.to" class="rg-link">{{ c.label }}</NuxtLink>
        <span v-else aria-current="page" class="font-semibold text-ink">{{ c.label }}</span>
      </li>
    </ol>
  </nav>
</template>
