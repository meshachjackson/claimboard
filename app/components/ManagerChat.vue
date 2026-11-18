<script setup lang="ts">
import { orchestratorName } from '~/types/board'
const orch = orchestratorName()
const historyPage = useOrchestratorFeature() // the /orchestrator screen exists only with the feature on
// The orchestrator panel: a side panel beside the board (its own frame on desktop; on the phone it replaces the app frame), so the cards move while the owner talks. It opens on the standing the orchestrator
// thread (OrchestratorThread.vue). The board manager chat below is kept for bulk edits and for
// when the orchestrator is unavailable. The header names the voice that is answering, and each reply carries its speaker.
// The conversation lives here (the server keeps none) and rides along with each message to POST /api/manager.
// "New conversation" clears it. The board reloads after every answer; the push stream also shows writes as they land.
import { VOICES } from '~/types/board'
interface Turn { role: 'user' | 'assistant', content: string, actions?: { tool: string, summary: string, ok: boolean }[], error?: boolean }

const open = useManagerOpen()
const board = useBoardStore()
const turns = useState<Turn[]>('ab-manager-turns', () => [])
const draft = useState('ab-manager-draft', () => '') // shared so the command palette can hand over a question
const busy = ref(false)
const mode = useState<'orchestrator' | 'helper'>('ab-manager-mode', () => 'orchestrator')
const voice = computed(() => mode.value === 'orchestrator' ? VOICES.orchestrator : VOICES.manager)
const scroller = ref<HTMLElement | null>(null)

const starters = [
  'Open 8 cards for a new onboarding flow for the board, with acceptance checks.',
  'Look at the whole board and tell me what looks duplicated or stale.',
  'Split the biggest Backlog card into smaller ones.'
]

async function scrollDown() {
  await nextTick()
  scroller.value?.scrollTo({ top: scroller.value.scrollHeight })
}

async function send(text = draft.value) {
  const content = text.trim()
  if (!content || busy.value) return
  draft.value = ''
  turns.value = [...turns.value, { role: 'user', content }]
  busy.value = true
  scrollDown()
  try {
    // Errors and action lists are display-only: the server gets just role and content.
    const messages = turns.value.filter(t => !t.error).map(({ role, content }) => ({ role, content }))
    const res = await $fetch<{ reply: string, actions: Turn['actions'] }>('/api/manager', { method: 'POST', body: { messages } })
    turns.value = [...turns.value, { role: 'assistant', content: res.reply, actions: res.actions }]
    await board.refresh(true)
  } catch (e: any) {
    turns.value = [...turns.value, { role: 'assistant', content: e?.data?.statusMessage || e?.statusMessage || 'The board manager did not answer. Try again.', error: true }]
  } finally {
    busy.value = false
    scrollDown()
  }
}

// Esc closes the panel like every other panel (audit 11/1/2026), even from the message box. The listener exists only
// while the panel is open, so Esc still reaches the ticket panel and dialogs when it is closed.
const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) open.value = false }
watch(open, (o) => { if (o) window.addEventListener('keydown', onEsc); else window.removeEventListener('keydown', onEsc) })
onBeforeUnmount(() => window.removeEventListener('keydown', onEsc))

function onKey(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    send()
  }
}
</script>

<template>
  <aside
    v-if="open"
    :aria-label="voice.name"
    class="flex h-dvh min-w-0 flex-col border-l border-line bg-surface max-md:flex-1 md:w-[400px] md:flex-none"
  >
    <header class="flex items-center gap-2 border-b border-line px-3 pt-2.5 pb-1">
      <UIcon name="i-lucide-bot" class="size-4" />
      <h2 class="flex-1 text-[14px] font-semibold text-ink">{{ voice.name }}</h2>
      <button v-if="mode === 'orchestrator'" type="button" class="cursor-pointer text-[12px] text-text3 hover:text-ink" @click="board.newOrchestratorThread()">New thread</button>
      <NuxtLink v-if="mode === 'orchestrator' && historyPage" to="/orchestrator" class="text-[12px] text-text3 no-underline hover:text-ink" @click="open = false">Open full history</NuxtLink>
      <button type="button" class="cursor-pointer text-[12px] text-text3 hover:text-ink" @click="mode = mode === 'orchestrator' ? 'helper' : 'orchestrator'">
        {{ mode === 'orchestrator' ? 'Board manager' : `Back to ${orch}` }}
      </button>
      <button v-if="mode === 'helper' && turns.length" type="button" class="cursor-pointer text-[12px] text-text3 hover:text-ink" @click="turns = []">New conversation</button>
      <button type="button" :aria-label="`Close ${voice.name}`" class="inline-flex size-7 cursor-pointer items-center justify-center rounded-lg hover:bg-line/40" @click="open = false">
        <UIcon name="i-lucide-x" class="size-4" />
      </button>
    </header>
    <!-- Who is answering, in one line. -->
    <p class="m-0 border-b border-line px-3 pb-2 text-[12px] text-text3">{{ voice.role }}{{ mode === 'helper' ? ' (works without ' + orch + ')' : '' }}</p>

    <OrchestratorThread v-if="mode === 'orchestrator'" />

    <template v-else>
    <div ref="scroller" class="flex-1 space-y-3 overflow-y-auto px-3 py-3">
      <div v-if="!turns.length" class="space-y-2 text-[13px] text-text3">
        <p>I run the board in bulk: open many cards, move, edit, merge duplicates, split cards and archive. Tell me what you want.</p>
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

      <div v-for="(t, i) in turns" :key="i" :class="t.role === 'user' ? 'ml-8' : 'mr-4'">
        <p class="m-0 mb-0.5 px-1 text-xs text-text3" :class="t.role === 'user' ? 'text-right' : ''">{{ t.role === 'user' ? 'You' : VOICES.manager.name }}</p>
        <div
          class="whitespace-pre-wrap rounded-xl px-3 py-2 text-[13px] leading-relaxed"
          :class="t.role === 'user' ? 'bg-ink text-surface' : t.error ? 'border border-line text-(--ab-orange-fg)' : 'border border-line text-ink'"
        >
          {{ t.content }}
        </div>
        <ul v-if="t.actions?.length" class="mt-1 space-y-0.5 pl-1 text-[12px] text-text3">
          <li v-for="(a, j) in t.actions" :key="j">
            <UIcon :name="a.ok ? 'i-lucide-check' : 'i-lucide-triangle-alert'" class="mr-1 size-3 align-[-1px]" />{{ a.summary }}
          </li>
        </ul>
      </div>
      <p v-if="busy" class="text-[12px] text-text3">Board manager is working on the board…</p>
    </div>

    <form class="border-t border-line p-3" @submit.prevent="send()">
      <textarea
        v-model="draft"
        rows="2"
        :disabled="busy"
        placeholder="Tell the board manager what to change…"
        class="w-full resize-none rounded-lg border border-line bg-transparent px-2.5 py-2 text-[13px] text-ink outline-none focus:border-ink"
        @keydown="onKey"
      />
      <div class="mt-1.5 flex items-center justify-between">
        <span class="text-xs text-text3">Enter sends, Shift+Enter adds a line</span>
        <button type="submit" :disabled="busy || !draft.trim()" class="h-8 cursor-pointer rounded-lg bg-ink px-3 text-[13px] font-semibold text-surface disabled:opacity-40">Send</button>
      </div>
    </form>
    </template>
  </aside>
</template>
