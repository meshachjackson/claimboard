<script setup lang="ts">
// Phone header rows (header refresh v3): search plus a Filters button with a badge, then one scrolling row of
// the attention pills and the applied-filter tokens.
import type { BarPill, BarToken } from '~/utils/facets'
import { PILL_TONES } from '~/types/board'

defineProps<{ searchLabel: string, q: string, pills: BarPill[], tokens: BarToken[], facetCount: number }>()
const emit = defineEmits<{ 'search': [value: string], 'pill': [value: string], 'remove-token': [key: string], 'open': [] }>()
</script>

<template>
  <div class="flex gap-2 px-4 pb-2.5">
    <label class="flex h-11 flex-1 items-center gap-2 rounded-[10px] border border-input bg-ground px-3 text-text3 focus-within:ring-2 focus-within:ring-accent">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
      <input
        type="search"
        :aria-label="searchLabel"
        :placeholder="searchLabel"
        :value="q"
        class="min-w-0 flex-1 border-0 bg-transparent text-[15px] text-ink outline-none focus-visible:outline-none"
        @input="emit('search', ($event.target as HTMLInputElement).value)"
      >
    </label>
    <button
      type="button"
      :aria-label="facetCount ? `Filters, ${facetCount} applied` : 'Filters'"
      class="relative inline-flex size-11 flex-none cursor-pointer items-center justify-center rounded-[10px] border border-input bg-(--ab-seg-track) text-ink"
      @click="emit('open')"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
      <span v-if="facetCount" class="absolute -top-[5px] -right-[5px] inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-[5px] text-xs font-bold text-white">{{ facetCount }}</span>
    </button>
  </div>
  <div class="ab-row flex gap-1.5 overflow-x-auto px-4 pb-2.5">
    <button
      v-for="p in pills"
      :key="p.value"
      type="button"
      :aria-pressed="p.on"
      class="inline-flex h-11 flex-none cursor-pointer items-center gap-[7px] rounded-full border px-3 text-sm font-medium"
      :style="p.on
        ? { background: PILL_TONES[p.tone].bg, borderColor: PILL_TONES[p.tone].border, color: PILL_TONES[p.tone].fg }
        : { borderColor: 'var(--color-line)', color: p.count ? 'var(--color-ink)' : 'var(--color-text3)' }"
      @click="emit('pill', p.value)"
    >
      <span aria-hidden="true" class="size-[7px]" :class="p.square ? 'rounded-[2px]' : 'rounded-full'" :style="{ background: PILL_TONES[p.tone].dot, opacity: p.count || p.on ? 1 : 0.45 }" />
      {{ p.label }}
      <span class="font-mono text-xs" :class="!p.on && 'text-text3'">{{ p.count }}</span>
    </button>
    <span
      v-for="t in tokens"
      :key="t.key"
      class="inline-flex h-11 max-w-[260px] flex-none items-center gap-[5px] rounded-full border border-line bg-surface pr-0.5 pl-3 text-[13px]"
    >
      <span class="text-text3">{{ t.label }}</span>
      <span class="truncate font-medium">{{ t.value }}</span>
      <button
        type="button"
        :aria-label="`Remove ${t.label} filter`"
        class="inline-flex size-11 flex-none cursor-pointer items-center justify-center rounded-full text-text3"
        @click="emit('remove-token', t.key)"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </span>
  </div>
</template>
