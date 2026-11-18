<script setup lang="ts">
const appName = useAppName()
</script>

<template>
  <div class="flex items-center gap-2.5">
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="3" width="5.5" height="18" rx="1.5" style="fill: var(--color-ink)" /><rect x="9.25" y="3" width="5.5" height="12" rx="1.5" style="fill: var(--color-accent)" /><rect x="16.5" y="3" width="5.5" height="7" rx="1.5" style="fill: var(--color-ink)" /></svg>
    <h1 class="m-0 text-lg font-bold tracking-[-0.01em]">{{ appName }}</h1>
  </div>
</template>
