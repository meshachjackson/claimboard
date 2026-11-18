<script setup lang="ts">
// Something the drift loader found that the registry doesn't have: dashed and muted, with Register.
defineProps<{ name: string, detail: string }>()
</script>

<template>
  <article class="relative flex flex-col gap-2 rounded border border-dashed border-dash bg-filterbar p-3">
    <span class="self-start rounded-sm border border-dashed border-dash bg-surface px-2 py-0.5 text-xs font-semibold text-text2">Found in n8n · not registered</span>
    <div class="font-mono text-[13px] font-medium text-text2">{{ name }}</div>
    <div class="text-xs leading-[1.45] text-text3">{{ detail }}</div>
    <div class="flex items-center gap-2">
      <NuxtLink :to="{ path: '/registry/new', query: { from: name } }" class="rg-btn rg-btn-line">Register</NuxtLink>
      <NuxtLink to="/registry/attention" class="rg-link inline-flex min-h-6 items-center text-sm">Attribute to an agent</NuxtLink>
    </div>
  </article>
</template>
