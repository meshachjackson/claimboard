<script setup lang="ts">
// "Triage board": runs the rules pass over the board and shows its findings as a plan. Nothing changes until
// The owner checks a line and presses Apply. Close and archive go through the store's single-card writes (moveTask, archive),
// one card at a time, and stop at the first refusal. Fold, rewrite and keep are advice: they have no write path yet.
// "File as card" puts the plan on the board as one card a day (create_task, title "Triage <date>", tag triage) for review.
// The evidence pass (Claude Code) will add findings with source 'evidence' to the same list.
import type { TriageFinding } from '~/types/board'
import { TRIAGE_ACTION_LABELS, TRIAGE_APPLIABLE, TRIAGE_RULE_LABELS } from '~/types/board'
import { existingTriageCard, triageBoard, triageCardFields } from '~/utils/triage'

interface Line {
  finding: TriageFinding
  title: string
  seenAt: string // the card's updated_at when the plan was made; a changed card is not touched
  checked: boolean
  result: '' | 'applied' | 'refused'
  why: string
}

const board = useBoardStore()
const toast = useToast()
const open = ref(false)
// `headless` draws only the dialog; the ⋯ menu (BoardMenu, PhoneMore) runs the triage.
const props = defineProps<{ headless?: boolean }>()
const lines = ref<Line[]>([])
const applying = ref(false)

const appliable = (l: Line) => TRIAGE_APPLIABLE.includes(l.finding.action) && !l.result
const checkedLines = computed(() => lines.value.filter(l => l.checked && appliable(l)))
const canWrite = computed(() => !board.readOnly)

const ruleNames = (l: Line) => l.finding.rules.map(rule => TRIAGE_RULE_LABELS[rule]).join(', ')

function run() {
  const found = triageBoard({ tasks: board.tasks, steps: board.steps, notes: board.notes, registry: board.registry })
  lines.value = found.map((finding) => {
    const task = board.tasks.find(t => t.task_id === finding.task_id)!
    return { finding, title: task.title, seenAt: task.updated_at, checked: false, result: '', why: '' }
  })
  open.value = true
}

/** Applies one line. Returns false (and says why on the line) when the card changed or the board refused. */
async function applyLine(l: Line): Promise<boolean> {
  const task = board.tasks.find(t => t.task_id === l.finding.task_id)
  const refuse = (why: string) => { l.result = 'refused'; l.why = why; return false }
  if (!task) return refuse('The card is gone.')
  if (task.updated_at !== l.seenAt) return refuse('The card changed after the plan was made. Run the triage again.')
  if (task.pinned_at) return refuse('The card is pinned.')
  if (l.finding.action === 'archive') {
    if (!await board.archive(task.task_id)) return refuse(board.lastRefusal?.reason ?? 'Refused.')
  } else {
    await board.moveTask(task.task_id, 'done')
    if (board.stageOf(board.tasks.find(t => t.task_id === task.task_id)!) !== 'done') return refuse(board.lastRefusal?.reason ?? 'Refused.')
  }
  l.result = 'applied'
  return true
}

async function apply() {
  const todo = checkedLines.value
  if (!todo.length || applying.value) return
  applying.value = true
  let n = 0
  for (const l of todo) {
    if (!await applyLine(l)) break
    n += 1
  }
  applying.value = false
  if (n === todo.length) toast.add({ title: `Applied ${n} line${n === 1 ? '' : 's'}`, color: 'neutral' })
  else toast.add({ title: `Applied ${n} of ${todo.length}`, description: 'Stopped at the first refusal. The reason is on its line.', color: 'error' })
}

function checkAll() {
  const all = lines.value.filter(appliable)
  const on = all.some(l => !l.checked)
  all.forEach((l) => { l.checked = on })
}

// "File as card": one triage card a day. A second filing the same day is refused until the first is archived.
const filing = ref(false)
// create_task is a base op the gateway always has, so only the read-only switch gates it (no canUse check).
const canFile = computed(() => canWrite.value && lines.value.length > 0)

async function fileAsCard() {
  if (filing.value || !canFile.value) return
  const fields = triageCardFields(lines.value.map(l => l.finding))
  const dupe = existingTriageCard(board.tasks, fields.title)
  if (dupe) {
    toast.add({ title: `${dupe.task_id} is already today's triage card`, description: 'Archive it first to file a new one.', color: 'error' })
    return
  }
  filing.value = true
  const id = await board.createTask(fields)
  filing.value = false
  if (id) toast.add({ title: `Filed ${id}: ${fields.title}`, color: 'neutral' })
  else toast.add({ title: 'Not filed', description: board.lastRefusal?.reason ?? 'The board refused the card.', color: 'error' })
}
defineExpose({ run })
</script>

<template>
  <button
    v-if="!props.headless && board.loaded"
    type="button"
    aria-label="Triage board"
    title="Triage board: find cards to close, archive or fix"
    class="ab-ghost inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-line px-2.5 text-[13px] font-medium"
    @click="run"
  >
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11l3 3 8-8M20 12v7a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h9" /></svg>
    <span class="ab-narrow-hide">Triage board</span>
  </button>

  <UModal
    v-model:open="open"
    title="Triage board"
    :description="lines.length ? `${lines.length} card${lines.length === 1 ? '' : 's'} flagged by the rules pass. Nothing changes until you check a line and press Apply.` : 'The rules pass flagged nothing.'"
    :ui="{ content: 'sm:max-w-3xl' }"
  >
    <template #body>
      <p v-if="!lines.length" class="m-0 text-sm text-text2">No card broke a rule. Pinned cards are never flagged to close.</p>
      <p v-else-if="!canWrite" class="m-0 mb-3 rounded-lg border border-dashed border-dash bg-filterbar px-3 py-2 text-[13px] text-text2">
        Board writes are off, so lines can be read but not applied.
      </p>
      <ul v-if="lines.length" class="m-0 flex list-none flex-col gap-2 p-0" aria-label="Triage plan">
        <li
          v-for="l in lines"
          :key="l.finding.task_id"
          class="flex gap-3 rounded-lg border border-line bg-surface p-3"
          :class="l.result === 'applied' && 'opacity-60'"
        >
          <input
            type="checkbox"
            v-model="l.checked"
            :aria-label="`Approve ${TRIAGE_ACTION_LABELS[l.finding.action]} for ${l.finding.task_id}`"
            :disabled="!canWrite || !appliable(l) || applying"
            class="mt-1 size-4 flex-none"
          >
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span class="rounded-full bg-chip px-2 py-0.5 text-xs font-semibold" :class="TRIAGE_APPLIABLE.includes(l.finding.action) ? 'text-approve' : 'text-text2'">
                {{ TRIAGE_ACTION_LABELS[l.finding.action] }}
              </span>
              <span class="font-mono text-xs text-text3">{{ l.finding.task_id }}</span>
              <span class="min-w-0 truncate text-[13px] font-medium">{{ l.title }}</span>
            </div>
            <p class="m-0 mt-1 text-[13px] text-text2">{{ l.finding.reason }}</p>
            <p class="m-0 mt-0.5 text-xs text-text3">{{ l.finding.evidence }}</p>
            <p class="m-0 mt-0.5 text-xs text-text3">{{ ruleNames(l) }}</p>
            <p v-if="!TRIAGE_APPLIABLE.includes(l.finding.action)" class="m-0 mt-0.5 text-xs text-text3">Advice only. There is no board action for this yet.</p>
            <p v-if="l.result === 'applied'" role="status" class="m-0 mt-1 text-xs font-semibold text-text2">Applied</p>
            <p v-if="l.result === 'refused'" role="alert" class="m-0 mt-1 text-xs font-semibold text-red-600">{{ l.why }}</p>
          </div>
        </li>
      </ul>
    </template>
    <template #footer>
      <div class="flex w-full items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <button type="button" class="h-11 cursor-pointer rounded-lg px-3 text-sm font-semibold text-text2 hover:bg-chip" @click="run">Run again</button>
          <button
            v-if="canFile"
            type="button"
            title="Put this plan on the board as a card named Triage <date>, tagged triage"
            class="h-11 cursor-pointer rounded-lg px-3 text-sm font-semibold text-text2 hover:bg-chip disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="filing"
            @click="fileAsCard"
          >
            {{ filing ? 'Filing…' : 'File as card' }}
          </button>
        </div>
        <div class="flex items-center gap-2">
          <button v-if="canWrite && lines.some(appliable)" type="button" class="h-11 cursor-pointer rounded-lg px-3 text-sm font-semibold text-text2 hover:bg-chip" :disabled="applying" @click="checkAll">
            Check all close and archive
          </button>
          <button
            type="button"
            :disabled="!checkedLines.length || applying"
            class="h-11 cursor-pointer rounded-lg bg-ink px-[18px] text-sm font-semibold text-surface disabled:cursor-not-allowed disabled:opacity-50"
            @click="apply"
          >
            {{ applying ? 'Applying…' : `Apply ${checkedLines.length} approved` }}
          </button>
        </div>
      </div>
    </template>
  </UModal>
</template>
