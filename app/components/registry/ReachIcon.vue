<script setup lang="ts">
// Reachability: called, pulls, sleeps. Cards get a tooltip; the detail page shows the label too.
import { REACH_LABELS } from '~/types/registry'

const props = defineProps<{ reach: string, label?: boolean }>()
const text = computed(() => REACH_LABELS[props.reach] ?? 'Reachability unknown')
</script>

<template>
  <span class="inline-flex items-center gap-1 text-xs text-text3" :title="label ? undefined : text">
    <svg v-if="reach === 'addressable'" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
    <svg v-else-if="reach === 'outbound_only'" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6" /></svg>
    <svg v-else-if="reach === 'unreachable_when_asleep'" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></svg>
    <svg v-else width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="2 3" aria-hidden="true"><circle cx="12" cy="12" r="8" /></svg>
    <span :class="label ? '' : 'sr-only'">{{ text }}</span>
  </span>
</template>
