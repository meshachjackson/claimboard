<script setup lang="ts">
// View options (Board v4): the Display controls. They sit in the Filters panel (UX Phase 5), one click deeper than the
// old bar button. Changes apply to this view and the URL; Settings holds the defaults. In the table the column headers sort, so Group by and Sort hide.
import type { Density, SortKey } from '~/types/board'
import { DENSITIES, DENSITY_LABELS, SORT_KEYS, SORT_LABELS } from '~/types/board'

const { query, set } = useBoardFilters()
const sort = useColumnSort()
const { density, setDensity, groupList, setGroupList } = useSettings()
const isTable = computed(() => query.value.layout === 'table')

// Group by: None, or swimlanes by project, epic or milestone (lane_by). Project is the URL's default lane_by.
const lanes = [['none', 'None'], ['project', 'Project'], ['epic', 'Epic'], ['milestone', 'Milestone']] as const
const lane = computed(() => query.value.lanes ? query.value.lane_by : 'none')
const pickLane = (l: string) => set({ lanes: l !== 'none', lane_by: l === 'epic' || l === 'milestone' ? l : '' })
const seg = 'inline-flex h-7 cursor-pointer items-center rounded-md px-2.5 text-[13px] font-semibold'
const on = 'bg-(--ab-seg-on) text-ink shadow-[0_1px_2px_rgba(16,24,40,0.08)]'
</script>

<template>
  <div class="flex min-w-0 flex-col gap-3.5" role="group" aria-label="View options">
    <h3 class="m-0 text-xs font-semibold text-ink">View options</h3>
    <div v-if="!isTable" class="flex flex-col gap-1.5">
      <span id="vo-lanes" class="text-xs text-text3">Group by</span>
      <div role="group" aria-labelledby="vo-lanes" class="inline-flex w-fit gap-0.5 rounded-lg bg-(--ab-seg-track) p-0.5">
        <button v-for="l in lanes" :key="l[0]" type="button" :aria-pressed="lane === l[0]" :class="[seg, lane === l[0] ? on : 'text-text3']" @click="pickLane(l[0])">{{ l[1] }}</button>
      </div>
    </div>
    <label v-if="!isTable" class="flex flex-col gap-1.5 text-xs text-text3">
      Sort cards by
      <select class="ab-select h-8! bg-ground!" :value="sort.key.value" @change="sort.setKey(($event.target as HTMLSelectElement).value as SortKey)">
        <option v-for="k in SORT_KEYS" :key="k" :value="k">{{ SORT_LABELS[k] }}</option>
      </select>
    </label>
    <div v-if="!isTable && query.lanes" class="flex flex-col gap-1.5">
      <span id="vo-layout" class="text-xs text-text3">Groups show as</span>
      <div role="group" aria-labelledby="vo-layout" class="inline-flex w-fit gap-0.5 rounded-lg bg-(--ab-seg-track) p-0.5">
        <button type="button" :aria-pressed="!groupList" :class="[seg, !groupList ? on : 'text-text3']" @click="setGroupList(false)">Columns</button>
        <button type="button" :aria-pressed="groupList" :class="[seg, groupList ? on : 'text-text3']" @click="setGroupList(true)">List</button>
      </div>
    </div>
    <div class="flex flex-col gap-1.5">
      <span id="vo-density" class="text-xs text-text3">Cards</span>
      <div role="group" aria-labelledby="vo-density" class="inline-flex w-fit gap-0.5 rounded-lg bg-(--ab-seg-track) p-0.5">
        <button v-for="d in DENSITIES" :key="d" type="button" :aria-pressed="density === d" :class="[seg, density === d ? on : 'text-text3']" @click="setDensity(d as Density)">{{ DENSITY_LABELS[d] }}</button>
      </div>
    </div>
    <div class="flex items-center gap-2.5">
      <span id="vo-archived" class="flex-1 text-[13px]">Show archived</span>
      <ToggleSwitch :on="query.archived" labelledby="vo-archived" @toggle="set({ archived: !query.archived })" />
    </div>
    <NuxtLink to="/settings" class="border-t border-line pt-2.5 text-xs font-semibold text-(--ab-blue-link) no-underline">Set defaults in Settings</NuxtLink>
  </div>
</template>
