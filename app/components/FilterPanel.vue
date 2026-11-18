<script setup lang="ts">
// The board's expanded filter panel (Board v4): filters only, no Display column. Two layouts by the panel's own width:
// checklist columns at 1180px and wider, and below that a rail of facets with one detail pane. Every change applies at
// once. Esc closes it from inside. Below the filters sit Saved views and View options (UX Phase 5): moved here from the bar.
import type { FacetColumn } from '~/utils/facets'
import { visibleOptions } from '~/utils/facets'

const props = defineProps<{ columns: FacetColumn[] }>()
const emit = defineEmits<{ toggle: [key: string, value: string], clear: [key: string], close: [] }>()

// Layout follows the panel's width, not the window's.
const root = ref<HTMLElement>()
const wide = ref(true)
const measure = () => { wide.value = (root.value?.clientWidth ?? 1200) >= 1180 }
let observer: ResizeObserver | null = null
onMounted(() => {
  measure()
  observer = new ResizeObserver(measure)
  if (root.value) observer.observe(root.value)
})
onBeforeUnmount(() => observer?.disconnect())

// "Show N more" per facet, for this visit; and the tag finder (production has 60+ tags).
const more = ref<Record<string, boolean>>({})
const tagQuery = ref('')
function shown(col: FacetColumn): FacetColumn {
  const q = tagQuery.value.trim().toLowerCase()
  return col.key === 'tags' && q ? { ...col, options: col.options.filter(o => o.label.toLowerCase().includes(q)) } : col
}
const list = (col: FacetColumn, limit: number) => visibleOptions(shown(col), !!more.value[col.key], limit)
const flip = (key: string) => { more.value = { ...more.value, [key]: !more.value[key] } }
const onCount = (col: FacetColumn) => col.options.filter(o => o.on).length

// Rail: which facet the detail pane shows.
const activeKey = ref('')
const active = computed(() => props.columns.find(c => c.key === activeKey.value) ?? props.columns[0]!)
const summary = (col: FacetColumn) => col.options.filter(o => o.on).map(o => o.label).join(', ') || 'Any'

const linkBtn = 'h-[26px] cursor-pointer self-start px-1.5 text-xs font-semibold text-(--ab-blue-link)'
</script>

<template>
  <section
    id="ab-filter-panel"
    ref="root"
    aria-label="Filters"
    class="ab-drop ab-panel border-b border-line bg-(--ab-bar) shadow-[0_10px_24px_rgba(16,24,40,0.08)]"
    @keydown.esc="emit('close')"
  >
    <div v-if="wide" class="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] items-start gap-x-5 gap-y-3 p-3.5">
      <div v-for="col in columns" :key="col.key" role="group" :aria-label="col.label" class="flex min-w-0 flex-col gap-px">
        <div class="mb-1 flex h-6 items-center gap-1.5 px-1.5">
          <span class="text-xs font-semibold" :class="onCount(col) ? 'text-ink' : 'text-text3'">{{ col.label }}</span>
          <template v-if="onCount(col)">
            <span class="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-xs font-bold text-white">{{ onCount(col) }}</span>
            <button type="button" :aria-label="`Clear ${col.label}`" class="ml-auto h-[22px] cursor-pointer px-0.5 text-xs font-semibold text-(--ab-blue-link)" @click="emit('clear', col.key)">Clear</button>
          </template>
        </div>
        <input v-if="col.key === 'tags'" v-model="tagQuery" type="search" placeholder="Find a tag…" aria-label="Find a tag" class="ab-select mb-1 h-7 rounded-md px-2 text-xs">
        <template v-for="o in list(col, 6).options" :key="o.value">
          <span v-if="o.divider" aria-hidden="true" class="mx-1.5 my-1 block h-px bg-line" />
          <FilterOption :option="o" @change="emit('toggle', col.key, o.value)" />
        </template>
        <button v-if="list(col, 6).hidden || more[col.key]" type="button" :class="linkBtn" @click="flip(col.key)">
          {{ more[col.key] ? 'Show less' : `Show ${list(col, 6).hidden} more` }}
        </button>
      </div>
    </div>

    <div v-else class="grid grid-cols-[196px_minmax(0,1fr)] items-start gap-x-4 p-3.5">
      <div role="tablist" aria-label="Filters" aria-orientation="vertical" class="flex flex-col gap-px">
        <button
          v-for="col in columns"
          :id="`ab-tab-${col.key}`"
          :key="col.key"
          type="button"
          role="tab"
          :aria-selected="active.key === col.key"
          aria-controls="ab-tabpanel"
          class="ab-ghost flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left"
          :class="active.key === col.key && 'bg-(--ab-row-on)'"
          @click="activeKey = col.key"
        >
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="text-[13px] font-semibold" :class="onCount(col) ? 'text-ink' : 'text-text2'">{{ col.label }}</span>
            <span class="truncate text-xs" :class="onCount(col) ? 'text-text2' : 'text-text3'">{{ summary(col) }}</span>
          </span>
          <span v-if="onCount(col)" class="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-xs font-bold text-white">{{ onCount(col) }}</span>
        </button>
      </div>
      <div id="ab-tabpanel" role="tabpanel" :aria-labelledby="`ab-tab-${active.key}`" class="min-w-0">
        <div class="mb-1 flex h-7 items-center gap-2 px-1.5">
          <input v-if="active.key === 'tags'" v-model="tagQuery" type="search" placeholder="Find a tag…" aria-label="Find a tag" class="ab-select h-7 w-48 rounded-md px-2 text-xs">
          <button v-if="onCount(active)" type="button" :aria-label="`Clear ${active.label}`" class="ml-auto h-[22px] cursor-pointer px-0.5 text-xs font-semibold text-(--ab-blue-link)" @click="emit('clear', active.key)">Clear</button>
        </div>
        <div class="[column-gap:20px] [columns:3_180px]">
          <template v-for="o in list(active, 12).options" :key="o.value">
            <span v-if="o.divider" aria-hidden="true" class="mx-1.5 my-1 block h-px bg-line" />
            <FilterOption :option="o" class="break-inside-avoid" @change="emit('toggle', active.key, o.value)" />
          </template>
        </div>
        <button v-if="list(active, 12).hidden || more[active.key]" type="button" :class="linkBtn" @click="flip(active.key)">
          {{ more[active.key] ? 'Show less' : `Show ${list(active, 12).hidden} more` }}
        </button>
      </div>
    </div>

    <!-- Moved here from the bar so it holds fewer buttons: one click deeper, same controls. -->
    <div class="grid grid-cols-1 items-start gap-x-8 gap-y-5 border-t border-line p-3.5 md:grid-cols-[minmax(0,280px)_minmax(0,320px)]">
      <ViewOptions />
      <SavedViews />
    </div>
  </section>
</template>
