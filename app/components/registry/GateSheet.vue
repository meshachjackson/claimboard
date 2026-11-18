<script setup lang="ts">
// Confirm-change sheet (the lifecycle gate): opens when a card is dropped on another column or "Move to…" is picked.
// It lists what the move needs and refuses to rehearse until every item passes (design rule 4).
import { LIFECYCLE_LABELS } from '~/types/registry'
import type { RequestDraft } from '~/utils/registry'
import { gateItems } from '~/utils/registry'

defineProps<{ phone?: boolean }>()
const registry = useRegistryStore()
const { gate, openAgent } = useRegistryUi()
const note = ref('')

const open = computed({
  get: () => !!gate.value,
  set: (v: boolean) => { if (!v) gate.value = null }
})
watch(gate, () => { note.value = '' })

const row = computed(() => gate.value ? registry.agent(gate.value.agentId) : undefined)
const items = computed(() => row.value && gate.value
  ? gateItems(row.value, gate.value.to, registry.accessFor(row.value.agent_id).length, note.value)
  : [])
const fails = computed(() => items.value.filter(i => !i.pass).length)
const noteRequired = computed(() => gate.value?.to === 'paused' || gate.value?.to === 'retired')

const draft = computed<RequestDraft>(() => ({
  kind: 'lifecycle',
  agent_id: row.value?.agent_id ?? '',
  title: row.value && gate.value ? `Lifecycle change on ${row.value.name}: ${row.value.lifecycle_status} → ${gate.value.to}` : '',
  diffs: row.value && gate.value
    ? [{ table: 'gov_registry', row_key: row.value.agent_id, field: 'lifecycle_status', old: row.value.lifecycle_status, new: gate.value.to },
        ...(gate.value.to === 'paused' && note.value.trim() ? [{ table: 'gov_registry' as const, row_key: row.value.agent_id, field: 'notes', old: row.value.notes, new: note.value.trim() }] : [])]
    : [],
  note: note.value.trim()
}))

function fix(tab?: string) {
  if (!row.value) return
  const id = row.value.agent_id
  gate.value = null
  openAgent(id, tab ?? 'overview')
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="row && gate ? `${row.name}: ${LIFECYCLE_LABELS[row.lifecycle_status]} → ${LIFECYCLE_LABELS[gate.to]}` : 'Confirm change'"
    description="Confirm change"
    :fullscreen="phone"
    :ui="{ content: phone ? '' : 'max-w-[560px]' }"
  >
    <template #content="{ close }">
      <div v-if="row && gate" class="rg-sheet flex flex-col gap-4 p-5.5">
        <div class="flex items-start gap-2.5">
          <div class="flex flex-1 flex-col gap-1">
            <span class="text-xs font-bold tracking-[0.06em] text-text3 uppercase">Confirm change</span>
            <h2 class="m-0 text-lg font-semibold">{{ row.name }}: {{ LIFECYCLE_LABELS[row.lifecycle_status] }} → {{ LIFECYCLE_LABELS[gate.to] }}</h2>
            <span class="font-mono text-xs text-text3">lifecycle_status: {{ row.lifecycle_status }} → {{ gate.to }}</span>
          </div>
          <button type="button" aria-label="Close" class="inline-flex size-11 cursor-pointer items-center justify-center rounded text-text2 hover:bg-chip" @click="close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div class="flex flex-col gap-2">
          <h3 class="m-0 text-[13px] font-bold text-text2">To move to {{ LIFECYCLE_LABELS[gate.to] }}, it needs</h3>
          <ul class="m-0 flex list-none flex-col rounded border border-line p-0">
            <li v-for="it in items" :key="it.label" class="flex items-center gap-2.5 border-b border-(--ab-neutral-bg) px-3 py-2.5 last:border-b-0">
              <span
                class="flex-none rounded-full px-[7px] py-px text-xs font-bold"
                :style="it.pass ? { background: 'var(--ab-green-bg)', color: 'var(--ab-green-fg)', border: '1px solid var(--ab-green-bg)' } : { background: 'var(--color-surface)', color: 'var(--ab-red-text)', border: '1px solid var(--ab-red-line)' }"
              >{{ it.pass ? '✓ Met' : '✕ Not met' }}</span>
              <span class="flex flex-1 flex-col gap-0.5">
                <span class="text-[13px] font-semibold">{{ it.label }}</span>
                <span class="text-xs text-text3">{{ it.detail }}</span>
              </span>
              <button v-if="!it.pass && it.fix && it.fixTab" type="button" class="rg-link text-[13px]" @click="fix(it.fixTab)">{{ it.fix }}</button>
              <span v-else-if="!it.pass && it.fix" class="text-xs text-text3">{{ it.fix }} (R1)</span>
            </li>
          </ul>
        </div>

        <label class="flex flex-col gap-1.5 text-xs font-semibold text-text2">
          Note for the review{{ noteRequired ? ' (required)' : ' (optional)' }}
          <textarea v-model="note" rows="2" placeholder="Why this move, in a sentence" class="w-full resize-y rounded border border-input px-2.5 py-2 text-sm font-normal text-ink" />
        </label>

        <RegistryRehearsal
          :draft="draft"
          :blocked="fails > 0"
          :blocked-text="`${fails} item${fails > 1 ? 's' : ''} not met. The request stays off until they pass.`"
        >
          <template #secondary>
            <button type="button" class="rg-btn rg-btn-line h-11" @click="close">Cancel</button>
          </template>
          <template #done>
            <span class="text-[13px] text-text2">{{ row.name }} stays in {{ LIFECYCLE_LABELS[row.lifecycle_status] }} until you approve.</span>
            <button type="button" class="rg-btn rg-btn-ink h-11" @click="close">Done</button>
          </template>
        </RegistryRehearsal>
      </div>
    </template>
  </UModal>
</template>
