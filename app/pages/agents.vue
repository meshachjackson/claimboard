<script setup lang="ts">
const agentTabs = useAgentTabs()
// Agents, Live tab: every agent with work on the board, what it is doing, what it owes the owner and its queue, with
// the cards listed under each. The Roster tab is the registry (/registry).
import { formatDateTime } from '~/utils/format'
import { waitLabel } from '~/utils/whoseMove'

const floor = useFloor()
const board = useBoardStore()
const route = useRoute()
const lastSeen = computed(() => floor.agents.value.reduce((t, r) => r.lastBeat > t ? r.lastBeat : t, ''))
const stalled = computed(() => floor.working.value === 0 && floor.queued.value > 0)
const editor = useTicketEditor()
const ready = computed(() => board.loaded)
// Nothing is working: the zone line says so with the queue, and the list below offers the one move that can change it.
const zoneLine = computed(() => !ready.value ? 'Loading…' : floor.working.value ? `Working now. ${floor.queued.value} queued.` : `Nothing running. ${floor.queued.value} queued.`)
const openTo = (id: string) => ({ path: route.path, query: { ...route.query, task: id } })
</script>

<template>
  <div class="flex min-h-dvh flex-col">
    <header class="sticky top-0 z-20 flex min-h-14 items-stretch gap-6 border-b-2 border-rule bg-ground px-5">
      <PageTitle class="self-center" />
      <PageTabs :tabs="agentTabs" />
      <NudgeDispatcher class="ml-auto" />
    </header>
    <EmptyState v-if="!ready" loading :head="{ tone: 'floor', title: 'On the floor' }" />
    <FloorZone v-else tone="floor" :count="floor.working.value" title="On the floor" :line="zoneLine" />
    <p v-if="ready && stalled" class="m-0 border-b border-line bg-(--ab-orange-pale) px-6 py-3 text-sm text-ink">
      No agent has picked up work since {{ formatDateTime(lastSeen) || 'the board started' }}. Is the runner on?
    </p>
    <div class="grid gap-x-10 px-6 pb-12 min-[1100px]:grid-cols-2">
      <EmptyState
        v-if="ready && !floor.working.value"
        class="col-span-full"
        :title="floor.agents.value.length ? 'Start a card to put an agent to work.' : 'No agent has work on the board.'"
        :action="board.readOnly ? undefined : 'New card'"
        @action="editor.create()"
      />
      <section v-for="r in floor.agents.value" :key="r.id" class="border-b border-line pb-3">
        <FloorAgents :rows="[r]" />
        <ul class="m-0 list-none p-0 pl-[54px]">
          <li v-for="m in [...r.working, ...r.owes, ...r.queued]" :key="m.card.task.task_id" class="flex items-baseline gap-2.5 py-1 text-sm">
            <span class="w-[72px] flex-none text-xs text-text3">{{ r.working.includes(m) ? 'Working' : r.owes.includes(m) ? 'Owes you' : 'Queued' }}</span>
            <NuxtLink :to="openTo(m.card.task.task_id)" class="min-h-6 min-w-0 truncate py-0.5 text-ink no-underline hover:underline">
              <span class="font-mono text-xs text-text3">{{ m.card.task.task_id }}</span> {{ m.card.task.title }}
            </NuxtLink>
            <span class="ml-auto flex-none text-xs text-text3">{{ waitLabel(m.move.since) }}</span>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
