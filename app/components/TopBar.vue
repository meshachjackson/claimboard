<script setup lang="ts">
// The 52px desktop bar shared by Board and Registry (header refresh v3, Board v4): mark and tabs, search, the attention
// pills, the applied-filter summary, the Filters toggle, then each page's own queues and actions. One row at every width.
import type { BarPill, BarToken } from '~/utils/facets'
import { PILL_TONES } from '~/types/board'

const props = defineProps<{
  title: string
  searchLabel: string
  q: string
  pills: BarPill[]
  tokens: BarToken[]
  countLabel: string
  facetCount: number
  hasActive: boolean
  expanded: boolean
}>()
const emit = defineEmits<{
  'search': [value: string]
  'pill': [value: string]
  'remove-token': [key: string]
  'toggle': []
  'clear-all': []
}>()

// How many tokens fit follows the summary's width: two at 420px or wider, one from 280px,
// and under 280px a single "2 filters" chip. "+N" and the chip open the panel; the count and Clear always stay.
const sum = ref<HTMLElement>()
const sumWidth = ref(1000)
const limit = computed(() => sumWidth.value >= 420 ? 2 : sumWidth.value >= 280 ? 1 : 0)
const compact = computed(() => limit.value === 0 && props.tokens.length > 0)
const shownTokens = computed(() => props.tokens.slice(0, limit.value))
const extra = computed(() => props.tokens.length - shownTokens.value.length)
let observer: ResizeObserver | null = null
onMounted(() => {
  observer = new ResizeObserver(() => { sumWidth.value = sum.value?.clientWidth ?? sumWidth.value })
  if (sum.value) observer.observe(sum.value)
})
onBeforeUnmount(() => observer?.disconnect())

function pillStyle(p: BarPill) {
  const tone = PILL_TONES[p.tone]
  return p.on
    ? { background: tone.bg, borderColor: tone.border, color: tone.fg }
    : { background: 'transparent', borderColor: 'var(--color-line)', color: p.count ? 'var(--color-ink)' : 'var(--color-text3)' }
}

const search = ref<HTMLInputElement>()
const toggleBtn = ref<HTMLButtonElement>()
defineExpose({
  focusSearch: () => search.value?.focus(),
  focusToggle: () => toggleBtn.value?.focus()
})
</script>

<template>
  <header class="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b-2 border-rule bg-(--ab-bar) py-1.5 pr-4 pl-5" style="min-height: 56px">
    <!-- The rail carries the app's places; the bar names the page and holds its own controls. -->
    <RailShow />
    <h1 class="m-0 mr-2 font-display text-[26px] leading-none font-bold text-ink">{{ title }}</h1>
    <div v-if="$slots.tabs" class="-my-1.5 mr-3 flex self-stretch">
      <slot name="tabs" />
    </div>

    <label class="ab-search flex h-8 min-w-[110px] items-center gap-2 rounded-lg border border-input bg-ground pr-1.5 pl-2.5 text-text3">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
      <input
        ref="search"
        type="search"
        :aria-label="searchLabel"
        :placeholder="searchLabel"
        :value="q"
        class="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-ink outline-none focus-visible:outline-none"
        @input="emit('search', ($event.target as HTMLInputElement).value)"
      >
      <kbd class="ab-narrow-hide rounded border border-input px-1.5 py-[3px] font-mono text-xs leading-none text-text3">/</kbd>
    </label>

    <div role="group" aria-label="Attention" class="flex flex-none gap-1.5">
      <button
        v-for="p in pills"
        :key="p.value"
        type="button"
        :aria-pressed="p.on"
        :aria-label="`${p.label}, ${p.count}`"
        :title="p.label"
        class="inline-flex h-[30px] cursor-pointer items-center gap-[7px] rounded-full border px-2.5 text-[13px] font-medium whitespace-nowrap hover:border-input"
        :style="pillStyle(p)"
        @click="emit('pill', p.value)"
      >
        <span aria-hidden="true" class="size-[7px]" :class="p.square ? 'rounded-[2px]' : 'rounded-full'" :style="{ background: PILL_TONES[p.tone].dot }" />
        <span class="ab-narrow-hide">{{ p.label }}</span>
        <span class="font-mono text-xs" :class="!p.on && 'text-text3'">{{ p.count }}</span>
      </button>
    </div>

    <div ref="sum" aria-label="Applied filters" role="group" class="relative flex min-w-0 flex-[1_1_0] items-center gap-1.5 overflow-hidden py-2">
      <button
        v-if="compact"
        type="button"
        aria-controls="ab-filter-panel"
        class="ab-ghost inline-flex h-[26px] flex-none cursor-pointer items-center rounded-full border border-line bg-surface px-2.5 text-xs font-medium whitespace-nowrap"
        @click="emit('toggle')"
      >
        {{ tokens.length === 1 ? '1 filter' : `${tokens.length} filters` }}
      </button>
      <div v-else class="flex min-w-0 items-center gap-1.5 overflow-hidden">
        <span
          v-for="t in shownTokens"
          :key="t.key"
          class="inline-flex h-[26px] max-w-[168px] min-w-0 items-center gap-[5px] rounded-full border border-line bg-surface pr-0.5 pl-[9px] text-xs"
        >
          <span class="text-text3">{{ t.label }}</span>
          <span class="truncate font-medium">{{ t.value }}</span>
          <button
            type="button"
            :aria-label="`Remove ${t.label} filter`"
            class="ab-ghost inline-flex size-[22px] flex-none cursor-pointer items-center justify-center rounded-full text-text3"
            @click="emit('remove-token', t.key)"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </span>
        <button
          v-if="extra > 0"
          type="button"
          aria-controls="ab-filter-panel"
          class="ab-ghost h-[26px] flex-none cursor-pointer rounded-full border border-line px-[9px] text-xs font-medium text-text2"
          @click="emit('toggle')"
        >
          +{{ extra }}
        </button>
      </div>
      <span class="inline-flex flex-none items-center gap-1.5">
        <span class="text-xs whitespace-nowrap text-text3">{{ countLabel }}</span>
        <button
          v-if="hasActive"
          type="button"
          aria-label="Clear all filters"
          class="h-[26px] cursor-pointer px-0.5 text-xs font-semibold text-(--ab-blue-link)"
          @click="emit('clear-all')"
        >
          Clear
        </button>
      </span>
    </div>

    <div class="flex flex-none items-center gap-2">
      <slot name="queues" />
      <button
        ref="toggleBtn"
        type="button"
        :aria-expanded="expanded"
        aria-controls="ab-filter-panel"
        aria-label="Filters"
        title="Filters ( F )"
        class="ab-ghost inline-flex h-8 cursor-pointer items-center gap-[7px] rounded-lg border pr-1.5 pl-2.5 text-[13px] font-medium"
        :class="expanded || facetCount ? 'border-input' : 'border-line'"
        :style="{ background: expanded ? 'var(--ab-seg-track)' : undefined }"
        @click="emit('toggle')"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
        <span class="ab-compact-hide">Filters</span>
        <span v-if="facetCount" class="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-[5px] text-xs font-bold text-white">{{ facetCount }}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" :class="expanded && 'rotate-180'"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      <span aria-hidden="true" class="h-5 w-px bg-line" />
      <slot name="actions" />
    </div>
  </header>
</template>
