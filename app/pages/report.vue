<script setup lang="ts">
// The visual board report (docs/design/report/README.md). One square is one card: the map shows every card by stage, and
// anything you hover on the page lights its cards there. /report shows the briefing tools plus progress;
// /report?tools=overdue,breakdown:priority shows whichever tools the URL names (the board_report agent op hands back
// this link), so no report needs code. The chips below the title write that same ?tools= list.
import { REPORT_TOOL_LOOKS } from '~/types/board'
import type { GovTask } from '~/types/board'
import { buildReport, parseTools, REPORT_PAGE_TOOLS, REPORT_TOOL_NAMES } from '~/utils/report'
import type { ReportCard } from '~/utils/reportPaint'

const board = useBoardStore()
const route = useRoute()
const router = useRouter()
const toast = useToast()

// ?tools= absent means the page default; present but empty means the reader removed every chip.
const spec = computed(() => route.query.tools === undefined ? [...REPORT_PAGE_TOOLS].join(',') : String(route.query.tools))
// The board's own derived stage rides along on each row, so the report agrees with the columns. The page shows every row
// (no list caps): the sections cut long lists themselves with "Show N more".
const rows = computed<GovTask[]>(() => board.cards.map(c => ({ ...c.task, stage: c.stage })))
const report = computed(() => buildReport({ tasks: rows.value }, spec.value, { limit: Infinity }))

const live = computed(() => board.cards.filter(c => !c.archived))
const cards = computed(() => new Map<string, ReportCard>(live.value.map(c => [c.task.task_id, {
  id: c.task.task_id, title: c.task.title, project: c.task.project_id, stage: c.stage, state: c.workState,
  who: board.nameOf(c.task.assignee || c.task.proposed_assignee), priority: c.task.priority, created: c.task.created_at
}])))
const hl = provideReportHighlight(cards)
const openCount = computed(() => live.value.filter(c => c.stage !== 'done' && c.workState !== 'done').length)

const today = computed(() => {
  const d = new Date(report.value.as_of)
  return `${d.toLocaleDateString('en-US', { weekday: 'long' })}, ${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`
})

// ----- tool chips: on the page, each with ×, then dashed "+" chips for the rest -----
const CATALOG = ['orphans', 'batchable', 'almost_done', 'behind', 'progress', 'overdue', 'breakdown:priority', 'breakdown:assignee', 'breakdown:work_state']
const BREAKDOWN_WORDS: Record<string, string> = { work_state: 'state', project_id: 'project', task_type: 'type' }
function chip(name: string, arg = '') {
  const look = REPORT_TOOL_LOOKS[name]!
  return { spec: arg ? `${name}:${arg}` : name, accent: look.accent, label: name === 'breakdown' ? `By ${BREAKDOWN_WORDS[arg || 'work_state'] ?? arg}` : look.label }
}
const active = computed(() => parseTools(spec.value).tools.map(t => chip(t.name, t.arg)))
const inactive = computed(() => CATALOG.filter(c => !active.value.some(a => a.spec === c)).map((c) => {
  const [name = '', arg = ''] = c.split(':')
  return chip(name, arg)
}))

function setTools(list: string[]) {
  hl.clear()
  router.replace({ query: { ...route.query, tools: list.join(',') } })
}
const remove = (s: string) => setTools(active.value.map(a => a.spec).filter(x => x !== s))
const add = (s: string) => setTools([...active.value.map(a => a.spec), s])

async function copyLink() {
  const url = `${location.origin}/report?tools=${encodeURIComponent(active.value.map(a => a.spec).join(','))}`
  try {
    await navigator.clipboard.writeText(url)
    toast.add({ title: 'Report link copied', description: url })
  } catch {
    toast.add({ title: 'Could not copy the link', description: url })
  }
}

// ----- clearing a pin: Esc, or a click on empty page -----
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') hl.clear()
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
function onPageClick(e: MouseEvent) {
  if (hl.pin.value && !(e.target as HTMLElement).closest('button, a, section, [tabindex]')) hl.clear()
}
</script>

<template>
  <div class="flex min-h-dvh flex-col">
    <header class="sticky top-0 z-40 flex min-h-14 items-stretch gap-6 border-b-2 border-rule bg-ground px-5">
      <PageTitle class="self-center" />
      <PageTabs :tabs="[{ to: '/shipped', label: 'Log' }, { to: '/report', label: 'Report' }]" />
    </header>
    <main class="mx-auto flex w-full max-w-[1200px] flex-col gap-4 px-6 pt-6 pb-[72px]" @click="onPageClick">
      <LoadBanner />

      <div class="flex flex-wrap items-end gap-x-4 gap-y-2">
        <div class="flex-[1_1_320px]">
          <h2 class="m-0 font-display text-[34px] leading-none font-bold">Board report</h2>
          <p class="mt-1 mb-0 text-[13px] text-text3">{{ today }} · {{ live.length }} cards, {{ openCount }} open · Hover anything to see where its cards are</p>
        </div>
        <button type="button" class="inline-flex h-8 cursor-pointer items-center gap-[7px] rounded-lg border border-line bg-transparent px-[11px] text-[13px] font-semibold text-ink hover:bg-(--ab-row-hover)" @click="copyLink">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" /></svg>
          Copy link
        </button>
      </div>

      <div role="group" aria-label="Report tools" class="flex flex-wrap items-center gap-1.5 max-[559px]:-mx-6 max-[559px]:flex-nowrap max-[559px]:overflow-x-auto max-[559px]:px-6 max-[559px]:pb-0.5 max-[559px]:*:flex-none">
        <span class="mr-0.5 text-xs text-text3">Showing</span>
        <span v-for="c in active" :key="c.spec" class="inline-flex h-7 items-center gap-1.5 rounded-full border border-(--color-input) bg-surface pr-[3px] pl-2.5 text-xs font-semibold">
          <span aria-hidden="true" class="size-[7px] rounded-xs" :style="{ background: c.accent }" />
          {{ c.label }}
          <button type="button" :aria-label="`Remove ${c.label}`" class="inline-flex size-[22px] cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-text3 hover:bg-(--ab-row-hover)" @click="remove(c.spec)">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </span>
        <button v-for="c in inactive" :key="c.spec" type="button" class="inline-flex h-7 cursor-pointer items-center gap-[5px] rounded-full border border-dashed border-(--color-input) bg-transparent px-2.5 text-xs font-medium text-text3 hover:bg-surface" @click="add(c.spec)">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          {{ c.label }}
        </button>
      </div>

      <p v-if="report.unknown.length" class="m-0 text-[13px] text-(--ab-red-text)">
        Unknown tool: {{ report.unknown.join(', ') }}. Available: {{ REPORT_TOOL_NAMES.join(', ') }}.
      </p>

      <ReportTiles :report="report" />
      <ReportMap />
      <BoardReport :report="report" />
    </main>
  </div>
</template>
