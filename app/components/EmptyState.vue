<script setup lang="ts">
// One small empty (or still loading) list. Loading shows quiet bars, never "nothing here", because a list that has not
// arrived yet is not an empty list. Give it `head` (a Floor zone's tone and title) and loading also draws the zone's
// head with a dash for the count, so the Floor never shows a false 0. Empty shows what is true and, when there is a
// next move, one button for it.
import type { FloorTone } from '~/utils/floorLook'
import { zoneLook } from '~/utils/floorLook'

defineProps<{
  loading?: boolean, title?: string, hint?: string, action?: string
  head?: { tone: FloorTone, title: string }, compact?: boolean
}>()
defineEmits<{ action: [] }>()
</script>

<template>
  <template v-if="loading">
    <div v-if="head" class="flex items-end gap-4" :class="[zoneLook(head.tone, 0), compact ? 'px-5 py-3' : 'px-6 pt-5 pb-4']">
      <span class="font-display leading-[0.8] font-bold" :class="compact ? 'text-[56px]' : 'text-[112px]'">–</span>
      <div class="min-w-0 flex-1 pb-0.5">
        <h2 class="m-0 font-display leading-none font-bold" :class="compact ? 'text-[24px]' : 'text-[34px]'">{{ head.title }}</h2>
        <p class="m-0 mt-1.5 text-[15px] font-medium">Loading…</p>
      </div>
    </div>
    <div class="flex flex-col gap-3 py-5" :class="head && 'px-6'" role="status" aria-busy="true">
      <span class="sr-only">Loading</span>
      <span v-for="n in 3" :key="n" class="h-4 animate-pulse rounded bg-line" :style="{ width: `${90 - n * 15}%` }" />
    </div>
  </template>
  <div v-else class="py-6">
    <p class="m-0 text-[15px] font-semibold text-ink">{{ title }}</p>
    <p v-if="hint" class="m-0 mt-1 text-[15px] text-text2">{{ hint }}</p>
    <button v-if="action" type="button" class="mt-3 inline-flex h-10 cursor-pointer items-center rounded bg-ink px-3.5 text-sm font-semibold whitespace-nowrap text-surface" @click="$emit('action')">{{ action }}</button>
  </div>
</template>
