<script setup lang="ts">
// Live dot and refresh for the bar. On fixtures the dot is a hollow ring; Registry's button resets its sample data.
// `phone` shows the dot and a word, no button.
import { LOCAL_FILE_LABEL } from '~/types/board'
import { formatTime } from '~/utils/format'

const props = defineProps<{
  source: 'fixtures' | 'gateway' | 'file' | null
  readOnly: boolean
  updatedAt: string | null
  refreshing: boolean
  saved?: boolean // fixtures mode with a board file: the server holds the rows, so the button refreshes
  resettable?: boolean // fixtures mode: draw the reset button (Registry; the board's lives in Settings > Data)
  phone?: boolean
}>()
const emit = defineEmits<{ refresh: [], reset: [] }>()

// A pulled copy (source 'file') holds real rows, so it gets the live dot and Refresh, labeled as a copy.
const live = computed(() => props.source === 'gateway' || props.source === 'file' || !!props.saved)
const label = computed(() => props.saved ? LOCAL_FILE_LABEL : props.source === 'file' ? 'Pulled copy' : 'Live')
const status = computed(() => {
  if (!live.value) return 'Prototype · fixtures'
  const parts = [label.value, props.readOnly ? 'read only' : '', props.updatedAt ? `updated ${formatTime(props.updatedAt)}` : '']
  return parts.filter(Boolean).join(' · ')
})
</script>

<template>
  <span v-if="phone" :title="status" class="inline-flex items-center gap-1.5 text-xs text-text3">
    <span aria-hidden="true" class="size-[7px] rounded-full" :class="live ? 'bg-(--ab-green-dot)' : 'border border-dashed border-dash'" />
    {{ live ? label : 'Prototype' }}
  </span>
  <span v-else :title="status" class="inline-flex h-8 items-center gap-1 pl-1">
    <span aria-hidden="true" class="size-[7px] rounded-full" :class="live ? 'ab-live bg-(--ab-green-dot)' : 'border border-dashed border-dash'" />
    <button
      v-if="live"
      type="button"
      :aria-label="`Refresh now. ${status}`"
      class="ab-ghost inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-text2 disabled:opacity-50"
      :disabled="refreshing"
      @click="emit('refresh')"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" :class="refreshing && 'animate-spin motion-reduce:animate-none'"><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></svg>
    </button>
    <button
      v-else-if="resettable"
      type="button"
      aria-label="Reset sample data. Prototype on fixtures"
      class="ab-ghost inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-text3"
      @click="emit('reset')"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 11a8 8 0 1 1 2.3 5.7" /><path d="M4 4v7h7" /></svg>
    </button>
  </span>
</template>
