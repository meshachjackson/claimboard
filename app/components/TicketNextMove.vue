<script setup lang="ts">
// The ticket's "next move" band (direction B): what is going on, who has to act, and the buttons for it, in one place.
// It replaces the old explain box and the separate Start, Approve, Send back and Archive boxes. The left rule is the
// lamp: amber when the move is the owner's, red when the card stopped, cobalt while an agent has it, a hairline otherwise.
import type { CardView } from '~/stores/board'
import { MOVE_SIGNALS } from '~/types/board'
import { formatDate } from '~/utils/format'
import { lastSeen, presence } from '~/utils/availability'
import { startLabel, whoseMove } from '~/utils/whoseMove'

const props = defineProps<{ card: CardView, phone?: boolean }>()
const emit = defineEmits<{ close: [] }>()
const board = useBoardStore()

const task = computed(() => props.card.task)
const mover = computed(() => whoseMove(props.card).mover)
const stopped = computed(() => props.card.workState === 'blocked')
const lamp = computed(() => stopped.value ? 'var(--ab-red)' : mover.value === 'you' ? 'var(--ab-amber)' : mover.value === 'agent' ? 'var(--color-accent)' : 'var(--color-line)')
// The tag beside the headline uses the Floor's Needs you signals, so a card reads the same in both places.
const signal = computed(() => {
  if (props.card.approvalPending || board.canApprove(task.value)) return MOVE_SIGNALS.approve
  if (props.card.stranded) return MOVE_SIGNALS.stranded
  if (mover.value !== 'you') return null
  return MOVE_SIGNALS[props.card.workState] ?? MOVE_SIGNALS.unheld
})

// Start (Backlog) and Restart (Build, nothing running) run the card (utils/whoseMove.ts); Send back returns a Review card to Build.
// While the card waits on approval, Approve is the move; Start would only queue work that can't begin.
// Hidden when the host hasn't turned start_task on, so the button never ends in "Start refused".
const start = computed(() => board.readOnly || !board.canUse('start_task') || board.canApprove(task.value) ? '' : startLabel(props.card))
const canStart = computed(() => !!start.value)
const canReview = computed(() => props.card.stage === 'review' && !board.readOnly && board.canUse('send_back') && !props.card.archived)
const canArchive = computed(() => task.value.work_state === 'done' && !props.card.archived && board.canUse('archive_task'))

// The explain rules stay quiet on some cards (done, archived, an approval the buttons already cover); say it plainly.
const headline = computed(() => props.card.explain?.headline
  || (props.card.archived ? 'Archived' : props.card.workState === 'done' ? 'Done'
    : board.canApprove(task.value) ? 'Waiting for your approval' : props.card.stage === 'backlog' ? 'Not started' : ''))
const show = computed(() => !!headline.value || !!props.card.stranded || canStart.value || canReview.value || canArchive.value || board.readOnly || asking.value || !!noAnswer.value)

// An open message to an agent with no answer yet: say so, and when the agent was last seen (heartbeats, claims, acks and
// notes already in the store; nothing is invented). "No activity yet" is dropped, since it is not a last-seen time.
const noAnswer = computed(() => {
  const chat = props.card.chat
  if (!chat || chat.acked_at) return ''
  const seen = presence(lastSeen(chat.assignee, board.steps, board.notes))
  return `No answer yet from ${board.nameOf(chat.assignee)}${seen.text.startsWith('no activity') ? '' : ` · ${seen.text}`}`
})
// A Needs-you card with an open question note shows the question and the reply box first (TicketQuestion).
const asking = computed(() => props.card.workState === 'needs_input' && board.notesFor(task.value.task_id).some(n => n.kind === 'question'))

const ask = useAskManager()

const sendBackText = ref('')
async function sendBack() {
  const body = sendBackText.value.trim()
  if (!body) return
  // Cleared at once; put back if the server refuses and nothing new was typed.
  sendBackText.value = ''
  if (!await board.sendBack(task.value.task_id, body) && !sendBackText.value) sendBackText.value = body
}
watch(() => task.value.task_id, () => { sendBackText.value = '' })

async function archive() {
  if (!confirm(`Archive ${task.value.task_id}? It leaves the board; its rows stay in the tables.`)) return
  // The card leaves the board at once; a refusal brings it back with a message.
  void board.archive(task.value.task_id)
  emit('close')
}

const primary = 'h-10 cursor-pointer rounded bg-ink px-3.5 text-sm font-semibold text-surface disabled:cursor-not-allowed disabled:opacity-50'
const secondary = 'h-10 cursor-pointer rounded border-2 border-ink px-3.5 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-50'
</script>

<template>
  <!-- Full bleed: the negative margins cancel the drawer body's padding. -->
  <section v-if="show" aria-label="Next move" class="flex flex-col gap-3 bg-ground py-3.5 pr-4 pl-4" :class="phone ? '-mx-4' : '-mx-5'" :style="{ boxShadow: `inset 5px 0 0 ${lamp}` }">
    <div class="flex flex-col gap-1.5 pl-1.5">
      <div class="flex flex-wrap items-center gap-2">
        <span v-if="signal" class="rounded-sm px-2 py-px text-[13px] font-semibold" :style="{ background: signal.bg, color: signal.fg }">{{ signal.label }}</span>
        <h3 v-if="headline" class="m-0 text-[15px] font-semibold text-ink">{{ headline }}</h3>
      </div>
      <!-- With the question and its box right below, the explain text (which points down to the thread) would repeat it. -->
      <p v-if="card.explain?.detail && !asking" class="m-0 text-sm leading-[1.5] text-text2">{{ card.explain.detail }}</p>
      <ul v-if="card.explain?.options.length && !asking" class="m-0 flex list-disc flex-col gap-0.5 pl-5 text-sm leading-[1.5] text-text2">
        <li v-for="o in card.explain.options" :key="o">{{ o }}</li>
      </ul>
    </div>

    <TicketQuestion v-if="asking" :card="card" />
    <p v-if="noAnswer" role="status" class="m-0 pl-1.5 text-sm font-semibold text-text2">{{ noAnswer }}</p>

    <!-- No agent can take it: say why, and hand the decision to the board manager. The Assignee picker below is the manual way. -->
    <div v-if="card.stranded" class="flex flex-wrap items-center gap-3 pl-1.5">
      <span class="flex-[1_1_200px] text-sm text-ink"><span v-if="!card.explain" class="font-semibold">{{ card.stranded }}. </span>Pick another assignee below, or ask the orchestrator for options.</span>
      <button type="button" :class="primary" @click="ask([card])">Ask the orchestrator</button>
    </div>

    <!-- The buttons for this move. Each needs the write gateway; read only, the band only explains. -->
    <div v-if="board.canApprove(task) && !board.readOnly" class="flex flex-wrap items-center gap-3 pl-1.5">
      <span class="flex-[1_1_200px] text-sm text-ink">
        <template v-if="task.approval_state === 'pending'">This card needs your approval before work starts.</template>
        <template v-else>{{ board.nameOf(card.primary?.assignee ?? '') }} posted a plan. Approve it, or reply below with changes.</template>
      </span>
      <button type="button" :class="primary" @click="board.approve(task.task_id)">
        {{ task.approval_state === 'pending' ? 'Approve' : 'Approve plan' }}
      </button>
    </div>

    <div v-if="canStart" class="flex flex-wrap items-center gap-3 pl-1.5">
      <span class="flex-[1_1_200px] text-sm text-ink">
        {{ start === 'Start' ? 'Ready when you are. Start hands the goal to the agents.' : 'The last step stopped. Restart gives the agent a fresh one.' }}
      </span>
      <button type="button" :class="primary" @click="board.startTask(task.task_id)">
        {{ start }}
      </button>
    </div>

    <div v-if="canReview" class="flex flex-col gap-2 pl-1.5">
      <!-- Publish is the only step the runner lets push. Pressing it is the approval; the PR is a draft and merging stays yours. -->
      <button v-if="/^pass/.test(task.internal_verification)" type="button" :class="[primary, 'w-fit']" @click="board.publishTask(task.task_id)">
        Push and open draft PR
      </button>
      <label for="ab-sendback" class="text-[13px] font-semibold text-text2">Not right? Send it back with one line</label>
      <div class="flex flex-wrap items-start gap-2">
        <textarea id="ab-sendback" v-model="sendBackText" rows="2" class="min-w-0 flex-[1_1_240px] resize-y rounded border border-input bg-surface px-3 py-2 text-sm text-ink" placeholder="What should change?" />
        <button type="button" :class="secondary" :disabled="!sendBackText.trim()" @click="sendBack">Send back</button>
      </div>
    </div>

    <div v-if="canArchive" class="flex flex-wrap items-center gap-3 pl-1.5">
      <span class="flex-[1_1_200px] text-sm text-text2">Done. Archive it to take it off the board once its summary is logged.</span>
      <button type="button" :class="secondary" @click="archive">Archive</button>
    </div>

    <p v-if="card.archived" class="m-0 pl-1.5 text-sm text-text2">Archived {{ formatDate(task.archived_at) }}. It's off the board; the thread keeps the summary.</p>
    <p v-else-if="board.readOnly" class="m-0 pl-1.5 text-sm text-text2">Read only: board writes are off until the write gateway is connected.</p>
    <NuxtLink to="/help" class="inline-flex min-h-6 items-center self-start pl-1.5 text-[13px] font-semibold text-accent underline-offset-2 hover:underline">How the board works</NuxtLink>
  </section>
</template>
