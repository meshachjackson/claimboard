<script setup lang="ts">
// Two or three tabs under a page title, as links, so each tab has its own URL (Agents: Live, Roster; Shipped: Log, Report).
// A tab stays current on its own sub-pages, so Roster stays lit on /registry/approvals.
defineProps<{ tabs: { to: string, label: string }[] }>()
const route = useRoute()
const isOn = (to: string) => route.path === to || route.path.startsWith(`${to}/`)
</script>

<template>
  <nav aria-label="Page sections" class="flex gap-5 self-stretch">
    <NuxtLink
      v-for="t in tabs"
      :key="t.to"
      :to="t.to"
      :aria-current="isOn(t.to) ? 'page' : undefined"
      class="inline-flex min-w-11 items-center justify-center text-[15px] no-underline"
      :class="isOn(t.to) ? 'font-semibold text-ink shadow-[inset_0_-4px_0_var(--color-ink)]' : 'font-medium text-text3 hover:text-ink'"
    >{{ t.label }}</NuxtLink>
  </nav>
</template>
