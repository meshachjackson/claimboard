<script setup lang="ts">
// Overview: what it does and what it must never do, side by side, then every other field by section.
import type { RegistryRow } from '~/types/registry'
import { SECTIONS } from '~/types/registry'
import { gradeOf } from '~/utils/registry'

const props = defineProps<{ row: RegistryRow, phone?: boolean }>()
const registry = useRegistryStore()
const { composer } = useRegistryUi()

const boxes = computed(() => [
  { field: 'description', title: "What it's for", value: props.row.description, extra: props.row.responsibilities },
  { field: 'exclusions', title: 'What it must never do', value: props.row.exclusions, extra: '' }
])
// Description and the never-list sit in the boxes; the rest go in their sections.
const sections = SECTIONS.map(s => ({ ...s, fields: s.fields.filter(f => !['description', 'exclusions'].includes(f)) }))
const policies = computed(() => registry.policy.filter(p => p.agent_id === props.row.agent_id || p.agent_id === '*'))
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="grid gap-3" :class="phone ? 'grid-cols-1' : 'grid-cols-2'">
      <div v-for="b in boxes" :key="b.field" class="flex flex-col gap-1.5 bg-ground px-4 py-3">
        <div class="flex items-center gap-1.5">
          <h3 class="rg-h3 text-[17px]!">{{ b.title }}</h3>
          <RegistryGradeBadge :grade="gradeOf(row, b.field)" />
          <button type="button" :aria-label="`Request change to ${b.title}`" class="ml-auto inline-flex size-8 cursor-pointer max-sm:size-11 items-center justify-center rounded-md text-text3 hover:bg-chip" @click="composer = { agentId: row.agent_id, field: b.field, mode: 'field' }">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z" /></svg>
          </button>
        </div>
        <p class="m-0 text-[15px] leading-normal" :class="b.value ? 'text-ink' : 'text-text3'">{{ b.value || 'Unknown · not filed yet' }}</p>
        <p v-if="b.extra" class="m-0 text-sm leading-normal text-text2">{{ b.extra }}</p>
      </div>
    </div>

    <section v-for="sec in sections" :key="sec.id" class="flex flex-col gap-2">
      <h3 class="rg-h3 rg-head">{{ sec.title }}</h3>
      <dl class="m-0 grid gap-x-4 gap-y-2.5 text-[13px]" :class="phone ? 'grid-cols-1' : 'grid-cols-[200px_minmax(0,1fr)]'">
        <RegistryFieldRow v-for="f in sec.fields" :key="f" :row="row" :field="f" />
      </dl>
    </section>

    <section class="flex flex-col gap-2">
      <h3 class="rg-h3 rg-head">Start rules</h3>
      <ul class="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px]">
        <li v-for="p in policies" :key="p.policy_id" class="flex flex-wrap gap-x-2">
          <span class="font-mono text-text2">{{ p.policy_id }}</span>
          <span class="font-mono">{{ p.task_type }}</span>
          <span>· start {{ p.start }}{{ p.requires_approval ? ' · needs approval' : '' }}</span>
          <span class="text-text3">· {{ p.note }}{{ p.agent_id === '*' ? ' (every agent)' : '' }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>
