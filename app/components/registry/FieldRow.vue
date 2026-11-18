<script setup lang="ts">
// One registry field: label, grade badge after the label, the value (or a requested change), and a pencil.
// Nothing saves in place: the pencil opens the change request composer.
import { FIELD_LABELS, MONO_FIELDS } from '~/types/registry'
import { gradeOf } from '~/utils/registry'
import type { RegistryRow } from '~/types/registry'

const props = defineProps<{ row: RegistryRow, field: string, display?: string }>()
const registry = useRegistryStore()
const { composer } = useRegistryUi()

const value = computed(() => props.display ?? props.row[props.field] ?? '')
const requested = computed(() => registry.requestedValue(props.row.agent_id, props.field))
const label = computed(() => FIELD_LABELS[props.field] ?? props.field)
const editable = computed(() => !['agent_id', 'deploy_state', 'fact_grades', 'lifecycle_status'].includes(props.field))
</script>

<template>
  <dt class="flex flex-wrap items-center gap-1.5 font-semibold text-text2">
    {{ label }}
    <RegistryGradeBadge :grade="gradeOf(row, field)" />
  </dt>
  <dd class="m-0 flex min-w-0 items-start gap-2">
    <span v-if="requested" class="flex min-w-0 flex-col gap-0.5">
      <span class="break-words text-text3 line-through">{{ requested.old_value || 'Unknown' }}</span>
      <span class="break-words rounded bg-(--ab-blue-tint) px-1.5">{{ requested.new_value || 'blank' }} <span class="text-xs font-semibold text-(--ab-orange-fg)">· requested</span></span>
    </span>
    <span v-else-if="value" class="min-w-0 break-words" :class="MONO_FIELDS.has(field) && 'font-mono text-[12.5px]'">{{ value }}</span>
    <span v-else class="text-text3">Unknown</span>
    <button
      v-if="editable"
      type="button"
      :aria-label="`Request change to ${label}`"
      class="ml-auto inline-flex size-8 flex-none max-sm:size-11 cursor-pointer items-center justify-center rounded-md text-text3 hover:bg-chip hover:text-ink"
      @click="composer = { agentId: row.agent_id, field, mode: 'field' }"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z" /></svg>
    </button>
  </dd>
</template>
