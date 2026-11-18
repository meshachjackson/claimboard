<script setup lang="ts">
// Phone filter sheet (header refresh v3): each column is an accordion section (the first opens by default),
// 44px rows, then the page's Display controls, then Clear all and "Show n tasks".
import type { FacetColumn } from '~/utils/facets'

defineProps<{ columns: FacetColumn[], showLabel: string }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ 'toggle': [key: string, value: string], 'clear-all': [] }>()

// Which sections are open; the first column's is open until he closes it.
const expanded = ref<Record<string, boolean>>({})
const isOpen = (col: FacetColumn, i: number) => expanded.value[col.key] ?? i === 0
function flip(col: FacetColumn, i: number) {
  expanded.value = { ...expanded.value, [col.key]: !isOpen(col, i) }
}

function summary(col: FacetColumn): string {
  const on = col.options.filter(o => o.on).map(o => o.label)
  return on.length ? on.join(', ') : col.anyLabel ?? 'Any'
}
</script>

<template>
  <USlideover
    v-model:open="open"
    side="bottom"
    title="Filters"
    description="Filters and display"
    :ui="{ content: 'h-[640px] max-h-[88dvh] rounded-t-2xl border-t border-line bg-surface' }"
  >
    <template #content>
      <div class="flex h-full flex-col">
        <div class="flex justify-center pt-2 pb-0.5"><span aria-hidden="true" class="h-1 w-9 rounded-full bg-input" /></div>
        <div class="flex items-center py-1 pr-2 pl-5">
          <h2 class="m-0 text-[17px] font-bold">Filters</h2>
          <button type="button" class="ml-auto h-11 cursor-pointer px-3 text-sm font-semibold text-(--ab-blue-link)" @click="emit('clear-all')">Clear all</button>
        </div>

        <div class="flex flex-1 flex-col gap-[18px] overflow-y-auto px-5 pb-3">
          <div class="flex flex-col">
            <template v-for="(col, i) in columns" :key="col.key">
              <button
                type="button"
                :aria-expanded="isOpen(col, i)"
                :aria-controls="`ab-sheet-${col.key}`"
                class="flex h-[52px] w-full cursor-pointer items-center gap-2 text-left text-[15px] font-semibold"
                :class="i > 0 && 'border-t border-line'"
                @click="flip(col, i)"
              >
                {{ col.label }}
                <span class="ml-auto max-w-[60%] truncate text-sm" :class="col.options.some(o => o.on) ? 'font-semibold text-ink' : 'font-normal text-text3'">{{ summary(col) }}</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="flex-none text-text3" :class="isOpen(col, i) && 'rotate-180'"><path d="M6 9l6 6 6-6" /></svg>
              </button>
              <div v-if="isOpen(col, i)" :id="`ab-sheet-${col.key}`" role="group" :aria-label="col.label" class="flex flex-col pb-2">
                <template v-for="o in col.options" :key="o.value">
                  <span v-if="o.divider" aria-hidden="true" class="mx-1 my-1 block h-px bg-line" />
                  <FilterOption :option="o" phone @change="emit('toggle', col.key, o.value)" />
                </template>
              </div>
            </template>
          </div>
          <slot name="display" />
        </div>

        <div class="flex gap-2.5 border-t border-line px-5 pt-3 pb-[max(24px,env(safe-area-inset-bottom))]">
          <button type="button" class="h-12 flex-1 cursor-pointer rounded-[10px] border border-input text-[15px] font-semibold" @click="emit('clear-all')">Clear all</button>
          <button type="button" class="h-12 flex-[2] cursor-pointer rounded-[10px] bg-ink text-[15px] font-semibold text-surface" @click="open = false">{{ showLabel }}</button>
        </div>
      </div>
    </template>
  </USlideover>
</template>
