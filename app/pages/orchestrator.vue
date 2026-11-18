<script setup lang="ts">
import { orchestratorName } from '~/types/board'
const orch = orchestratorName()
const agentTabs = useAgentTabs()
// The orchestrator feature (runtime config public.featureOrchestrator) is off on this board: this screen has nothing to show.
if (!useOrchestratorFeature()) await navigateTo('/agents', { replace: true })
// The orchestrator, full history: every board thread with the orchestrator, newest thread first, each with its messages oldest to newest.
// The panel shows the current thread; this screen is for finding something said in an earlier one. Search covers the
// words and card ids, and the day filter takes either end. Telegram talks on another card and is not listed.
import { formatDate, formatTime } from '~/utils/format'
import { historyThreads, parseSurface, type HistoryEntry } from '~/utils/orchestratorThread'

const board = useBoardStore()
const manager = useManagerOpen() // the orchestrator panel (ManagerChat.vue)
const search = ref('')
const searchEl = ref<HTMLInputElement>()
const shortcutsOpen = useShortcutsOpen()
// / focuses the search box (not while typing, with the orchestrator panel or the shortcuts dialog open).
useBoardKeys({ search: () => searchEl.value?.focus() }, () => manager.value || shortcutsOpen.value)
const from = ref('')
const to = ref('')

const toEntry = (n: { note_id: string, author_id: string, kind?: string, body: string, created_at: string }): HistoryEntry => {
  const { surface, text } = parseSurface(n.body)
  return { id: n.note_id, mine: n.author_id.startsWith('person:'), system: n.kind === 'status', surface, text, at: n.created_at }
}
const byCard = computed(() => Object.fromEntries(board.orchestratorThreadCards.map(c => [c.task_id, board.notesFor(c.task_id).map(toEntry)])))
const total = computed(() => Object.values(byCard.value).reduce((n, list) => n + list.length, 0))
const threads = computed(() => historyThreads(board.orchestratorThreadCards, byCard.value, search.value, from.value, to.value))
const shown = computed(() => threads.value.reduce((n, t) => n + t.entries.length, 0))
const filtering = computed(() => !!(search.value.trim() || from.value || to.value))
function clear() { search.value = ''; from.value = ''; to.value = '' }

const field = 'h-9 rounded-lg border border-input bg-transparent px-2.5 text-[14px] text-ink outline-none focus:border-ink'
</script>

<template>
  <div class="flex min-h-dvh flex-col">
    <header class="sticky top-0 z-20 flex min-h-14 items-stretch gap-6 border-b-2 border-rule bg-ground px-5">
      <PageTitle class="self-center" />
      <PageTabs :tabs="agentTabs" />
    </header>
    <div class="mx-auto w-full max-w-[880px] px-6 pb-12">
      <div class="flex flex-wrap items-end gap-3 pt-5">
        <label class="flex min-w-[220px] flex-1 flex-col gap-1 text-xs font-semibold text-text3">Search
          <input ref="searchEl" v-model="search" type="search" placeholder="Words or a card id" :class="field">
        </label>
        <label class="flex flex-col gap-1 text-xs font-semibold text-text3">From
          <input v-model="from" type="date" :max="to || undefined" :class="field">
        </label>
        <label class="flex flex-col gap-1 text-xs font-semibold text-text3">To
          <input v-model="to" type="date" :min="from || undefined" :class="field">
        </label>
        <button v-if="filtering" type="button" class="h-9 cursor-pointer rounded-lg px-2 text-[14px] text-text2 hover:text-ink" @click="clear">Clear</button>
        <button type="button" class="h-9 cursor-pointer rounded-lg bg-ink px-3 text-[14px] font-semibold text-surface" @click="manager = true">Ask {{ orch }}</button>
      </div>
      <p class="mt-3 mb-0 text-[13px] text-text3" role="status">
        {{ filtering ? `${shown} of ${total} messages` : `${threads.length} ${threads.length === 1 ? 'thread' : 'threads'}, ${total} messages` }}
      </p>

      <p v-if="!board.orchestratorThreadCards.length && board.loaded" class="py-6 text-[15px] text-text2">No conversation with {{ orch }} yet. Ask anything and the first thread starts here.</p>
      <p v-else-if="!threads.length && board.loaded" class="py-6 text-[15px] text-text2">Nothing matches. <button type="button" class="cursor-pointer underline" @click="clear">Clear the filters</button></p>

      <section v-for="t in threads" :key="t.id" class="pt-6">
        <h2 class="m-0 flex items-baseline gap-3 border-b-2 border-rule pb-1.5 font-display text-[22px] font-bold">
          {{ t.title }} <span class="font-semibold text-text3">{{ t.entries.length }}</span>
        </h2>
        <p v-if="!t.entries.length" class="m-0 pt-3 text-[13px] text-text3">No messages yet.</p>
        <ul class="m-0 list-none space-y-3 p-0 pt-3">
          <li v-for="e in t.entries" :key="e.id">
            <p v-if="e.system" class="m-0 text-center text-[12px] text-text3"><OrchestratorText :text="e.text" /> · {{ formatDate(e.at) }} {{ formatTime(e.at) }}</p>
            <div v-else :class="e.mine ? 'ml-12' : 'mr-12'">
              <div class="rounded-xl px-3.5 py-2.5 text-[14px] leading-relaxed" :class="e.mine ? 'bg-ink text-surface' : 'border border-line text-ink'">
                <OrchestratorText :text="e.text" :class="e.mine ? '[&_a]:text-surface' : ''" />
              </div>
              <p class="mt-0.5 px-1 text-[12px] text-text3" :class="e.mine ? 'text-right' : ''">
                {{ e.mine ? 'You' : orch }} · {{ formatDate(e.at) }} {{ formatTime(e.at) }}
              </p>
            </div>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
