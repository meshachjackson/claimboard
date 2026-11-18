<script setup lang="ts">
// The phone's Display section in the filter sheet: Group by (None | Project), Sort, Show archived.
// On a desktop these live in View options (ViewOptions.vue).
import type { SortKey } from '~/types/board'
import { SORT_KEYS, SORT_LABELS } from '~/types/board'

const { query, set } = useBoardFilters()
const sort = useColumnSort()

const lane = computed(() => query.value.lanes ? query.value.lane_by : 'none')
const pickLane = (l: string) => set({ lanes: l !== 'none', lane_by: l === 'epic' || l === 'milestone' ? l : '' })
</script>

<template>
  <div class="flex flex-col gap-3">
    <span class="pt-1.5 text-xs font-bold tracking-[0.06em] text-text3 uppercase">Display</span>
    <label class="flex h-12 items-center border-b border-line text-[15px]">
      Group by
      <select class="ml-auto h-11 cursor-pointer border-0 bg-transparent text-right text-[15px] text-text3" :value="lane" @change="pickLane(($event.target as HTMLSelectElement).value)">
        <option value="none">None</option>
        <option value="project">Project</option>
        <option value="epic">Epic</option>
        <option value="milestone">Milestone</option>
      </select>
    </label>
    <label class="flex h-12 items-center border-b border-line text-[15px]">
      Sort cards by
      <select class="ml-auto h-11 cursor-pointer border-0 bg-transparent text-right text-[15px] text-text3" :value="sort.key.value" @change="sort.setKey(($event.target as HTMLSelectElement).value as SortKey)">
        <option v-for="k in SORT_KEYS" :key="k" :value="k">{{ SORT_LABELS[k] }}</option>
      </select>
    </label>
    <div class="flex h-12 items-center text-[15px]">
      <span id="ab-archived-phone">Show archived</span>
      <ToggleSwitch class="ml-auto" phone :on="query.archived" labelledby="ab-archived-phone" @toggle="set({ archived: !query.archived })" />
    </div>
  </div>
</template>
