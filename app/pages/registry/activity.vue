<script setup lang="ts">
// Registry · Activity: every review event and field change, newest first. Filters: agent, event type, severity, dates.
import { EVENT_LABELS, SEVERITY_STYLES, STATUS_LABELS } from '~/types/registry'
import { dayTime } from '~/utils/registry'

useHead({ title: 'Activity · Registry' })
const registry = useRegistryStore()
const route = useRoute()
const router = useRouter()
const { openAgent } = useRegistryUi()

const q = (k: string) => (typeof route.query[k] === 'string' ? route.query[k] as string : '')
function set(k: string, v: string) {
  const next = { ...(route.query as Record<string, string>) }
  if (v) next[k] = v
  else delete next[k]
  router.replace({ query: next })
}

interface Event { when: string, id: string, kind: string, agentId: string, severity: string, text: string, status: string, synthetic?: boolean }
const all = computed<Event[]>(() => [
  ...registry.reviews.map(r => ({ when: r.created_at, id: r.review_id, kind: r.event_type, agentId: r.agent_id, severity: r.severity, text: r.findings, status: STATUS_LABELS[r.status] ?? r.status, synthetic: r.synthetic })),
  ...registry.history.map((h) => {
    const access = registry.access.find(a => a.access_id === h.row_key)
    return { when: h.changed_at, id: h.history_id, kind: 'field_change', agentId: h.table_name === 'gov_registry' ? h.row_key : access?.agent_id ?? '', severity: '',
      text: h.field === '*' ? `${h.row_key}: ${h.new_value}` : `${h.row_key} ${h.field}: "${h.old_value || 'blank'}" → "${h.new_value || 'blank'}"`, status: h.review_id, synthetic: h.synthetic }
  })
].sort((a, b) => (b.when || '').localeCompare(a.when || '')))

const kinds = computed(() => [...new Set(all.value.map(e => e.kind))].sort())
const agents = computed(() => [...new Set(all.value.map(e => e.agentId).filter(Boolean))].sort())
const shown = computed(() => all.value.filter(e =>
  (!q('agent') || e.agentId === q('agent'))
  && (!q('type') || e.kind === q('type'))
  && (!q('severity') || e.severity === q('severity'))
  && (!q('from') || (e.when || '') >= q('from'))
  && (!q('to') || (e.when || '').slice(0, 10) <= q('to'))))
// Some findings run to a page. Each row shows three lines until it is opened.
const open = ref(new Set<string>())
function toggle(id: string) {
  const next = new Set(open.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  open.value = next
}
const long = (text: string) => text.length > 280
const kindLabel = (k: string) => k === 'field_change' ? 'Field change' : EVENT_LABELS[k] ?? k
</script>

<template>
  <RegistryShell v-slot="{ phone }">
    <main class="mx-auto flex w-full max-w-[1080px] flex-col gap-4" :class="phone ? 'px-4 pt-4 pb-10' : 'px-6 pt-7 pb-16'">
      <div class="rg-head flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 class="rg-h2">Activity</h2>
        <span class="font-display text-[22px] leading-none font-bold text-text3">{{ shown.length }}</span>
        <span class="text-sm text-text3">of {{ all.length }} events · every review and field change, newest first</span>
      </div>

      <!-- Filters live in the URL, so a filtered view can be linked. -->
      <div class="grid gap-3" :class="phone ? 'grid-cols-2' : 'grid-cols-[repeat(3,minmax(0,1fr))_repeat(2,minmax(0,0.8fr))]'">
        <label class="flex flex-col gap-1.5 text-sm font-semibold text-text2" :class="phone && 'col-span-2'">Agent
          <select class="ab-select font-normal" :value="q('agent')" @change="set('agent', ($event.target as HTMLSelectElement).value)">
            <option value="">All agents</option><option v-for="a in agents" :key="a" :value="a">{{ registry.nameOf(a) }}</option>
          </select>
        </label>
        <label class="flex flex-col gap-1.5 text-sm font-semibold text-text2">Event type
          <select class="ab-select font-normal" :value="q('type')" @change="set('type', ($event.target as HTMLSelectElement).value)">
            <option value="">All types</option><option v-for="k in kinds" :key="k" :value="k">{{ kindLabel(k) }}</option>
          </select>
        </label>
        <label class="flex flex-col gap-1.5 text-sm font-semibold text-text2">Severity
          <select class="ab-select font-normal" :value="q('severity')" @change="set('severity', ($event.target as HTMLSelectElement).value)">
            <option value="">Any</option><option v-for="(s, k) in SEVERITY_STYLES" :key="k" :value="k">{{ s.label }}</option>
          </select>
        </label>
        <label class="flex flex-col gap-1.5 text-sm font-semibold text-text2">From
          <input type="date" class="ab-select font-normal" :value="q('from')" @change="set('from', ($event.target as HTMLInputElement).value)">
        </label>
        <label class="flex flex-col gap-1.5 text-sm font-semibold text-text2">To
          <input type="date" class="ab-select font-normal" :value="q('to')" @change="set('to', ($event.target as HTMLInputElement).value)">
        </label>
      </div>

      <ol class="m-0 flex list-none flex-col divide-y divide-line bg-surface p-0">
        <li v-for="e in shown" :key="e.id" class="grid gap-x-4 gap-y-1 px-4 py-3" :class="phone ? 'grid-cols-1' : 'grid-cols-[150px_minmax(0,1fr)]'">
          <span class="text-sm text-text3">{{ dayTime(e.when) || 'Undated' }}</span>
          <span class="flex min-w-0 flex-col gap-1">
            <span class="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span class="rounded-sm bg-(--ab-neutral-bg) px-1.5 py-px text-xs font-semibold text-text2">{{ kindLabel(e.kind) }}</span>
              <span v-if="e.severity && SEVERITY_STYLES[e.severity]" class="rounded-sm px-1.5 py-px text-xs font-semibold" :style="{ background: SEVERITY_STYLES[e.severity]!.bg, color: SEVERITY_STYLES[e.severity]!.fg, border: SEVERITY_STYLES[e.severity]!.border }">{{ SEVERITY_STYLES[e.severity]!.label }}</span>
              <button v-if="e.agentId && registry.agent(e.agentId)" type="button" class="rg-link text-sm" @click="openAgent(e.agentId, 'activity')">{{ registry.nameOf(e.agentId) }}</button>
              <span class="font-mono text-xs text-text3">{{ e.id }}</span>
              <span v-if="e.status" class="text-xs text-text3">· {{ e.status }}</span>
              <span v-if="e.synthetic" class="rounded-sm border border-dashed border-dash px-1 text-xs text-text3">synthetic</span>
            </span>
            <span class="max-w-[80ch] text-sm leading-[1.45] break-words" :class="long(e.text) && !open.has(e.id) && 'line-clamp-3'">{{ e.text }}</span>
            <button v-if="long(e.text)" type="button" class="rg-link self-start text-sm" :aria-expanded="open.has(e.id)" @click="toggle(e.id)">{{ open.has(e.id) ? 'Show less' : 'Show all' }}</button>
          </span>
        </li>
      </ol>
      <p v-if="!shown.length" class="m-0 py-6 text-center text-sm text-text3">No events match.</p>
    </main>
  </RegistryShell>
</template>
