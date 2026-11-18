<script setup lang="ts">
// Deployment: the registry's claim beside what n8n shows, the publish timeline, Container checks and
// attributed workflows. Live facts come from the daily drift snapshot and say how old they are.
import type { RegistryRow } from '~/types/registry'
import { HOST_LABELS } from '~/types/registry'
import { containerSummary, day, dayTime } from '~/utils/registry'

const props = defineProps<{ row: RegistryRow, phone?: boolean }>()
const registry = useRegistryStore()
const { composer } = useRegistryUi()

const live = computed(() => registry.deployed?.agents[props.row.agent_id])
const container = computed(() => registry.deployed?.containers[props.row.agent_id])
const asOf = computed(() => dayTime(registry.deployed?.captured_at))
const drift = computed(() => registry.view(props.row.agent_id)?.signals.drift)
const workflows = computed(() => registry.assets.filter(a => a.agent_id === props.row.agent_id && a.asset_type === 'workflow'))
const unreadable = computed(() => registry.deployed?.sources.find(s => s.id === props.row.host && !s.ok))
const nameOf = (id: string) => registry.nameOf(id)

type Match = 'match' | 'drift' | 'blank' | 'unverified' | ''
const rows = computed<{ label: string, registry: string, regMono?: boolean, n8n: string, match: Match }[]>(() => {
  const r = props.row
  const l = live.value
  if (!l) return []
  return [
    { label: 'Version', registry: r.deploy_ref || 'Unknown (blank)', regMono: true, n8n: `${l.active_version} active · ${dayTime(l.versions.find(v => v.active)?.published_at)}`, match: r.deploy_ref === l.active_version ? 'match' : 'drift' },
    { label: 'Expected version', registry: r.expected_version || 'Unknown (blank)', regMono: true, n8n: l.active_version, match: !r.expected_version ? 'blank' : r.expected_version === l.active_version ? 'match' : 'drift' },
    { label: 'Deploy state', registry: r.deploy_state, regMono: true, n8n: 'Published in n8n', match: r.deploy_state === 'verified' ? 'match' : 'unverified' },
    { label: 'Runtime · host', registry: `${r.runtime || '?'} · ${r.host || '?'}`, regMono: true, n8n: `${HOST_LABELS[r.host] ?? 'Unknown'} n8n`, match: 'match' },
    { label: 'Model', registry: 'Not a registry field', n8n: l.model, match: '' },
    { label: 'Tools · skills', registry: 'From access rows', n8n: `${l.tools.length ? l.tools.join(', ') : 'none'} · ${l.skills.length ? l.skills.join(', ') : 'none'}`, match: '' },
    { label: 'Sub-agents · channels', registry: `depends_on: ${r.depends_on || 'Unknown'}`, n8n: `${l.sub_agents.length ? l.sub_agents.map(nameOf).join(', ') : 'none'} · ${l.channels.length ? l.channels.join(', ') : 'no channels'}`, match: '' },
    { label: 'Triggers', registry: r.triggers || 'Unknown', regMono: true, n8n: l.triggers.join(', ') || 'none', match: '' }
  ]
})
const MATCH = {
  match: { label: '✓ Match', style: { background: 'var(--ab-green-bg)', color: 'var(--ab-green-fg)' } },
  drift: { label: '✕ Drift', style: { background: 'var(--color-surface)', color: 'var(--ab-red-text)', border: '1px solid var(--ab-red-line)' } },
  blank: { label: '✕ Blank', style: { background: 'var(--color-surface)', color: 'var(--ab-red-text)', border: '1px solid var(--ab-red-line)' } },
  unverified: { label: 'Not verified', style: { background: 'var(--ab-neutral-bg)', color: 'var(--color-text2)' } }
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <section class="flex flex-col gap-2.5">
      <div class="flex flex-wrap items-baseline gap-2">
        <h3 class="rg-h3 rg-head">Registry claim vs. what n8n shows</h3>
        <span class="text-xs text-text3">Registry: read on refresh · n8n: drift snapshot as of {{ asOf }}</span>
      </div>

      <template v-if="live">
        <div class="overflow-x-auto rounded border border-line">
          <table class="w-full border-collapse text-left text-[13px]">
            <thead class="bg-filterbar text-xs text-text3">
              <tr><th class="px-3 py-2 font-semibold">Field</th><th class="px-2 py-2 font-semibold">Registry says</th><th class="px-2 py-2 font-semibold">n8n shows</th><th class="px-2 py-2 font-semibold">Match</th></tr>
            </thead>
            <tbody>
              <tr v-for="r in rows" :key="r.label" class="border-t border-(--ab-neutral-bg) align-top">
                <td class="px-3 py-2.5 font-semibold text-text2">{{ r.label }}</td>
                <td class="px-2 py-2.5 break-words" :class="[r.regMono && 'font-mono text-xs', r.registry.startsWith('Unknown') && 'text-text3']">{{ r.registry }}</td>
                <td class="px-2 py-2.5 font-mono text-xs break-words">{{ r.n8n }}</td>
                <td class="px-2 py-2.5"><span v-if="r.match" class="rounded-full px-[7px] py-px text-xs font-bold whitespace-nowrap" :style="MATCH[r.match].style">{{ MATCH[r.match].label }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="flex flex-wrap gap-2">
          <button v-if="drift" type="button" class="rg-btn rg-btn-ink" @click="composer = { agentId: row.agent_id, field: 'expected_version', mode: 'field' }">Set expected version to {{ live.active_version }}</button>
          <button type="button" class="rg-btn rg-btn-line" @click="composer = { agentId: row.agent_id, mode: 'behavior' }">Open upgrade card</button>
          <span class="rg-btn cursor-default text-text3" title="R1: form.gov-verify-access with the snapshot as evidence">Verify deployment (R1)</span>
        </div>
      </template>
      <p v-else class="m-0 rounded border border-dashed border-line p-3 text-[13px] text-text2">
        <template v-if="unreadable">Live config unavailable: {{ unreadable.label }} {{ unreadable.note.charAt(0).toLowerCase() + unreadable.note.slice(1) }}.</template>
        <template v-else>Not in the {{ day(registry.deployed?.captured_at) }} snapshot: not a hosted n8n Agent. The registry says deploy_state <span class="font-mono">{{ row.deploy_state }}</span>{{ row.deploy_verified_at ? `, verified ${day(row.deploy_verified_at)}` : '' }}.</template>
      </p>
    </section>

    <section v-if="live" class="flex flex-col gap-2">
      <h3 class="rg-h3 rg-head">Publish timeline</h3>
      <ol class="m-0 flex list-none flex-col p-0">
        <li v-for="v in live.versions" :key="v.version_id" class="flex flex-wrap items-center gap-x-3 gap-y-1 border-l-2 py-1.5 pl-3" :class="v.active ? 'border-(--ab-green-dot)' : 'border-line'">
          <span class="font-mono text-[13px] font-medium">{{ v.version_id }}</span>
          <span v-if="v.active" class="rounded-full bg-(--ab-green-bg) px-[7px] py-px text-xs font-bold text-(--ab-green-fg)">Active</span>
          <span v-if="v.version_id === row.deploy_ref && !v.active" class="rounded-full border border-dashed border-dash px-[7px] py-px text-xs font-semibold text-text2">Registry's deploy_ref</span>
          <span v-if="v.version_id === row.expected_version" class="rounded-full bg-(--ab-neutral-bg) px-[7px] py-px text-xs font-semibold text-text2">Expected</span>
          <span class="text-xs text-text3">{{ v.date_only ? day(v.published_at.slice(0, 10)) : dayTime(v.published_at) }}</span>
        </li>
      </ol>
      <span class="text-xs text-text3">All published by {{ [...new Set(live.versions.map(v => v.by))].join(', ') }} · from n8n publish history</span>
    </section>

    <section class="flex flex-col gap-2">
      <h3 class="rg-h3 rg-head">Loop Container checks</h3>
      <template v-if="container">
        <p class="m-0 text-[13px]"><span class="font-semibold">{{ containerSummary(container) }}</span> <span class="text-text3">· {{ container.container }} · snapshot {{ dayTime(container.captured_at) }}</span></p>
        <p v-if="container.unregistered_flag" class="m-0 text-xs text-text2">The {{ day(registry.deployed?.captured_at) }} snapshot marks this Container "unregistered" though {{ row.agent_id }} exists. Loader check pending.</p>
        <ul class="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
          <li v-for="c in container.checks" :key="c.name" class="flex gap-2">
            <span class="font-semibold" :class="c.pass ? 'text-(--ab-green-fg)' : 'text-(--ab-red-text)'">{{ c.pass ? '✓ Pass' : '✕ Fail' }}</span>{{ c.name }}
          </li>
        </ul>
      </template>
      <p v-else class="m-0 text-[13px] text-text3">No Container checks in the snapshot for {{ row.agent_id }}.</p>
    </section>

    <section class="flex flex-col gap-2">
      <h3 class="rg-h3 rg-head">Attributed workflows</h3>
      <ul v-if="workflows.length" class="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
        <li v-for="w in workflows" :key="w.asset_id" class="flex flex-wrap gap-x-2">
          <span class="font-mono">{{ w.name }}</span>
          <span class="text-text3">· {{ w.role }} · {{ w.status }} · {{ w.environment }}</span>
        </li>
      </ul>
      <p v-else class="m-0 text-[13px] text-text3">No workflows attributed to {{ row.agent_id }} in gov_assets.</p>
    </section>
  </div>
</template>
