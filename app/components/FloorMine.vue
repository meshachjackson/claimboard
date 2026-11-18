<script setup lang="ts">
import { orchestratorName } from '~/types/board'
const orch = orchestratorName()
// The Needs you list: cards that wait on the owner, oldest first, each with the one move that usually fits.
// Retry is the only write here (start_task, PLAN rule 12); everything else opens the ticket, where the full choice is.
// Cards no agent can take for the same reason fold into one row (26 cards waiting on switched-off advisors read as one
// problem, not 26), placed where its oldest card would be.
import type { MoveCard } from '~/composables/useFloor'
import { MOVE_SIGNALS } from '~/types/board'
import { unheld, waitLabel } from '~/utils/whoseMove'

const props = defineProps<{ items: MoveCard[], limit?: number }>()
const board = useBoardStore()
const route = useRoute()

const signal = (m: MoveCard) => (m.card.approvalPending ? MOVE_SIGNALS.approve : m.card.stranded ? MOVE_SIGNALS.stranded : unheld(m.card) ? MOVE_SIGNALS.unheld : MOVE_SIGNALS[m.card.workState]) ?? MOVE_SIGNALS.needs_input!
// start_task restarts a stopped card or starts one nobody holds (PLAN rule 12).
const canStart = (m: MoveCard) => (m.card.workState === 'blocked' || unheld(m.card)) && !board.readOnly && board.canUse('start_task')
const ask = useAskManager()
const openTo = (id: string) => ({ path: route.path, query: { ...route.query, task: id } })

type Entry = { key: string, m: MoveCard, group: MoveCard[] }
const entries = computed<Entry[]>(() => {
  const byReason = new Map<string, MoveCard[]>()
  for (const m of props.items) if (m.card.stranded) byReason.set(m.card.stranded, [...(byReason.get(m.card.stranded) ?? []), m])
  const out: Entry[] = []
  for (const m of props.items) {
    const group = m.card.stranded ? byReason.get(m.card.stranded)! : []
    if (group.length > 1 && group[0] !== m) continue // already shown with its group
    out.push({ key: group.length > 1 ? `group:${m.card.stranded}` : m.card.task.task_id, m, group: group.length > 1 ? group : [] })
  }
  return props.limit ? out.slice(0, props.limit) : out
})
</script>

<template>
  <ol class="m-0 list-none p-0">
    <template v-for="{ key, m, group } in entries" :key="key">
    <!-- A group of cards stuck for one reason -->
    <li v-if="group.length" class="border-b border-line py-4">
      <div class="flex items-center gap-2.5 text-[13px] text-text3">
        <span class="rounded-sm px-2 py-px font-semibold" :style="{ background: MOVE_SIGNALS.stranded!.bg, color: MOVE_SIGNALS.stranded!.fg }">{{ MOVE_SIGNALS.stranded!.label }}</span>
        <span>{{ group.length }} cards</span>
        <span class="ml-auto font-semibold whitespace-nowrap text-ink">{{ waitLabel(m.move.since) }}</span>
      </div>
      <h3 class="m-0 mt-2 text-[17px] leading-snug font-semibold text-ink">{{ m.card.stranded }}</h3>
      <details class="mt-1 text-sm text-text2">
        <summary class="cursor-pointer">{{ group.slice(0, 2).map(g => g.card.task.title).join(', ') }}<template v-if="group.length > 2">, and {{ group.length - 2 }} more</template></summary>
        <ul class="m-0 mt-1.5 flex list-none flex-col gap-1 p-0">
          <li v-for="g in group" :key="g.card.task.task_id">
            <NuxtLink :to="openTo(g.card.task.task_id)" class="text-ink no-underline hover:underline"><span class="font-mono text-xs text-text3">{{ g.card.task.task_id }}</span> {{ g.card.task.title }}</NuxtLink>
          </li>
        </ul>
      </details>
      <div class="mt-3 flex flex-wrap gap-2">
        <button type="button" class="h-10 max-md:h-11 max-md:min-w-11 cursor-pointer rounded bg-ink px-3.5 text-sm font-semibold text-surface" @click="ask(group.map(g => g.card))">
          Ask {{ orch }}
        </button>
        <NuxtLink
          v-if="m.card.stranded.includes('switched off')"
          to="/settings#agents"
          class="inline-flex h-10 max-md:h-11 items-center rounded border-2 border-ink px-3.5 text-sm font-semibold text-ink no-underline"
        >Agent switches</NuxtLink>
      </div>
    </li>
    <li v-else class="border-b border-line py-4">
      <div class="flex items-center gap-2.5 text-[13px] text-text3">
        <span class="rounded-sm px-2 py-px font-semibold" :style="{ background: signal(m).bg, color: signal(m).fg }">{{ signal(m).label }}</span>
        <span class="font-mono">{{ m.card.task.task_id }}</span>
        <span v-if="m.card.task.project_id" class="truncate">{{ m.card.task.project_id }}</span>
        <span class="ml-auto font-semibold whitespace-nowrap text-ink">{{ waitLabel(m.move.since) }}</span>
      </div>
      <h3 class="m-0 mt-2 text-[17px] leading-snug font-semibold text-ink">{{ m.card.task.title }}</h3>
      <p v-if="m.card.stranded" class="m-0 mt-1 text-sm text-text2">{{ m.card.stranded }}</p>
      <p v-else-if="m.card.explain?.short" class="m-0 mt-1 text-sm text-text2">{{ m.card.explain.short }}</p>
      <div class="mt-3 flex flex-wrap gap-2">
        <button
          v-if="canStart(m)"
          type="button"
          class="h-10 max-md:h-11 max-md:min-w-11 cursor-pointer rounded bg-ink px-3.5 text-sm font-semibold text-surface disabled:cursor-not-allowed disabled:opacity-50"
          @click="board.startTask(m.card.task.task_id)"
        >
          {{ m.card.workState === 'blocked' ? 'Retry' : 'Start' }}
        </button>
        <button
          v-if="m.card.stranded"
          type="button"
          class="h-10 max-md:h-11 max-md:min-w-11 cursor-pointer rounded bg-ink px-3.5 text-sm font-semibold text-surface"
          @click="ask([m.card])"
        >
          Ask {{ orch }}
        </button>
        <NuxtLink
          :to="openTo(m.card.task.task_id)"
          class="inline-flex h-10 max-md:h-11 items-center rounded border-2 border-ink px-3.5 text-sm font-semibold text-ink no-underline"
        >{{ signal(m).open }}</NuxtLink>
      </div>
    </li>
    </template>
    <li v-if="!items.length" class="py-6 text-[15px] text-text2">Nothing waits on you. New questions and stopped cards land here first.</li>
  </ol>
</template>
