<script setup lang="ts">
// Registry · Map: Laptop · Hosted · Catalyst cloud, left to right. Calls only ever point right (the one-way rule),
// so the layout shows it. Access edges come straight from gov_access rows until schema 1.5's `connections` lands.
import type { AgentView } from '~/stores/registry'
import type { Grade } from '~/types/registry'
import { HOST_LABELS } from '~/types/registry'
import { dayTime } from '~/utils/registry'

useHead({ title: `Registry map · ${useAppName()}` })
const registry = useRegistryStore()
const { openAgent } = useRegistryUi()

const layers = reactive({ calls: true, deps: false, access: true })

const LANES = [
  { id: 'laptop', x: 0, w: 440, note: 'Laptop n8n · pulls its work · not reachable from Hosted' },
  { id: 'hosted', x: 464, w: 464, note: 'Hosted n8n, the orchestrator team project · read daily' },
  { id: 'catalyst_cloud', x: 952, w: 440, note: 'Read by pull only' }
]
const NODE_W = 196
const NODE_H = 52
const RES_W = 184
const TOP = 76

const inMap = computed(() => registry.views.filter(v => v.row.lifecycle_status !== 'template' && v.row.lifecycle_status !== 'retired'))
const unknownHost = computed(() => inMap.value.filter(v => !LANES.some(l => l.id === v.row.host)))

interface Node { view: AgentView, x: number, y: number }
interface Res { key: string, label: string, x: number, y: number }

const layout = computed(() => {
  const nodes: Node[] = []
  const res: Res[] = []
  let height = 0
  for (const lane of LANES) {
    const views = inMap.value.filter(v => v.row.host === lane.id)
    views.forEach((view, i) => nodes.push({ view, x: lane.x + 16, y: TOP + i * 68 }))
    const resources = [...new Set(views.flatMap(v => registry.accessFor(v.row.agent_id).map(a => a.resource)))]
    resources.forEach((r, i) => res.push({ key: `${lane.id}:${r}`, label: r, x: lane.x + lane.w - RES_W - 14, y: TOP + 8 + i * 38 }))
    height = Math.max(height, TOP + views.length * 68, TOP + 8 + resources.length * 38)
  }
  return { nodes, res, height: height + 40 }
})

const nodeOf = (id: string) => layout.value.nodes.find(n => n.view.row.agent_id === id)

// Calls: the live config's sub-agents (the orchestrator calls its registrar and advisor).
const calls = computed(() => Object.entries(registry.deployed?.agents ?? {}).flatMap(([from, cfg]) =>
  cfg.sub_agents.map(to => ({ from: nodeOf(from), to: nodeOf(to) })).filter(e => e.from && e.to) as { from: Node, to: Node }[]))

// Dependencies: depends_on text that names another agent by ID or name.
const deps = computed(() => layout.value.nodes.flatMap(n => layout.value.nodes
  .filter(m => m !== n && (n.view.row.depends_on.includes(m.view.row.agent_id) || (m.view.row.name.length > 4 && n.view.row.depends_on.includes(m.view.row.name))))
  .map(m => ({ from: n, to: m }))))

const accessEdges = computed(() => layout.value.nodes.flatMap(n => registry.accessFor(n.view.row.agent_id).map((a) => {
  const lane = LANES.find(l => l.id === n.view.row.host)!
  const r = layout.value.res.find(x => x.key === `${lane.id}:${a.resource}`)!
  return { from: n, to: r, grade: a.grade, id: a.access_id }
})))

const GRADE_LINE: Record<Grade, { stroke: string, dash: string }> = {
  verified: { stroke: 'var(--ab-green-dot)', dash: '' },
  declared: { stroke: 'var(--ab-neutral-dot)', dash: '' },
  proposed: { stroke: 'var(--ab-neutral-dot)', dash: '6 4' },
  unknown: { stroke: 'var(--color-dash)', dash: '2 4' }
}

const curve = (x1: number, y1: number, x2: number, y2: number) => `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`
// Calls within a lane loop out to the right of the node column.
const callPath = (a: Node, b: Node) => {
  const x = a.x + NODE_W
  return `M${x},${a.y + NODE_H / 2} C${x + 48},${a.y + NODE_H / 2} ${x + 48},${b.y + NODE_H / 2} ${x + 4},${b.y + NODE_H / 2}`
}
const unreadable = computed(() => registry.deployed?.sources.find(s => s.id === 'catalyst_cloud' && !s.ok))
// Each lane's line under its title says when its source wasn't read.
const sourceNote = (id: string) => {
  const s = registry.deployed?.sources.find(x => x.id === id)
  return s && !s.ok ? (s.note || 'Not readable') : ''
}
</script>

<template>
  <RegistryShell v-slot="{ phone }">
    <!-- Phone: the map becomes a list grouped by host. -->
    <main v-if="phone" class="flex flex-col gap-4 px-4 pt-3 pb-10">
      <section v-for="lane in [...LANES, { id: '', note: 'Host not filed yet' }]" :key="lane.id" class="flex flex-col gap-2">
        <h2 class="rg-h3 rg-head">{{ HOST_LABELS[lane.id] ?? 'Host unknown' }}</h2>
        <p class="m-0 text-sm text-text3">{{ lane.note }}</p>
        <RegistryAgentCard v-for="v in (lane.id ? inMap.filter(x => x.row.host === lane.id) : unknownHost)" :key="v.row.agent_id" :view="v" phone @open="openAgent" />
      </section>
    </main>

    <template v-else>
      <div class="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 px-6 pt-3">
        <span class="text-sm font-semibold text-text2">Layers</span>
        <button
          v-for="l in ([['calls', 'Calls', 'solid'], ['deps', 'Dependencies', 'dotted'], ['access', 'Access', 'dashed']] as const)"
          :key="l[0]"
          type="button"
          :aria-pressed="layers[l[0]]"
          class="inline-flex h-10 cursor-pointer items-center gap-2 rounded border-2 border-ink px-3 text-sm font-semibold"
          :class="layers[l[0]] ? 'bg-ink text-surface' : 'bg-surface text-ink'"
          @click="layers[l[0]] = !layers[l[0]]"
        >
          <span aria-hidden="true" class="w-[18px] border-t-2" :style="{ borderTopStyle: l[2], borderColor: layers[l[0]] ? 'var(--color-surface)' : 'var(--color-text2)' }" />{{ l[1] }}
        </button>
        <span class="ml-3 inline-flex items-center gap-3 text-sm text-text2">
          Access lines by grade:
          <span class="inline-flex items-center gap-1.5"><span aria-hidden="true" class="w-[22px] border-t-2 border-(--ab-green-dot)" />Verified</span>
          <span class="inline-flex items-center gap-1.5"><span aria-hidden="true" class="w-[22px] border-t-2 border-dashed border-(--ab-neutral-dot)" />Proposed</span>
          <span class="inline-flex items-center gap-1.5"><span aria-hidden="true" class="w-[22px] border-t-2 border-dotted border-dash" />Unknown</span>
        </span>
        <span class="ml-auto text-sm text-text3">Edges from gov_access rows until the connections field lands · {{ dayTime(registry.deployed?.captured_at) }}</span>
      </div>

      <main class="overflow-x-auto px-6 pt-5 pb-10">
        <div class="relative w-[1392px]" :style="{ height: `${layout.height}px` }">
          <section
            v-for="lane in LANES"
            :key="lane.id"
            :aria-label="HOST_LABELS[lane.id]"
            class="absolute top-0 rounded-sm bg-lane px-3.5 py-3"
            :style="{ left: `${lane.x}px`, width: `${lane.w}px`, height: `${layout.height}px` }"
          >
            <h2 class="m-0 font-display text-[22px] leading-none font-bold">{{ HOST_LABELS[lane.id] }}</h2>
            <p class="mt-1 mb-0 text-xs text-text3">{{ lane.note }}</p>
            <p v-if="lane.id === 'laptop' && sourceNote('laptop')" class="mt-0.5 mb-0 text-xs font-semibold text-text2">{{ sourceNote('laptop') }}</p>
          </section>
          <div v-for="x in [440, 928]" :key="x" aria-hidden="true" class="absolute flex w-6 justify-center text-lg text-dash" :style="{ left: `${x}px`, top: `${layout.height / 2}px` }">›</div>
          <div v-if="unreadable" class="absolute right-3.5 z-[2] rounded border border-(--ab-red-line) bg-surface px-2.5 py-1.5 text-xs font-semibold text-(--ab-red-text)" :style="{ top: `${layout.height - 46}px`, left: '966px' }">
            {{ unreadable.note || 'Unreadable' }} · live facts stale
          </div>

          <svg class="pointer-events-none absolute inset-0 z-[1]" :width="1392" :height="layout.height" aria-hidden="true">
            <defs>
              <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" style="fill: var(--color-ink)" /></marker>
            </defs>
            <template v-if="layers.access">
              <path
                v-for="e in accessEdges"
                :key="e.id"
                :d="curve(e.from.x + NODE_W, e.from.y + NODE_H / 2, e.to.x, e.to.y + 14)"
                fill="none"
                stroke-width="1.5"
                :stroke="GRADE_LINE[e.grade].stroke"
                :stroke-dasharray="GRADE_LINE[e.grade].dash"
                opacity="0.8"
              />
            </template>
            <template v-if="layers.deps">
              <path v-for="(e, i) in deps" :key="`d${i}`" :d="callPath(e.from, e.to)" fill="none" style="stroke: var(--color-text2)" stroke-width="1.5" stroke-dasharray="2 3" />
            </template>
            <template v-if="layers.calls">
              <path v-for="(e, i) in calls" :key="`c${i}`" :d="callPath(e.from, e.to)" fill="none" style="stroke: var(--color-ink)" stroke-width="2" marker-end="url(#arrow)" />
            </template>
          </svg>

          <button
            v-for="n in layout.nodes"
            :key="n.view.row.agent_id"
            type="button"
            class="ab-ticket absolute z-[2] flex cursor-pointer items-center gap-2 rounded-[2px_2px_6px_6px] bg-surface px-2.5 text-left hover:-translate-y-px"
            :style="{ left: `${n.x}px`, top: `${n.y}px`, width: `${NODE_W}px`, height: `${NODE_H}px`, border: `1px ${n.view.row.lifecycle_status === 'proposed' ? 'dashed' : 'solid'} ${n.view.flags.some(f => f.kind === 'gap' || f.kind === 'drift') ? 'var(--ab-red-line)' : n.view.row.lifecycle_status === 'proposed' ? 'var(--color-dash)' : 'var(--color-line)'}` }"
            @click="openAgent(n.view.row.agent_id)"
          >
            <RegistryRegAvatar :id="n.view.row.agent_id" :size="28" />
            <span class="flex min-w-0 flex-col">
              <span class="truncate text-[13px] font-semibold">{{ n.view.row.name }}</span>
              <span class="truncate text-xs text-text3">{{ n.view.flags[0]?.label ?? n.view.row.agent_id }}</span>
            </span>
          </button>

          <template v-if="layers.access">
            <span
              v-for="r in layout.res"
              :key="r.key"
              :title="r.label"
              class="absolute z-[2] truncate rounded-md border border-line bg-surface px-2 py-1 font-mono text-xs text-text2"
              :style="{ left: `${r.x}px`, top: `${r.y}px`, width: `${RES_W}px` }"
            >{{ r.label }}</span>
          </template>
        </div>

        <section v-if="unknownHost.length" aria-label="Host unknown" class="mt-5 flex flex-col gap-2 rounded border border-dashed border-dash p-3.5">
          <h2 class="m-0 font-display text-[22px] leading-none font-bold">Host unknown · {{ unknownHost.length }}</h2>
          <p class="m-0 text-xs text-text3">host is blank in the registry, so the Map can't place these. File it through Correct Registry.</p>
          <div class="flex flex-wrap gap-2.5">
            <button
              v-for="v in unknownHost"
              :key="v.row.agent_id"
              type="button"
              class="flex h-[52px] w-[220px] cursor-pointer items-center gap-2 rounded border border-line bg-surface px-2.5 text-left"
              @click="openAgent(v.row.agent_id)"
            >
              <RegistryRegAvatar :id="v.row.agent_id" :size="28" />
              <span class="flex min-w-0 flex-col"><span class="truncate text-[13px] font-semibold">{{ v.row.name }}</span><span class="truncate font-mono text-xs text-text3">{{ v.row.agent_id }}</span></span>
            </button>
          </div>
        </section>
      </main>
    </template>
  </RegistryShell>
</template>
