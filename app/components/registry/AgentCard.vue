<script setup lang="ts">
// The agent card: the board's task card with agent content (spec "Agent card and its states").
import type { AgentView } from '~/stores/registry'
import { AWAITING_CARD, CARD_BORDER, CARD_SHADOW, FLAGGED_CARD_BORDER, REACH_LABELS } from '~/types/registry'
import { day } from '~/utils/registry'

const props = defineProps<{ view: AgentView, phone?: boolean }>()
const emit = defineEmits<{ open: [agentId: string] }>()

const row = computed(() => props.view.row)
const proposed = computed(() => row.value.lifecycle_status === 'proposed')
const retired = computed(() => row.value.lifecycle_status === 'retired')
const awaiting = computed(() => props.view.flags.some(f => f.kind === 'awaiting' || f.kind === 'requested'))
const flagged = computed(() => props.view.flags.some(f => f.kind === 'gap' || f.kind === 'drift'))

const border = computed(() => {
  if (awaiting.value) return `1px solid ${AWAITING_CARD.border}`
  if (flagged.value) return `1px solid ${FLAGGED_CARD_BORDER}`
  if (proposed.value) return '1px dashed var(--color-dash)'
  return `1px solid ${CARD_BORDER}`
})
const shadow = computed(() => awaiting.value ? AWAITING_CARD.shadow : CARD_SHADOW)
const shown = computed(() => props.view.flags.slice(0, 3))
const typeChip = computed(() => row.value.agent_type ? `${row.value.agent_type}${row.value.type_version ? ` v${row.value.type_version}` : ''}` : '')
const accessText = computed(() => {
  const s = props.view.signals
  return `${s.verified} verified${s.notCurrent ? ` · ${s.notCurrent} not current` : ''}`
})
const pausedReason = computed(() => row.value.lifecycle_status === 'paused' ? (row.value.notes || 'No reason noted') : '')
</script>

<template>
  <article
    :data-id="row.agent_id"
    class="relative flex flex-col gap-2 rounded-[2px_2px_6px_6px] bg-surface transition-transform duration-150 hover:-translate-y-px motion-reduce:transition-none"
    :class="[phone ? 'p-3.5' : 'p-3', retired && 'opacity-70']"
    :style="{ border, boxShadow: shadow }"
  >
    <div class="flex items-center gap-2">
      <RegistryRegAvatar :id="row.agent_id" :size="28" />
      <div class="flex min-w-0 flex-1 flex-col gap-px">
        <h3 class="m-0 leading-[1.3] font-semibold" :class="phone ? 'text-base' : 'text-[15px]'">
          <!-- The ::after overlay makes the whole card clickable while keeping a real button. -->
          <button
            type="button"
            class="cursor-pointer text-left after:absolute after:inset-0 after:rounded-[2px_2px_6px_6px] after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-accent"
            @click="emit('open', row.agent_id)"
          >
            {{ row.name }}
          </button>
        </h3>
        <span class="truncate font-mono text-xs font-medium text-text3">{{ row.agent_id }}</span>
      </div>
      <span
        class="inline-flex size-[26px] flex-none items-center justify-center rounded-md bg-chip text-text2"
        :title="REACH_LABELS[row.reachability ?? ''] ?? 'Reachability unknown'"
      >
        <!-- A plan in progress (Plan an agent) can lack these fields, so they fall back to blank. -->
        <RegistryReachIcon :reach="row.reachability ?? ''" />
      </span>
    </div>

    <div class="flex flex-wrap gap-1">
      <RegistryAttrChip what="type" :value="typeChip" />
      <RegistryAttrChip what="host" :value="row.host ?? ''" />
      <RegistryAttrChip what="inference" :value="row.inference ?? ''" />
    </div>

    <p class="rg-clamp m-0 text-xs leading-[1.45] text-text2">{{ row.description || 'No description filed' }}</p>

    <div class="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-text3">
      <span class="inline-flex items-center gap-1 text-xs text-text3">Deploy <RegistryGradeBadge :grade="row.deploy_state || 'unknown'" size="md" /></span>
      <span>{{ accessText }}</span>
      <span v-if="view.signals.upgradeCards" class="font-medium text-approve">{{ view.signals.upgradeCards }} on board</span>
    </div>

    <p v-if="pausedReason" class="m-0 inline-flex items-center gap-1.5 text-xs text-text2">
      <span aria-hidden="true" class="size-[7px] rounded-full bg-(--ab-neutral-dot)" />Paused · {{ pausedReason }}
    </p>

    <div class="flex flex-wrap items-center gap-1.5 border-t border-line pt-2">
      <RegistryFlagChip v-for="f in shown" :key="f.kind" :flag="f" />
      <span v-if="view.flags.length > 3" class="text-xs font-semibold text-text2">+{{ view.flags.length - 3 }}</span>
      <span class="ml-auto text-xs text-text3">{{ retired ? 'Retired' : row.last_reviewed_at ? `Reviewed ${day(row.last_reviewed_at)}` : 'Never reviewed' }}</span>
    </div>
  </article>
</template>
