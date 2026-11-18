<script setup lang="ts">
// Registry's expanded filter panel (header refresh v3; the board's moved to Board v4, components/FilterPanel.vue): checklist columns in a grid that reflows by width, and the
// page's Display controls on the right. Every change applies at once. Esc closes it from inside.
import type { FacetColumn } from '~/utils/facets'
import { visibleOptions } from '~/utils/facets'

defineProps<{ columns: FacetColumn[] }>()
const emit = defineEmits<{ toggle: [key: string, value: string], clear: [key: string], close: [] }>()

// "Show N more" per column, for this visit.
const more = ref<Record<string, boolean>>({})
</script>

<template>
  <section
    id="ab-filter-panel"
    aria-label="Filters"
    class="ab-drop ab-rpanel flex flex-wrap border-b border-line bg-(--ab-bar) shadow-[0_10px_24px_rgba(16,24,40,0.08)]"
    @keydown.esc="emit('close')"
  >
    <div class="grid min-w-0 flex-[999_1_900px] grid-cols-[repeat(auto-fill,minmax(168px,1fr))] items-start gap-x-5 gap-y-3 p-3.5">
      <div v-for="col in columns" :key="col.key" role="group" :aria-label="col.label" class="flex min-w-0 flex-col gap-px">
        <div class="mb-1 flex h-6 items-center gap-1.5 px-1.5">
          <span class="text-xs font-semibold" :class="col.options.some(o => o.on) ? 'text-ink' : 'text-text3'">{{ col.label }}</span>
          <template v-if="col.options.some(o => o.on)">
            <span class="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-xs font-bold text-white">{{ col.options.filter(o => o.on).length }}</span>
            <button type="button" :aria-label="`Clear ${col.label}`" class="ml-auto h-[22px] cursor-pointer px-0.5 text-xs font-semibold text-(--ab-blue-link)" @click="emit('clear', col.key)">Clear</button>
          </template>
        </div>
        <template v-for="o in visibleOptions(col, !!more[col.key]).options" :key="o.value">
          <span v-if="o.divider" aria-hidden="true" class="mx-1.5 my-1 block h-px bg-line" />
          <FilterOption :option="o" @change="emit('toggle', col.key, o.value)" />
        </template>
        <button
          v-if="visibleOptions(col, !!more[col.key]).hidden || more[col.key]"
          type="button"
          class="h-[26px] cursor-pointer self-start px-1.5 text-xs font-semibold text-(--ab-blue-link)"
          @click="more = { ...more, [col.key]: !more[col.key] }"
        >
          {{ more[col.key] ? 'Show less' : `Show ${visibleOptions(col, false).hidden} more` }}
        </button>
      </div>
    </div>

    <div v-if="$slots.display" class="ab-display flex flex-[1_1_236px] flex-col gap-x-5 gap-y-3 px-5 pt-3.5 pb-4">
      <span class="ab-display-title flex h-6 items-center text-xs font-semibold text-text3">Display</span>
      <slot name="display" />
    </div>
  </section>
</template>

