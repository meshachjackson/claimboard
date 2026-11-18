<script setup lang="ts">
// The board map: one square per card, one row per stage. Hover or focus a square for the card; hover a legend entry or a
// finding anywhere on the page and the cards it covers light up. The table is the same counts as text: the accessible twin.
import { STAGES, STAGE_LABELS, WORK_STATE_LABELS, WORK_STATE_PILLS, PRIORITY_LABELS } from '~/types/board'
import { COLOR_BY } from '~/utils/reportPaint'
import type { ReportCard } from '~/utils/reportPaint'
import { normalizePriority } from '~/utils/priority'

const hl = useReportHighlight()
const asTable = ref(false)
const root = useTemplateRef<HTMLElement>('root')

const all = computed(() => [...hl.cards.value.values()])
// 600 cards stay one square each; past 1,000 the squares shrink so the map still fits on a screen.
const size = computed(() => all.value.length > 1000 ? 10 : 16)

const rows = computed(() => STAGES.map((stage) => {
  const order = new Map(hl.legend.value.map((l, i) => [l.key, i]))
  const cards = all.value.filter(c => c.stage === stage)
    .sort((a, b) => (order.get(hl.keyOf(a.id)) ?? 99) - (order.get(hl.keyOf(b.id)) ?? 99) || a.id.localeCompare(b.id))
  const lit = hl.active.value ? cards.filter(c => hl.isLit(c.id)).length : cards.length
  return { stage, label: STAGE_LABELS[stage], cards, lit }
}))

const legend = computed(() => hl.legend.value
  .map(l => ({ ...l, ids: all.value.filter(c => hl.keyOf(c.id) === l.key).map(c => c.id) }))
  .filter(l => l.ids.length))

const table = computed(() => legend.value.map((l) => {
  const cells = STAGES.map(s => l.ids.filter(id => hl.cards.value.get(id)!.stage === s).length)
  return { ...l, cells, total: l.ids.length }
}))
const tableHead = computed(() => COLOR_BY.find(m => m.id === hl.colorBy.value)!.label)

const caption = computed(() => {
  const a = hl.active.value
  if (!a) return 'One square per card, by stage. Hover a square for the card, or a finding to light up its cards.'
  return `${a.label ? `${a.label}: ` : 'Showing '}${a.ids.size} of ${all.value.length} cards lit${hl.pin.value && !hl.hover.value ? ' · Click it again or press Esc to clear' : ''}`
})

const aria = (c: ReportCard) => `${c.id}, ${c.title}, ${c.project || 'no project'}, ${WORK_STATE_LABELS[c.state]}`

// ----- tooltip: placed over the square, kept inside the map -----
const tipAt = ref<{ id: string, x: number, y: number } | null>(null)
const tip = computed(() => {
  const c = tipAt.value && hl.card.value === tipAt.value.id ? hl.cards.value.get(tipAt.value.id) : undefined
  if (!c) return null
  const pill = c.state === 'backlog' ? { bg: 'var(--ab-neutral-bg)', fg: 'var(--color-text2)', dot: 'var(--color-dash)' } : WORK_STATE_PILLS[c.state]
  return { c, pill, state: WORK_STATE_LABELS[c.state], prio: PRIORITY_LABELS[normalizePriority(c.priority)] ?? c.priority, color: hl.swatch(c.id).color }
})

function showTip(c: ReportCard, e: Event) {
  hl.card.value = c.id
  const el = e.currentTarget as HTMLElement
  const box = root.value?.getBoundingClientRect()
  if (!box) return
  const r = el.getBoundingClientRect()
  tipAt.value = { id: c.id, x: Math.max(150, Math.min(box.width - 150, r.left - box.left + r.width / 2)), y: r.top - box.top - 8 }
}
const hideTip = () => { hl.card.value = ''; tipAt.value = null }

// ----- opening a card: a touch tap shows the tooltip first, the second tap opens -----
let pointerType = 'mouse'
function onClick(c: ReportCard, e: Event) {
  if (pointerType === 'touch' && hl.card.value !== c.id) return showTip(c, e)
  navigateTo({ path: '/board', query: { task: c.id } })
}

// ----- keyboard: one tab stop per row; arrows move between squares, up and down between rows -----
const focusAt = reactive<Record<string, number>>({})
function onKey(e: KeyboardEvent, stageIndex: number, i: number) {
  const dx = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
  const dy = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
  if (!dx && !dy) return
  e.preventDefault()
  let r = stageIndex
  let n = i + dx
  if (dy) {
    // The next row that has squares; the same column, or its last square.
    do { r += dy } while (rows.value[r] && !rows.value[r]!.cards.length)
    n = i
  }
  const row = rows.value[r]
  if (!row) return
  n = Math.max(0, Math.min(row.cards.length - 1, n))
  root.value?.querySelector<HTMLElement>(`[data-sq="${row.stage}-${n}"]`)?.focus()
}
</script>

<template>
  <section ref="root" aria-labelledby="rp-map-h" class="ab-map relative z-30 rounded-[14px] border border-line bg-(--ab-bar) shadow-[0_12px_28px_rgba(0,0,0,0.25)] max-[559px]:shadow-none min-[560px]:sticky min-[560px]:top-16">
    <div class="flex flex-wrap items-center gap-x-3.5 gap-y-2 px-[18px] pt-3.5 pb-2.5">
      <div class="min-w-0 flex-[1_1_260px]">
        <h2 id="rp-map-h" class="m-0 text-[15px] font-bold">Where the cards are</h2>
        <p class="mt-0.5 mb-0 text-xs text-text3">{{ caption }}</p>
      </div>
      <div role="group" aria-label="Color squares by" class="inline-flex gap-0.5 rounded-lg bg-(--ab-seg-track) p-0.5">
        <button
          v-for="m in COLOR_BY"
          :key="m.id"
          type="button"
          :aria-pressed="hl.colorBy.value === m.id"
          class="h-7 cursor-pointer rounded-md border-0 px-2.5 text-xs font-semibold"
          :class="hl.colorBy.value === m.id ? 'bg-(--ab-seg-on) text-ink' : 'bg-transparent text-text3'"
          @click="hl.colorBy.value = m.id"
        >
          {{ m.label }}
        </button>
      </div>
      <button
        type="button"
        :aria-pressed="asTable"
        title="Show the same counts as a table"
        class="h-8 cursor-pointer rounded-lg border border-line bg-transparent px-2.5 text-xs font-semibold text-text2 hover:bg-(--ab-row-hover)"
        @click="asTable = !asTable"
      >
        {{ asTable ? 'Squares' : 'Table' }}
      </button>
    </div>

    <ul aria-label="Legend" class="m-0 flex list-none flex-wrap gap-x-1 gap-y-0.5 px-3 pb-2">
      <li v-for="l in legend" :key="l.key">
        <button
          type="button"
          :aria-pressed="hl.isPinned(`lg:${l.key}`)"
          class="inline-flex h-[26px] cursor-pointer items-center gap-[7px] rounded-md border-0 px-2 text-xs font-medium text-text2 hover:bg-(--ab-row-hover)"
          :class="hl.isPinned(`lg:${l.key}`) ? 'bg-(--ab-row-hover)' : 'bg-transparent'"
          @pointerenter="hl.enter(`lg:${l.key}`, l.ids, { label: l.label })"
          @pointerleave="hl.leave()"
          @focus="hl.enter(`lg:${l.key}`, l.ids, { label: l.label })"
          @blur="hl.leave()"
          @click="hl.toggle(`lg:${l.key}`, l.ids, { label: l.label })"
        >
          <span aria-hidden="true" class="box-border size-2.5 rounded-[3px]" :style="l.hollow ? { border: `2px solid ${l.color}` } : { background: l.color }" />
          {{ l.label }}
          <span class="font-mono text-xs text-text3">{{ l.ids.length }}</span>
        </button>
      </li>
    </ul>

    <div v-if="!asTable" role="list" aria-label="Cards by stage" class="flex flex-col gap-2 px-[18px] pt-1.5 pb-4">
      <div v-for="(row, ri) in rows" :key="row.stage" role="listitem" class="grid grid-cols-1 items-start gap-1.5 min-[560px]:grid-cols-[168px_minmax(0,1fr)] min-[560px]:gap-3">
        <div class="flex items-baseline justify-between gap-2 pt-px">
          <span class="text-xs font-bold tracking-[0.06em] text-text2 uppercase">{{ row.label }}</span>
          <span class="font-mono text-xs whitespace-nowrap" :class="hl.active.value && row.lit ? 'text-ink' : 'text-text3'">{{ hl.active.value ? `${row.lit} of ${row.cards.length}` : row.cards.length }}</span>
        </div>
        <div class="flex min-h-[18px] flex-wrap items-center gap-0.5">
          <button
            v-for="(c, i) in row.cards"
            :key="c.id"
            type="button"
            :data-sq="`${row.stage}-${i}`"
            :tabindex="Math.min(focusAt[row.stage] ?? 0, row.cards.length - 1) === i ? 0 : -1"
            :aria-label="aria(c)"
            class="ab-sq relative m-0 box-border cursor-pointer rounded p-0"
            :style="{
              width: `${size}px`, height: `${size}px`,
              background: hl.swatch(c.id).hollow ? 'transparent' : hl.swatch(c.id).color,
              border: hl.swatch(c.id).hollow ? `2px solid ${hl.swatch(c.id).color}` : '0',
              opacity: hl.isLit(c.id) ? 1 : 0.16,
              boxShadow: hl.card.value === c.id ? '0 0 0 2px var(--ab-bar), 0 0 0 4px var(--color-ink)' : hl.active.value && hl.isLit(c.id) ? `0 0 0 1.5px ${hl.active.value.accent}` : 'none'
            }"
            @pointerdown="pointerType = $event.pointerType"
            @pointerenter="showTip(c, $event)"
            @pointerleave="hideTip"
            @focus="focusAt[row.stage] = i; showTip(c, $event)"
            @blur="hideTip"
            @keydown="onKey($event, ri, i)"
            @click="onClick(c, $event)"
          />
          <span v-if="!row.cards.length" class="text-xs text-text3">Nothing here</span>
        </div>
      </div>
    </div>

    <div v-else class="overflow-x-auto px-[18px] pt-1 pb-4">
      <table class="w-full border-collapse text-xs">
        <thead>
          <tr>
            <th scope="col" class="border-b border-line px-2 py-1.5 text-left font-semibold text-text3">{{ tableHead }}</th>
            <th v-for="s in STAGES" :key="s" scope="col" class="border-b border-line px-2 py-1.5 text-right font-semibold text-text3">{{ STAGE_LABELS[s] }}</th>
            <th scope="col" class="border-b border-line px-2 py-1.5 text-right font-bold text-ink">All</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in table" :key="r.key">
            <th scope="row" class="border-b border-(--ab-row-hover) px-2 py-1.5 text-left font-medium">
              <span aria-hidden="true" class="mr-2 inline-block box-border size-[9px] rounded-xs" :style="r.hollow ? { border: `2px solid ${r.color}` } : { background: r.color }" />{{ r.label }}
            </th>
            <td v-for="(n, i) in r.cells" :key="i" class="border-b border-(--ab-row-hover) px-2 py-1.5 text-right font-mono text-text2">{{ n || '·' }}</td>
            <td class="border-b border-(--ab-row-hover) px-2 py-1.5 text-right font-mono text-ink">{{ r.total }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div
      v-if="tip && !asTable"
      role="tooltip"
      class="ab-tip pointer-events-none absolute z-50 box-border w-[280px] -translate-x-1/2 -translate-y-full rounded-[10px] border border-(--color-input) bg-surface px-3 py-2.5 shadow-[0_14px_32px_rgba(0,0,0,0.4)]"
      :style="{ left: `${tipAt!.x}px`, top: `${tipAt!.y}px` }"
    >
      <div class="flex items-center gap-1.5 text-xs text-text3">
        <span aria-hidden="true" class="size-2 rounded-xs" :style="{ background: tip.color }" />
        <span class="font-mono text-text2">{{ tip.c.id }}</span>
        <span>·</span>
        <span>{{ tip.c.project || 'No project' }}</span>
      </div>
      <div class="mt-1 text-[13px] leading-[1.35] font-semibold">{{ tip.c.title }}</div>
      <div class="mt-[7px] flex flex-wrap items-center gap-1.5 text-xs text-text2">
        <span class="inline-flex items-center gap-[5px] rounded-full px-[7px] py-px font-semibold" :style="{ background: tip.pill.bg, color: tip.pill.fg }">
          <span aria-hidden="true" class="size-1.5 rounded-full" :style="{ background: tip.pill.dot }" />{{ tip.state }}
        </span>
        <span>{{ tip.c.who }}</span>
        <span aria-hidden="true" class="text-text3">·</span>
        <span class="text-text3">{{ tip.prio }} priority</span>
      </div>
      <div class="mt-[7px] text-xs text-(--ab-blue-link)">Click to open</div>
    </div>
  </section>
</template>

<style scoped>
.ab-sq { transition: opacity 0.16s ease, transform 0.12s ease, box-shadow 0.12s ease; }
.ab-sq:hover, .ab-sq:focus-visible { transform: scale(1.25); z-index: 2; outline: none; }
.ab-tip { animation: ab-tip-in 0.12s ease-out; }
@keyframes ab-tip-in { from { opacity: 0; margin-top: 8px; } to { opacity: 1; margin-top: 0; } }
@media (prefers-reduced-motion: reduce) {
  .ab-sq { transition: none; }
  .ab-sq:hover, .ab-sq:focus-visible { transform: none; }
  .ab-tip { animation: none; }
}
</style>
