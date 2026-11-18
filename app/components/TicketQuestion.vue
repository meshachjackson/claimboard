<script setup lang="ts">
// The open question on a Needs-you card, answer first: the agent's latest question (first 3 lines, "Read all" opens the
// rest) and a reply box right under it. Send uses the store's reply op, the same one the pinned composer uses, so an
// open question gets a new step for the agent (rule 8). The pinned composer below stays for notes.
import type { CardView } from '~/stores/board'

const props = defineProps<{ card: CardView }>()
const board = useBoardStore()

const taskId = computed(() => props.card.task.task_id)
// The newest question note on the card. Notes arrive oldest first.
const question = computed(() => board.notesFor(taskId.value).filter(n => n.kind === 'question').pop())
const asker = computed(() => board.nameOf(board.questionFor(taskId.value)?.assignee ?? question.value?.author_id ?? ''))

// "Read all": the clamp shows 3 lines. A long single line wraps past 3 lines too, so a character count stands in for it.
const expanded = ref(false)
const long = computed(() => (question.value?.body.split('\n').length ?? 0) > 3 || (question.value?.body.length ?? 0) > 220)
watch(taskId, () => { expanded.value = false; draft.value = '' })

const draft = ref('')
async function send() {
  const text = draft.value.trim()
  if (!text) return
  // Cleared at once; put back if the server refuses and nothing new was typed.
  draft.value = ''
  if (!await board.reply(taskId.value, text) && !draft.value) draft.value = text
}
</script>

<template>
  <div v-if="question" class="flex flex-col gap-2 pl-1.5">
    <p class="m-0 text-[13px] font-semibold text-text2">{{ asker }} asks</p>
    <p id="ab-question-text" class="m-0 text-[15px] leading-[1.5] whitespace-pre-line text-ink" :class="!expanded && 'line-clamp-3'">{{ question.body }}</p>
    <button v-if="long" type="button" class="cursor-pointer self-start py-1 text-[13px] font-semibold text-accent hover:underline" :aria-expanded="expanded" aria-controls="ab-question-text" @click="expanded = !expanded">
      {{ expanded ? 'Show less' : 'Read all' }}
    </button>
    <label for="ab-answer" class="sr-only">Your answer to {{ asker }}</label>
    <textarea
      id="ab-answer"
      v-model="draft"
      rows="3"
      placeholder="Type your answer…"
      class="w-full resize-y rounded border border-input bg-surface px-3 py-2.5 text-sm leading-[1.45] text-ink"
      @keydown.meta.enter="send"
      @keydown.ctrl.enter="send"
    />
    <button type="button" class="h-10 w-fit cursor-pointer rounded bg-ink px-3.5 text-sm font-semibold text-surface disabled:cursor-not-allowed disabled:opacity-50" :disabled="!draft.trim() || board.readOnly" @click="send">
      Send
    </button>
  </div>
</template>
