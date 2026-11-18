<script setup lang="ts">
// Agent detail: header, attention strip, pending requests, actions, then Overview · Access · Deployment · Activity.
// Used by the drawer (Fleet, Table, Map, queues) and by the full page at /registry/agt-<name>.
import type { Lifecycle } from '~/types/registry'
import { FLEET_COLUMNS, HOST_LABELS, LIFECYCLE_LABELS, LIFECYCLE_PILLS, REACH_LABELS } from '~/types/registry'
import { day } from '~/utils/registry'

const props = defineProps<{ agentId: string, tab: string, phone?: boolean, page?: boolean }>()
const emit = defineEmits<{ close: [], tab: [tab: string] }>()
const registry = useRegistryStore()
const { gate, composer } = useRegistryUi()

const view = computed(() => registry.view(props.agentId))
const row = computed(() => view.value?.row)
const s = computed(() => view.value?.signals)

interface StripItem { kind: string, text: string, tone: 'red' | 'orange' | 'gray' | 'dashed', actions: { label: string, run: () => void }[] }

const strip = computed<StripItem[]>(() => {
  const r = row.value
  const sig = s.value
  if (!r || !sig) return []
  const items: StripItem[] = []
  const tab = (t: string) => () => emit('tab', t)
  if (sig.gapItems.length) {
    items.push({ kind: 'Gap', tone: 'red', text: `Active, but ${sig.gapItems.join(', ')}. Active needs a verified deployment, an access row and a log location.`, actions: [
      ...(r.deploy_state !== 'verified' ? [{ label: 'Verify deployment', run: tab('deploy') }] : []),
      ...(!r.log_location ? [{ label: 'Add log location', run: () => { composer.value = { agentId: r.agent_id, field: 'log_location', mode: 'field' } } }] : []),
      { label: 'Request lifecycle change', run: () => { gate.value = { agentId: r.agent_id, to: 'in_development' } } }
    ] })
  }
  if (sig.drift) {
    items.push({ kind: 'Drift', tone: 'red', text: `Live version ${sig.drift.live} is not the expected version (${sig.drift.expected || 'blank'}).${/^[0-9a-f]{8}$/.test(r.deploy_ref) && r.deploy_ref !== sig.drift.live && r.deploy_ref !== sig.drift.expected ? ` The registry's deploy_ref still names ${r.deploy_ref}.` : ''}`, actions: [
      { label: 'Set expected version', run: () => { composer.value = { agentId: r.agent_id, field: 'expected_version', mode: 'field' } } },
      { label: 'Open upgrade card', run: () => { composer.value = { agentId: r.agent_id, mode: 'behavior' } } }
    ] })
  }
  for (const rev of sig.awaiting.filter(x => !registry.isLocal(x.review_id))) {
    items.push({ kind: 'Awaiting you', tone: 'orange', text: `${rev.findings}${rev.synthetic ? ' (synthetic)' : ''} waits for your approval.`, actions: [
      { label: 'Open review', run: () => navigateTo({ path: '/registry/approvals', query: { review: rev.review_id } }) }
    ] })
  }
  if (sig.notCurrent) {
    const since = registry.accessFor(r.agent_id).filter(a => a.grade !== 'verified').map(a => a.created_at).filter(Boolean).sort()[0]
    items.push({ kind: 'Access', tone: 'dashed', text: `${sig.notCurrent} access row${sig.notCurrent > 1 ? 's' : ''} ${since ? `proposed since ${day(since)}` : 'not verified'}, so ${sig.notCurrent > 1 ? 'they are' : 'it is'} not current access.`, actions: [
      { label: 'Verify', run: tab('access') }
    ] })
  }
  const src = registry.deployed?.sources.find(x => x.id === r.host && !x.ok)
  if (sig.noLiveRead && src) {
    items.push({ kind: 'Source', tone: 'gray', text: `${src.label}: ${src.note || 'not readable'} in the latest loader run. Live facts about this agent aren't checked.`, actions: [
      { label: 'Open source health', run: () => navigateTo('/registry/attention') }
    ] })
  }
  if (sig.unknownFacts.length) {
    items.push({ kind: 'Unknown', tone: 'dashed', text: `${sig.unknownFacts.length} fields graded unknown: ${sig.unknownFacts.slice(0, 4).join(', ')}${sig.unknownFacts.length > 4 ? '…' : ''}.`, actions: [
      { label: 'Correct', run: tab('overview') }
    ] })
  }
  return items
})

// Each strip row has a lamp on its left edge, as in the ticket drawer's Next move band: stop red for a gap or drift, amber
// only for what waits on the owner, a hairline for the rest. The tag beside it names the kind.
const TONES = {
  red: { lamp: 'border-l-(--ab-red)', tag: 'bg-(--ab-red) text-white' },
  orange: { lamp: 'border-l-(--ab-amber)', tag: 'bg-(--ab-amber) text-(--ab-amber-fg)' },
  gray: { lamp: 'border-l-line', tag: 'bg-(--ab-neutral-bg) text-text2' },
  dashed: { lamp: 'border-l-dash', tag: 'border border-dashed border-dash text-text2' }
}

const typeChip = computed(() => row.value?.agent_type ? `${row.value.agent_type}${row.value.type_version ? ` v${row.value.type_version}` : ''}` : '')
const moveOptions = computed(() => FLEET_COLUMNS.filter(c => c.id !== row.value?.lifecycle_status))

function moveTo(e: Event) {
  const to = (e.target as HTMLSelectElement).value as Lifecycle
  ;(e.target as HTMLSelectElement).value = ''
  if (to && row.value) gate.value = { agentId: row.value.agent_id, to }
}

const tabs = [['overview', 'Overview'], ['access', 'Access'], ['deploy', 'Deployment'], ['activity', 'Activity']] as const
</script>

<template>
  <div v-if="row && view && s" class="rg-sheet flex h-full min-h-0 flex-col bg-surface">
    <div class="flex items-center gap-2.5 border-b-2 border-rule py-2 pr-3 pl-5">
      <span class="font-mono text-[13px] font-medium text-text2">{{ row.agent_id }}</span>
      <span aria-hidden="true" class="text-dash">/</span>
      <span class="text-[13px] text-text3">{{ LIFECYCLE_LABELS[row.lifecycle_status] }}</span>
      <NuxtLink v-if="!page" :to="`/registry/${row.agent_id}?tab=${tab}`" class="rg-link ml-auto inline-flex min-h-10 items-center text-sm max-sm:min-h-11">Open full page</NuxtLink>
      <NuxtLink v-else to="/registry" class="rg-link ml-auto inline-flex min-h-10 items-center text-sm">Back to Fleet</NuxtLink>
      <button v-if="!page" type="button" aria-label="Close" class="inline-flex size-10 cursor-pointer items-center justify-center rounded text-text2 hover:bg-(--ab-row-hover) max-sm:size-11" @click="emit('close')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </div>

    <div class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto *:shrink-0" :class="phone ? 'p-4' : 'p-6'">
      <div class="flex items-start gap-3.5">
        <RegistryRegAvatar :id="row.agent_id" :size="48" />
        <div class="flex min-w-0 flex-1 flex-col gap-2">
          <h2 class="m-0 font-display leading-[1.08] font-bold" :class="phone ? 'text-[26px]' : 'text-[30px]'">{{ row.name }}</h2>
          <div class="flex flex-wrap items-center gap-2">
            <StatusPill :pill="LIFECYCLE_PILLS[row.lifecycle_status]" />
            <span class="inline-flex items-center gap-1 text-sm text-text3">Deploy <RegistryGradeBadge :grade="row.deploy_state || 'unknown'" size="md" /></span>
            <span class="text-sm text-text3">Owner {{ row.owner || 'Unknown' }}</span>
          </div>
          <div class="flex flex-wrap gap-1">
            <RegistryAttrChip what="type" :value="typeChip" />
            <RegistryAttrChip what="host" :value="HOST_LABELS[row.host] ?? ''" />
            <RegistryAttrChip what="inference" :value="row.inference" />
            <RegistryAttrChip what="reachability" :value="REACH_LABELS[row.reachability] ?? ''" />
          </div>
        </div>
      </div>

      <div v-if="strip.length || view.requested.length" role="list" aria-label="Agent problems" class="flex flex-col gap-px bg-line">
        <div v-for="(it, i) in strip" :key="i" role="listitem" class="flex flex-col gap-1.5 border-l-[5px] bg-ground px-4 py-3" :class="TONES[it.tone].lamp">
          <div class="flex items-start gap-2.5">
            <span class="mt-px flex-none rounded-sm px-1.5 py-px text-xs font-semibold" :class="TONES[it.tone].tag">{{ it.kind }}</span>
            <span class="rg-clamp min-w-0 text-sm leading-[1.45]" :title="it.text">{{ it.text }}</span>
          </div>
          <div class="flex flex-wrap gap-x-4">
            <button v-for="a in it.actions" :key="a.label" type="button" class="rg-link min-h-8 text-sm max-sm:min-h-11" @click="a.run">{{ a.label }}</button>
          </div>
        </div>
        <div v-for="rev in view.requested" :key="rev.review_id" role="listitem" class="flex flex-col gap-1.5 border-l-[5px] border-l-(--ab-amber) bg-ground px-4 py-3">
          <div class="flex items-start gap-2.5">
            <span class="mt-px flex-none rounded-sm bg-(--ab-amber) px-1.5 py-px text-xs font-semibold text-(--ab-amber-fg)">Change requested</span>
            <span class="rg-clamp min-w-0 text-sm leading-[1.45]">{{ rev.findings }} · <span class="font-mono">{{ rev.review_id }}</span> awaiting your approval</span>
          </div>
          <NuxtLink :to="{ path: '/registry/approvals', query: { review: rev.review_id } }" class="rg-link min-h-8 self-start text-sm leading-8">Open review</NuxtLink>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-2.5">
        <label class="flex items-center gap-2 text-sm font-semibold text-text2">
          Request lifecycle change
          <select class="ab-select font-normal" :class="phone && 'h-11'" @change="moveTo">
            <option value="">Move to…</option>
            <option v-for="c in moveOptions" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </label>
        <button type="button" class="rg-btn rg-btn-line" :class="phone && 'h-11'" @click="composer = { agentId: row.agent_id, field: 'description', mode: 'field' }">Request change</button>
        <span class="inline-flex h-10 items-center px-1 text-sm text-text3" title="Link only. Fixtures carry no n8n URL; R1 reads it from the snapshot.">Open in n8n (no link yet)</span>
      </div>

      <div role="tablist" aria-label="Agent sections" class="flex gap-5 border-b-2 border-rule" :class="phone && 'ab-row overflow-x-auto'">
        <button
          v-for="t in tabs"
          :key="t[0]"
          type="button"
          role="tab"
          :aria-selected="tab === t[0]"
          class="h-11 flex-none cursor-pointer text-[15px]"
          :class="tab === t[0] ? 'font-semibold text-ink shadow-[inset_0_-4px_0_var(--color-ink)]' : 'font-medium text-text3 hover:text-ink'"
          @click="emit('tab', t[0])"
        >
          {{ t[1] }}
        </button>
      </div>

      <RegistryAgentOverview v-if="tab === 'overview'" :row="row" :phone="phone" />
      <RegistryAgentAccess v-else-if="tab === 'access'" :row="row" :phone="phone" />
      <RegistryAgentDeploy v-else-if="tab === 'deploy'" :row="row" :phone="phone" />
      <RegistryAgentActivity v-else :row="row" />
    </div>
  </div>
  <div v-else class="p-6 text-sm text-text3">No agent {{ agentId }} in the registry.</div>
</template>
