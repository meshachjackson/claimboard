<script setup lang="ts">
// Activity: one timeline of review events and field changes, newest first, plus the board cards this agent holds.
import type { RegistryRow } from '~/types/registry'
import { EVENT_LABELS, STATUS_LABELS } from '~/types/registry'
import { dayTime } from '~/utils/registry'

const props = defineProps<{ row: RegistryRow }>()
const registry = useRegistryStore()

const events = computed(() => [
  ...registry.reviewsFor(props.row.agent_id).map(r => ({
    when: r.created_at, id: r.review_id, kind: EVENT_LABELS[r.event_type] ?? r.event_type, text: r.findings, status: STATUS_LABELS[r.status] ?? r.status, synthetic: r.synthetic
  })),
  ...registry.historyFor(props.row.agent_id).map(h => ({
    when: h.changed_at, id: h.history_id, kind: 'Field change', text: h.field === '*' ? `${h.row_key}: ${h.new_value}` : `${h.row_key} ${h.field}: "${h.old_value || 'blank'}" → "${h.new_value || 'blank'}"`, status: h.review_id, synthetic: h.synthetic
  })),
  ...(registry.deployed?.agents[props.row.agent_id]?.versions ?? []).map(v => ({
    when: v.published_at, id: v.version_id, kind: 'Published', text: `Published in n8n by ${v.by}${v.active ? ' (active)' : ''}`, status: '', synthetic: false
  }))
].sort((a, b) => (b.when || '').localeCompare(a.when || '')))

const cards = computed(() => registry.cards.filter(c => c.upgrade_target === props.row.agent_id))
</script>

<template>
  <div class="flex flex-col gap-4">
    <section v-if="cards.length" class="flex flex-col gap-2">
      <h3 class="rg-h3 rg-head">Board cards</h3>
      <ul class="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px]">
        <li v-for="c in cards" :key="c.task_id" class="flex flex-wrap items-center gap-2">
          <span class="font-mono font-medium">{{ c.task_id }}</span>
          <span class="rounded bg-(--ab-blue-bg) px-1.5 py-px text-xs font-semibold text-approve">{{ c.task_type === 'upgrade' ? 'Upgrade' : 'Build' }} · Backlog</span>
          <span>{{ c.title }}</span>
          <span class="text-xs text-text3">· waits for approval and a manual start · local prototype card</span>
        </li>
      </ul>
    </section>
    <ol v-if="events.length" class="m-0 flex list-none flex-col gap-3 p-0">
      <li v-for="e in events" :key="e.id" class="grid grid-cols-[150px_minmax(0,1fr)] gap-x-2.5 text-[13px] max-sm:grid-cols-1">
        <span class="text-xs text-text3">{{ dayTime(e.when) || 'Undated' }}</span>
        <span class="flex flex-col gap-0.5">
          <span class="flex flex-wrap items-center gap-1.5">
            <span class="text-xs font-semibold text-text2">{{ e.kind }}</span>
            <span class="font-mono text-xs text-text2">{{ e.id }}</span>
            <span v-if="e.status" class="text-xs text-text3">· {{ e.status }}</span>
            <span v-if="e.synthetic" class="rounded border border-dashed border-dash px-1 text-xs text-text3">synthetic</span>
          </span>
          <span class="break-words">{{ e.text }}</span>
        </span>
      </li>
    </ol>
    <p v-else class="m-0 text-[13px] text-text3">No review events or field changes in the fixtures for {{ row.agent_id }}.</p>
    <p class="m-0 text-xs text-text3">{{ row.last_reviewed_at ? `Last reviewed ${dayTime(row.last_reviewed_at)} by ${row.last_reviewed_by || 'Unknown'}` : 'Never reviewed' }}</p>
  </div>
</template>
