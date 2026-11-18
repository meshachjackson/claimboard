<script setup lang="ts">
import { orchestratorName } from '~/types/board'
const orch = orchestratorName()
// The current board thread with the orchestrator, shown inside the manager panel. The entries are the notes of the newest board thread
// card (tag orchestrator-board). Telegram, Slack and voice talk on a different card and never show here. Sending writes through
// board.askOrchestrator, which opens a thread card when needed and wakes the orchestrator. /new or /clear starts a new thread, like Telegram.
import { formatTime } from '~/utils/format'
import { VOICES } from '~/types/board'
import { isResetCommand, parseSurface } from '~/utils/orchestratorThread'

const board = useBoardStore()
const draft = useState('ab-manager-draft', () => '') // shared with the command palette and "Ask the orchestrator" buttons
const sending = ref(false)
const problem = ref('')
const scroller = ref<HTMLElement | null>(null)

const starters = [
  'What is next? Give me the top items I can help with.',
  'Which cards look ignored by their agent?',
  'I have an idea for the board. Is it already planned?'
]

// Oldest first, with the surface split off the body. The orchestrator's answers carry no prefix.
const entries = computed(() => board.orchestratorThread.map((n) => {
  const { surface, text } = parseSurface(n.body)
  return { id: n.note_id, mine: n.author_id.startsWith('person:'), system: n.kind === 'status', surface, text, at: n.created_at }
}))
const waiting = computed(() => sending.value || board.orchestratorWorking)

async function scrollDown() {
  await nextTick()
  scroller.value?.scrollTo({ top: scroller.value.scrollHeight })
}
watch(() => entries.value.length, scrollDown, { flush: 'post' })
onMounted(scrollDown)

async function send(text = draft.value) {
  const content = text.trim()
  if (!content || sending.value) return
  if (isResetCommand(content)) { // a reset is not a message to the orchestrator
    board.newOrchestratorThread()
    draft.value = ''
    return
  }
  sending.value = true
  problem.value = ''
  const ok = await board.askOrchestrator(content)
  sending.value = false
  if (ok) draft.value = ''
  else problem.value = board.lastRefusal?.reason || 'The message did not go through. Your text is still in the box.'
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    send()
  }
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div ref="scroller" class="flex-1 space-y-3 overflow-y-auto px-3 py-3">
      <div v-if="!entries.length" class="space-y-2 text-[13px] text-text3">
        <p>This is a conversation between you and {{ orch }} about the board. It is separate from Telegram. Type /new or /clear, or press New thread, to start over; earlier threads stay in full history.</p>
        <button
          v-for="s in starters"
          :key="s"
          type="button"
          class="block w-full cursor-pointer rounded-lg border border-line px-2.5 py-2 text-left text-ink hover:bg-line/30"
          @click="send(s)"
        >
          {{ s }}
        </button>
      </div>

      <template v-for="e in entries" :key="e.id">
        <!-- Status notes ("Asked the orchestrator to respond now") are the board talking, not either side, so they stay small and quiet. -->
        <p v-if="e.system" class="text-center text-xs text-text3">{{ e.text }} · {{ formatTime(e.at) }}</p>
        <div v-else :class="e.mine ? 'ml-8' : 'mr-4'">
          <div class="whitespace-pre-wrap rounded-xl px-3 py-2 text-[13px] leading-relaxed" :class="e.mine ? 'bg-ink text-surface' : 'border border-line text-ink'">
            {{ e.text }}
          </div>
          <p class="mt-0.5 px-1 text-xs text-text3" :class="e.mine ? 'text-right' : ''">
            <span v-if="e.surface && e.surface !== 'board'" class="mr-1 rounded bg-line/50 px-1 capitalize">{{ e.surface }}</span>{{ e.mine ? 'You' : VOICES.orchestrator.name }} · {{ formatTime(e.at) }}
          </p>
        </div>
      </template>
      <p v-if="waiting" class="text-[12px] text-text3" role="status">{{ orch }} is working on it…</p>
    </div>

    <form class="border-t border-line p-3" @submit.prevent="send()">
      <p v-if="problem" class="mb-1.5 text-[12px] text-(--ab-orange-fg)" role="alert">{{ problem }}</p>
      <textarea
        v-model="draft"
        rows="2"
        :disabled="sending"
        :placeholder="`Ask ${orch}…`"
        :aria-label="`Message to ${orch}`"
        class="w-full resize-none rounded-lg border border-line bg-transparent px-2.5 py-2 text-[13px] text-ink outline-none focus:border-ink"
        @keydown="onKey"
      />
      <div class="mt-1.5 flex items-center justify-between">
        <span class="text-xs text-text3">Enter sends, Shift+Enter adds a line</span>
        <button type="submit" :disabled="sending || !draft.trim()" class="h-8 cursor-pointer rounded-lg bg-ink px-3 text-[13px] font-semibold text-surface disabled:opacity-40">Send</button>
      </div>
    </form>
  </div>
</template>
