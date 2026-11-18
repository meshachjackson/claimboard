<script setup lang="ts">
// Registry · Table: one dense row per agent, sortable, with saved column sets and a picker over every field
// plus the computed signals. Grade badges sit inline.
import type { AgentView } from '~/stores/registry'
import { FIELD_LABELS, LIFECYCLE_PILLS, MONO_FIELDS, SECTIONS } from '~/types/registry'
import { day, gradeOf } from '~/utils/registry'

useHead({ title: `Registry table · ${useAppName()}` })
const registry = useRegistryStore()
const { matches } = useRegistryFilters()
const { openAgent } = useRegistryUi()

// Computed signals the picker offers next to the 44 fields.
const SIGNALS: Record<string, { label: string, text: (v: AgentView) => string }> = {
  sig_gap: { label: 'Activation gap', text: v => v.signals.gapItems.join(', ') },
  sig_drift: { label: 'Version drift', text: v => v.signals.drift ? `live ${v.signals.drift.live} · expected ${v.signals.drift.expected || 'blank'}` : '' },
  sig_access: { label: 'Access not current', text: v => v.signals.notCurrent ? String(v.signals.notCurrent) : '' },
  sig_unknown: { label: 'Unknown facts', text: v => v.signals.unknownFacts.length ? String(v.signals.unknownFacts.length) : '' },
  sig_review: { label: 'Review', text: v => v.signals.neverReviewed ? 'Never reviewed' : v.signals.stale ? 'Stale (90+ days)' : '' },
  sig_flight: { label: 'Change in flight', text: v => v.signals.awaiting.length || v.signals.upgradeCards ? `${v.signals.awaiting.length} awaiting · ${v.signals.upgradeCards} upgrade cards` : '' },
  sig_live: { label: 'Live version', text: v => registry.deployed?.agents[v.row.agent_id]?.active_version ?? '' }
}

const SETS: Record<string, string[]> = {
  Routing: ['agent_type', 'host', 'inference', 'reachability', 'request_types'],
  Deployment: ['deploy_state', 'deploy_ref', 'expected_version', 'sig_live', 'sig_drift', 'deploy_verified_at'],
  Ownership: ['owner', 'retention_owner', 'escalation_owner', 'incident_contact', 'last_reviewed_at', 'sig_review']
}
const set = ref<keyof typeof SETS | 'Custom'>('Routing')
const columns = ref<string[]>([...SETS.Routing!])
function pickSet(name: keyof typeof SETS) {
  set.value = name
  columns.value = [...SETS[name]!]
}
function toggle(col: string) {
  set.value = 'Custom'
  columns.value = columns.value.includes(col) ? columns.value.filter(c => c !== col) : [...columns.value, col]
}
// Custom only shows up as a choice once the picker has changed a set.
const setChoices = computed(() => [...Object.keys(SETS), ...(set.value === 'Custom' ? ['Custom'] : [])].map(id => ({ id, label: id })))
function onSet(id: string) {
  if (id in SETS) pickSet(id as keyof typeof SETS)
}
const pickerOpen = ref(false)
const allFields = SECTIONS.flatMap(s => s.fields).filter(f => !['agent_id', 'name', 'lifecycle_status', 'fact_grades'].includes(f))

const sortKey = ref('name')
const sortDir = ref<1 | -1>(1)
function sortBy(key: string) {
  if (sortKey.value === key) sortDir.value = sortDir.value === 1 ? -1 : 1
  else {
    sortKey.value = key
    sortDir.value = 1
  }
}
const cellText = (v: AgentView, col: string) => SIGNALS[col] ? SIGNALS[col]!.text(v) : (v.row[col] ?? '')
const rows = computed(() => registry.views.filter(v => matches(v))
  .sort((a, b) => cellText(a, sortKey.value).localeCompare(cellText(b, sortKey.value)) * sortDir.value))
const label = (col: string) => SIGNALS[col]?.label ?? FIELD_LABELS[col] ?? col
const isDate = (col: string) => col.endsWith('_at')
</script>

<template>
  <RegistryShell v-slot="{ phone }">
    <main v-if="phone" class="p-4 text-[15px] text-text2">
      <p class="m-0">The Table is desktop only. It has too many columns for a phone.</p>
      <p class="mt-2 mb-0">On the phone, use <NuxtLink to="/registry" class="font-semibold text-accent underline-offset-2 hover:underline">Fleet</NuxtLink> to see every agent, or Problems and Approvals for what needs you.</p>
    </main>
    <template v-else>
      <main class="flex flex-1 flex-col gap-3 px-5 pt-3 pb-10">
        <div class="flex flex-wrap items-center gap-3">
          <span id="rg-colset" class="text-sm font-semibold text-text2">Columns</span>
          <SegChoice :options="setChoices" :model-value="set" labelledby="rg-colset" @update:model-value="onSet" />
          <div class="relative">
            <button type="button" class="rg-btn rg-btn-line" :aria-expanded="pickerOpen" @click="pickerOpen = !pickerOpen">Pick columns · {{ columns.length }}</button>
            <div v-if="pickerOpen" class="absolute top-12 left-0 z-20 grid max-h-[420px] w-[560px] grid-cols-2 gap-x-4 overflow-y-auto rounded border-2 border-rule bg-surface p-3">
              <p class="col-span-2 m-0 pb-1 font-display text-lg font-bold">Computed signals</p>
              <label v-for="(s, key) in SIGNALS" :key="key" class="flex h-8 cursor-pointer items-center gap-2 text-[13px]">
                <input type="checkbox" class="size-4 accent-ink" :checked="columns.includes(key)" @change="toggle(key)">{{ s.label }}
              </label>
              <p class="col-span-2 m-0 pt-2 pb-1 font-display text-lg font-bold">Registry fields</p>
              <label v-for="f in allFields" :key="f" class="flex h-8 cursor-pointer items-center gap-2 text-[13px]">
                <input type="checkbox" class="size-4 accent-ink" :checked="columns.includes(f)" @change="toggle(f)">{{ FIELD_LABELS[f] ?? f }} <span class="truncate font-mono text-xs text-text3">{{ f }}</span>
              </label>
            </div>
          </div>
        </div>

        <div class="overflow-x-auto bg-surface">
          <table class="w-full border-collapse text-left text-[13px]">
            <thead class="border-b-2 border-rule bg-surface text-xs text-text3">
              <tr>
                <th class="sticky left-0 min-w-[220px] bg-surface px-3 py-2">
                  <button type="button" class="min-h-6 cursor-pointer font-semibold" @click="sortBy('name')">Agent {{ sortKey === 'name' ? (sortDir === 1 ? '↑' : '↓') : '' }}</button>
                </th>
                <th class="px-2 py-2"><button type="button" class="min-h-6 cursor-pointer font-semibold" @click="sortBy('lifecycle_status')">Lifecycle {{ sortKey === 'lifecycle_status' ? (sortDir === 1 ? '↑' : '↓') : '' }}</button></th>
                <th v-for="col in columns" :key="col" class="px-2 py-2 whitespace-nowrap">
                  <button type="button" class="min-h-6 cursor-pointer font-semibold" @click="sortBy(col)">{{ label(col) }} {{ sortKey === col ? (sortDir === 1 ? '↑' : '↓') : '' }}</button>
                </th>
                <th class="px-2 py-2 font-semibold">Flags</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="v in rows" :key="v.row.agent_id" class="cursor-pointer border-t border-line bg-surface align-top hover:bg-(--ab-row-hover)" @click="openAgent(v.row.agent_id)">
                <td class="sticky left-0 bg-inherit px-3 py-2">
                  <button type="button" class="flex cursor-pointer items-center gap-2 text-left">
                    <RegistryRegAvatar :id="v.row.agent_id" :size="24" />
                    <span class="flex flex-col">
                      <span class="font-semibold">{{ v.row.name }}</span>
                      <span class="font-mono text-xs text-text3">{{ v.row.agent_id }}</span>
                    </span>
                  </button>
                </td>
                <td class="px-2 py-2"><StatusPill :pill="LIFECYCLE_PILLS[v.row.lifecycle_status]" /></td>
                <td v-for="col in columns" :key="col" class="max-w-[260px] px-2 py-2">
                  <span v-if="SIGNALS[col]" :class="cellText(v, col) ? 'font-medium text-(--ab-red-text)' : 'text-text3'">{{ cellText(v, col) || '—' }}</span>
                  <span v-else class="flex flex-wrap items-center gap-1.5">
                    <span v-if="v.row[col]" class="break-words" :class="MONO_FIELDS.has(col) && 'font-mono text-xs'">{{ isDate(col) ? day(v.row[col]) : v.row[col] }}</span>
                    <RegistryGradeBadge :grade="gradeOf(v.row, col)" />
                  </span>
                </td>
                <td class="px-2 py-2">
                  <span class="flex flex-wrap gap-1">
                    <RegistryFlagChip v-for="f in v.flags.slice(0, 3)" :key="f.kind" :flag="f" />
                    <span v-if="v.flags.length > 3" class="text-xs font-semibold text-text2">+{{ v.flags.length - 3 }}</span>
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </main>
    </template>
  </RegistryShell>
</template>
