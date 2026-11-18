<script setup lang="ts">
// Registry · Agent problems: the computed signals as a queue, grouped by kind, one primary action per item.
import { registrarAgent } from '~/types/board'
import { day, dayTime } from '~/utils/registry'

useHead({ title: 'Agent problems · Registry' })
const registry = useRegistryStore()
const { openAgent, composer } = useRegistryUi()

interface Item { key: string, agentId?: string, title: string, detail: string, action: string, run: () => void, synthetic?: boolean }
interface Group { kind: string, tone: 'red' | 'orange' | 'gray' | 'dashed', items: Item[] }

const groups = computed<Group[]>(() => {
  const v = registry.views
  const dep = registry.deployed
  const unattributed = dep?.unregistered ?? []
  const loader = Object.entries(dep?.containers ?? {}).filter(([, c]) => c.unregistered_flag)
  const sources = (dep?.sources ?? []).filter(s => !s.ok)
  const never = v.filter(x => x.signals.neverReviewed)
  const stale = v.filter(x => x.signals.stale)
  const list: Group[] = [
    { kind: 'Gap', tone: 'red', items: v.filter(x => x.signals.gapItems.length).map(x => ({
      key: `gap-${x.row.agent_id}`, agentId: x.row.agent_id, title: `${x.row.name} is active with ${x.signals.gapItems.join(', ')}`,
      detail: 'Active needs a verified deployment, at least one access row, an owner and a log location (rule 2).',
      action: 'Verify', run: () => openAgent(x.row.agent_id, 'deploy') })) },
    { kind: 'Drift', tone: 'red', items: v.filter(x => x.signals.drift).map(x => ({
      key: `drift-${x.row.agent_id}`, agentId: x.row.agent_id,
      title: `${x.row.name}: live ${x.signals.drift!.live}, registry expects ${x.signals.drift!.expected || 'blank'}`,
      detail: `${/^[0-9a-f]{8}$/.test(x.row.deploy_ref) && x.row.deploy_ref !== x.signals.drift!.expected ? `deploy_ref names ${x.row.deploy_ref}. ` : ''}From the drift snapshot, ${dayTime(dep?.captured_at)}.`,
      action: 'Correct', run: () => { composer.value = { agentId: x.row.agent_id, field: 'expected_version', mode: 'field' } } })) },
    { kind: 'Access not current', tone: 'dashed', items: v.filter(x => x.signals.notCurrent).map((x) => {
      const rows = registry.accessFor(x.row.agent_id).filter(a => a.grade !== 'verified')
      const since = rows.map(a => a.created_at).filter(Boolean).sort()[0]
      return { key: `acc-${x.row.agent_id}`, agentId: x.row.agent_id, title: `${x.row.name}: ${rows.map(a => a.access_id).join(', ')} ${rows.length > 1 ? 'are' : 'is'} ${rows[0]!.grade}${since ? ` since ${day(since)}` : ''}`,
        detail: 'Only verified rows are current access.', action: 'Verify', run: () => openAgent(x.row.agent_id, 'access') }
    }) },
    { kind: 'Unattributed', tone: 'gray', items: unattributed.length ? [{
      key: 'unattributed', title: `${unattributed.length} workflows on the hosted instance outside any registered agent`,
      detail: `Found by ${unattributed[0]!.review_id}, including ${unattributed.filter(u => !u.synthetic).map(u => u.name).join(', ')}. The other names come from the snapshot in R1.`,
      action: 'Register', run: () => navigateTo({ path: '/registry/new', query: { from: unattributed.find(u => !u.synthetic)?.name } }) }] : [] },
    { kind: 'Loader check', tone: 'gray', items: loader.length ? [{
      key: 'loader', agentId: registrarAgent().id, title: `The ${day(dep?.captured_at)} snapshot marks the ${loader.map(([, c]) => c.container.split(' ')[0]).join(' and ')} Containers "unregistered"`,
      detail: `${loader.map(([id]) => id).join(' and ')} exist in the registry, so the drift loader's match is wrong.`,
      action: 'Create upgrade card', run: () => { composer.value = { agentId: registrarAgent().id, mode: 'behavior' } } }] : [] },
    { kind: 'Source health', tone: 'gray', items: sources.map(s => ({
      key: `src-${s.id}`, title: `${s.label} not read`, detail: s.note, action: 'Open review', run: () => navigateTo({ path: '/registry/activity', query: { type: 'drift_check' } }) })) },
    { kind: 'Never reviewed', tone: 'dashed', items: never.length ? [{
      key: 'never', title: `${never.length} of ${v.length} agents have a blank last_reviewed_at`,
      detail: never.map(x => x.row.name).join(', '), action: 'Open review', run: () => navigateTo('/registry/table') }] : [] },
    { kind: 'Stale review', tone: 'dashed', items: stale.map(x => ({
      key: `stale-${x.row.agent_id}`, agentId: x.row.agent_id, title: `${x.row.name} last reviewed ${day(x.row.last_reviewed_at)}`, detail: 'More than 90 days ago (decision 5).', action: 'Open review', run: () => openAgent(x.row.agent_id, 'activity') })) }
  ]
  return list.filter(g => g.items.length)
})

// Gap and drift are stopped-red; everything else is housekeeping, so it stays neutral. Amber is kept for what waits on
// The owner, and that queue is Approvals.
const TONES = {
  red: { lamp: 'border-l-(--ab-red)', tag: 'bg-(--ab-red) text-white' },
  orange: { lamp: 'border-l-(--ab-amber)', tag: 'bg-(--ab-amber) text-(--ab-amber-fg)' },
  gray: { lamp: 'border-l-line', tag: 'bg-(--ab-neutral-bg) text-text2' },
  dashed: { lamp: 'border-l-line', tag: 'border border-dashed border-dash text-text2' }
}
const total = computed(() => groups.value.reduce((n, g) => n + g.items.length, 0))
</script>

<template>
  <RegistryShell v-slot="{ phone }">
    <main class="mx-auto flex w-full max-w-[980px] flex-col gap-8" :class="phone ? 'px-4 pt-4 pb-10' : 'px-6 pt-7 pb-16'">
      <div class="rg-head">
        <div class="flex items-baseline gap-3">
          <h2 class="rg-h2">Agent problems</h2>
          <span class="font-display text-[22px] leading-none font-bold text-text3">{{ total }}</span>
        </div>
        <p class="m-0 mt-1.5 text-sm text-text3">From the registry and the drift snapshot ({{ dayTime(registry.deployed?.captured_at) }}). Each item has one action.</p>
      </div>
      <p v-if="!groups.length" class="m-0 text-[15px] text-text2">No agent problems.</p>
      <section v-for="g in groups" :key="g.kind" :aria-label="g.kind" class="flex flex-col gap-2">
        <div class="flex items-center gap-2.5">
          <span class="rounded-sm px-1.5 py-px text-xs font-semibold" :class="TONES[g.tone].tag">{{ g.kind }}</span>
          <span class="font-display text-lg leading-none font-bold text-text3">{{ g.items.length }}</span>
        </div>
        <ul class="m-0 flex list-none flex-col divide-y divide-line border-l-[5px] bg-surface p-0" :class="TONES[g.tone].lamp">
          <li v-for="it in g.items" :key="it.key" class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5">
            <RegistryRegAvatar v-if="it.agentId && !phone" :id="it.agentId" :size="32" />
            <div class="flex min-w-0 flex-[1_1_320px] flex-col gap-0.5">
              <button v-if="it.agentId" type="button" class="cursor-pointer text-left text-[15px] font-semibold underline-offset-2 hover:underline" @click="openAgent(it.agentId)">{{ it.title }}</button>
              <span v-else class="text-[15px] font-semibold">{{ it.title }}</span>
              <span class="max-w-[72ch] text-sm leading-[1.45] break-words text-text3">{{ it.detail }}</span>
            </div>
            <button type="button" class="rg-btn rg-btn-line" :class="phone && 'h-11'" @click="it.run">{{ it.action }}</button>
          </li>
        </ul>
      </section>
    </main>
  </RegistryShell>
</template>
