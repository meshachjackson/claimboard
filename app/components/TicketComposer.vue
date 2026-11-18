<script setup lang="ts">
// The ticket's reply box, pinned to the bottom of the drawer: delivery receipts for the open message, who the text
// reaches, the box itself (R focuses it), @-tag chips, and Send. With a question open, a note and a reply are separate
// buttons because only the reply starts a step (rule 8).
import { QUESTION_NOTE_LABEL, QUESTION_REPLY_LABEL } from '~/types/board'
import { handleOf, taggable, taggedAgent } from '~/utils/boardOps'
import { targetOf } from '~/utils/dispatch'
import { formatDateTime, formatTime } from '~/utils/format'

const props = defineProps<{ taskId: string, phone?: boolean }>()
const board = useBoardStore()
const isDev = import.meta.dev

const card = computed(() => board.cards.find(c => c.task.task_id === props.taskId))
const task = computed(() => card.value?.task)
const simLabel = computed(() => board.simulateLabel(props.taskId))
const draft = ref('')
watch(() => props.taskId, () => { draft.value = '' })

// An agent's question: a reply answers it with a new step for that agent (rule 8).
const asking = computed(() => board.questionFor(props.taskId))
// Who a comment reaches. A question gets a reply; otherwise it goes to the orchestrator unless it tags an agent.
const messaging = computed(() => !asking.value && board.canUse('message_agent'))
const recipient = computed(() => messaging.value ? board.messageTarget(props.taskId, draft.value) : '')
// An @name in the comment sends it to that agent; assignment does not change. The chips below the box insert the tag.
const tagged = computed(() => messaging.value ? taggedAgent(draft.value, board.registry) : '')
const tagChoices = computed(() => messaging.value ? taggable(board.registry) : [])
function insertTag(id: string) {
  draft.value = `${draft.value}${draft.value && !/\s$/.test(draft.value) ? ' ' : ''}@${handleOf(id)} `
}
// "Respond now": the card's open message, when its agent can be woken (the orchestrator today).
const nudgeStep = computed(() => board.canUse('nudge') ? board.nudgeTarget(props.taskId) : null)

// Delivery receipts (section 4a) for the card's open or latest message: each is a column on the chat step.
const receipts = computed(() => {
  const s = board.latestChat(props.taskId)
  if (!s) return []
  const who = board.nameOf(s.assignee)
  const asked = s.step_state === 'needs_input' && !!s.acked_at
  const replied = s.step_state === 'served' && !!s.acked_at
  // Until it's received, say when to expect it. The orchestrator: right after Respond now, else on its next sweep (the board does not know its interval). The cloud
  // builder: when the dispatcher wakes it, else on its 6-hour run. A laptop agent: when a session next checks the board.
  const waiting = s.step_state === 'awaiting_start' ? 'asked to respond now'
    : board.wakeable(s.assignee) ? 'on its next sweep (press Respond now to skip the wait)'
    : targetOf(s) === 'cloud' ? 'when the dispatcher wakes it, or on its 6-hour run'
    : 'when a laptop session next checks the board'
  return [
    { label: 'Sent', done: true, at: s.created_at, text: `to ${who}` },
    { label: 'Received', done: !!s.dispatched_at, at: s.dispatched_at, text: s.dispatched_at ? `${who} picked it up` : waiting },
    { label: 'Working', done: !!s.heartbeat_at, at: s.heartbeat_at ?? null, text: s.activity || (s.dispatched_at && !s.acked_at ? 'no update yet' : '') },
    asked
      ? { label: 'Question', done: true, at: s.acked_at, text: `${who} asked you something below` }
      : { label: 'Replied', done: replied, at: replied ? s.acked_at : null, text: replied ? 'answer is in the thread' : '' }
  ]
})

// asNote posts a plain comment (no step). Otherwise the text is a reply, which starts a step when a question is open.
async function send(asNote = false) {
  const body = draft.value.trim()
  if (!body) return
  // The message shows in the thread and the box clears at once. If the server refuses, the text comes back
  // (unless the owner has already started something new), so nothing typed is lost.
  draft.value = ''
  const ok = asNote ? await board.comment(props.taskId, body) : await board.reply(props.taskId, body)
  if (!ok && !draft.value) draft.value = body
}
// Cmd/Ctrl+Enter sends when there is one choice. With a question open there are two (note or reply), so the key does
// nothing and the owner clicks the one he means.
const sendByKey = () => { if (!asking.value) send() }

const secondary = 'h-11 cursor-pointer rounded border-2 border-ink px-3.5 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-50'
</script>

<template>
  <div v-if="card && task" class="flex flex-col gap-2 border-t-2 border-rule bg-surface" :class="phone ? 'px-3 pt-2.5 pb-[max(18px,env(safe-area-inset-bottom))]' : 'px-5 pt-3 pb-4'">
    <ol v-if="receipts.length" role="status" aria-label="Message receipts" class="m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0 text-xs">
      <li
        v-for="(r, i) in receipts"
        :key="r.label"
        class="flex items-center gap-1.5"
        :class="r.done ? 'text-text2' : 'text-text3'"
        :title="r.at ? formatDateTime(r.at) : undefined"
      >
        <span
          class="size-2 rounded-full"
          :class="[r.done ? 'bg-(--ab-green-dot)' : 'border border-dash', !r.done && receipts[i - 1]?.done && card.chat && 'ab-pulse bg-accent border-0']"
        />
        <span class="font-semibold">{{ r.label }}</span>
        <span v-if="r.at">{{ formatTime(r.at) }}</span>
        <span v-if="r.text" class="max-w-[220px] truncate">· {{ r.text }}</span>
      </li>
    </ol>
    <label for="ab-reply" class="text-[13px] font-semibold text-text2">
      <template v-if="asking">Reply to {{ board.nameOf(asking.assignee) }} · starts a new step for them</template>
      <template v-else-if="tagged">Message {{ board.nameOf(tagged) }} · tagged, they answer in this thread. The card stays with {{ task.assignee ? board.nameOf(task.assignee) : 'no one' }}</template>
      <template v-else-if="messaging">Message the orchestrator · it answers or passes it on. Tag an agent with @name to message them directly</template>
      <!-- Without message_agent a comment is a plain note: nothing creates a step or wakes an agent. -->
      <template v-else>Note only · no agent reads notes yet, so nobody will answer this</template>
    </label>
    <textarea
      id="ab-reply"
      v-model="draft"
      :rows="phone ? 2 : 3"
      :placeholder="asking ? 'Answer the question, or leave a note…' : messaging ? `Ask ${board.nameOf(recipient)} something…` : 'Leave a note for the record…'"
      class="w-full resize-y rounded border border-input bg-surface px-3 py-2.5 leading-[1.45] text-ink"
      :class="phone ? 'text-[15px]' : 'text-sm'"
      @keydown.meta.enter="sendByKey"
      @keydown.ctrl.enter="sendByKey"
    />
    <div class="flex flex-wrap items-center gap-2">
      <div v-if="tagChoices.length" class="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-xs text-text3">
        <span>Ask:</span>
        <button
          v-for="a in tagChoices"
          :key="a.agent_id"
          type="button"
          :title="`Tag ${a.name}: they answer in this thread. The card is not reassigned.`"
          class="h-7 cursor-pointer rounded-sm bg-(--ab-neutral-bg) px-2 max-md:h-11 max-md:px-3 font-semibold text-text2 hover:text-ink"
          @click="insertTag(a.agent_id)"
        >
          {{ a.name }} <span class="font-normal text-text3">@{{ handleOf(a.agent_id) }}</span>
        </button>
      </div>
      <span v-else class="flex-1" />
      <button
        v-if="isDev && simLabel"
        type="button"
        title="Dev only: fakes the agent's next step"
        class="h-11 cursor-pointer rounded border border-dashed border-dash bg-filterbar px-3 text-xs font-semibold text-text2"
        @click="board.simulate(task.task_id)"
      >
        {{ simLabel }}
      </button>
      <button
        v-if="nudgeStep"
        type="button"
        :title="`Ask ${board.nameOf(nudgeStep.assignee)} to answer now instead of on its next sweep`"
        :class="secondary"
        @click="board.respondNow(task.task_id)"
      >
        Respond now
      </button>
      <button
        v-if="asking"
        type="button"
        title="Adds to the thread. No step starts and the agent isn't woken."
        :disabled="!draft.trim()"
        :class="secondary"
        @click="send(true)"
      >
        {{ QUESTION_NOTE_LABEL }}
      </button>
      <button
        type="button"
        :disabled="!draft.trim()"
        class="h-11 cursor-pointer rounded bg-ink px-[18px] text-sm font-semibold text-surface disabled:cursor-not-allowed disabled:opacity-50"
        @click="send()"
      >
        {{ asking ? QUESTION_REPLY_LABEL : 'Send' }}
      </button>
    </div>
  </div>
</template>
