<script setup lang="ts">
// The Floor (direction B, home): Needs you, On the floor and Shipped, the board's three questions in one screen.
// 1280px and wider: three zones side by side. 900 to 1279px: Needs you on the left, the other two stacked on the right
// with their top rows. Under 900px: three lamps, one zone at a time (?zone= keeps the choice in the URL).
// On desktop each zone head can fill the screen (?zone= again, so Back returns) or fold the zone to a lit strip
// (saved in this browser, Settings > Layout). Once anything is folded or filled, the zones sit side by side at every width.
import type { FloorZoneId } from '~/composables/useSettings'
import type { FloorTone } from '~/utils/floorLook'
import { formatDateTime } from '~/utils/format'
import { waitLabel } from '~/utils/whoseMove'

const board = useBoardStore()
const floor = useFloor()
const editor = useTicketEditor()
const palette = useCommandPalette()
const settings = useSettings()
const isPhone = useIsPhone()
const route = useRoute()
const router = useRouter()

// The header clock, refreshed every 30 seconds so it never shows a stale minute for long.
const stamp = () => formatDateTime(new Date().toISOString())
const now = ref(stamp())
let tick: ReturnType<typeof setInterval> | undefined
onMounted(() => { tick = setInterval(() => { now.value = stamp() }, 30_000) })
onBeforeUnmount(() => clearInterval(tick))

const named = computed(() => ['mine', 'floor', 'shipped'].includes(route.query.zone as string) ? route.query.zone as FloorZoneId : '')
const zone = computed(() => named.value || 'mine')
const pickZone = (z: string) => router.replace({ query: { ...route.query, zone: z } })

const oldest = computed(() => floor.mine.value[0])
// Until the first board read lands, every count is 0 and every list is empty by default, so the heads show a dash and
// "Loading…" instead (board.loaded, set once by the store).
const ready = computed(() => board.loaded)
const mineLine = computed(() => !ready.value ? 'Loading…' : oldest.value ? `Oldest has waited ${waitLabel(oldest.value.move.since)}` : 'Nothing waits on you')
const floorLine = computed(() => !ready.value ? 'Loading…' : `Working now. ${floor.queued.value} queued.`)
const shippedLine = computed(() => !ready.value ? 'Loading…' : `${floor.shipped.value.length} in all`)

// When agents have queued work but none is working, say when one last showed up: the runner may be off.
const lastSeen = computed(() => floor.agents.value.reduce((t, r) => r.lastBeat > t ? r.lastBeat : t, ''))
const stalled = computed(() => ready.value && floor.working.value === 0 && floor.queued.value > 0)

// What each zone says when it is empty. The button is the header's own "New card", and only when writing is allowed.
function emptyText(id: string) {
  if (id === 'mine') return { title: 'Nothing waits on you.' }
  if (id === 'floor') return { title: 'Nothing running.', hint: 'No agent has work on the board.', action: board.readOnly ? undefined : 'New card' }
  return { title: 'Nothing has shipped yet.' }
}
const empty = (id: string) => ready.value && (id === 'mine' ? floor.mine.value.length : id === 'floor' ? floor.agents.value.length : floor.shipped.value.length) === 0

const lamps = computed(() => [
  { id: 'mine', n: floor.mine.value.length, name: 'Needs you', on: 'bg-(--ab-amber) text-(--ab-amber-fg)' },
  { id: 'floor', n: floor.working.value, name: 'On the floor', on: 'bg-(--ab-floor) text-(--ab-floor-fg)' },
  { id: 'shipped', n: floor.shippedToday.value.length, name: 'Shipped today', on: 'bg-(--ab-run) text-(--ab-run-fg)' }
])

// Desktop zone layout. The phone keeps its lamps and ignores both choices.
interface Zone { id: FloorZoneId, tone: FloorTone, count: number, title: string, line: string, to?: string, toLabel?: string, width: string }
const zones = computed<Zone[]>(() => [
  { id: 'mine', tone: 'amber', count: floor.mine.value.length, title: 'Needs you', line: mineLine.value, width: '1.25fr' },
  { id: 'floor', tone: 'floor', count: floor.working.value, title: 'On the floor', line: floorLine.value, to: '/agents', toLabel: 'All agents', width: '1fr' },
  { id: 'shipped', tone: 'run', count: floor.shippedToday.value.length, title: 'Shipped today', line: shippedLine.value, to: '/shipped', toLabel: 'All', width: '0.9fr' }
])
const expanded = computed(() => isPhone.value ? '' : named.value)
const folded = (id: FloorZoneId) => settings.floorHidden.value.includes(id)
const openCount = computed(() => zones.value.filter(z => !folded(z.id)).length)
// Custom: something is folded or filled, so the generic grid draws the zones at every desktop width.
const custom = computed(() => !!expanded.value || settings.floorHidden.value.length > 0)
const shown = computed(() => expanded.value ? zones.value.filter(z => z.id === expanded.value) : zones.value)
const columns = computed(() => shown.value.map(z => expanded.value ? '1fr' : folded(z.id) ? '76px' : z.width).join(' '))

function toggleExpand(id: FloorZoneId) {
  const { zone: _drop, ...rest } = route.query
  router.push({ query: expanded.value ? rest : { ...rest, zone: id } })
}
</script>

<template>
  <div class="flex min-h-dvh flex-col">
    <header class="sticky top-0 z-20 flex min-h-14 items-center gap-3 border-b-2 border-rule bg-ground px-5 max-[899px]:px-4">
      <PageTitle label="Floor" class="max-[899px]:hidden" />
      <span class="font-display text-[22px] font-bold whitespace-nowrap min-[900px]:hidden">Agent board</span>
      <span class="text-sm text-text3 max-[899px]:hidden">{{ now }}</span>
      <span class="flex-1" />
      <LiveStatus :source="board.source" :read-only="board.readOnly" :updated-at="board.updatedAt" :refreshing="board.refreshing" :saved="board.saved" @refresh="board.refresh(true)" />
      <button type="button" aria-label="Search or run a command" class="inline-flex size-11 cursor-pointer items-center justify-center rounded min-[900px]:hidden" @click="palette.open.value = true">
        <UIcon name="i-lucide-search" class="size-5" />
      </button>
      <button v-if="!board.readOnly" type="button" aria-label="New card" class="inline-flex h-10 max-md:h-11 max-md:min-w-11 cursor-pointer items-center gap-1.5 rounded bg-ink px-3.5 text-sm font-semibold whitespace-nowrap text-surface max-[899px]:w-11 max-[899px]:justify-center max-[899px]:px-0" @click="editor.create()">
        <UIcon name="i-lucide-plus" class="size-4 flex-none" />
        <span class="max-[899px]:sr-only">New card</span>
      </button>
      <AccountMenu class="min-[900px]:hidden" />
    </header>
    <LoadBanner />

    <!-- Wide, or any width once a zone is folded or filled: the zones side by side; a folded one is a lit strip. -->
    <div class="hidden flex-1" :class="custom ? 'min-[900px]:grid' : 'xl:grid'" :style="{ gridTemplateColumns: columns }">
      <section v-for="(z, i) in shown" :key="z.id" :aria-label="z.title" class="min-w-0" :class="i < shown.length - 1 && 'border-r-2 border-rule'">
        <EmptyState v-if="!ready" loading :head="{ tone: z.tone, title: z.title }" />
        <FloorFold v-else-if="!expanded && folded(z.id)" :tone="z.tone" :count="z.count" :title="z.title" @show="settings.toggleFloorZone(z.id)" />
        <template v-else>
          <FloorZone
            :tone="z.tone" :count="z.count" :title="z.title" :line="z.line" :to="z.to" :to-label="z.toLabel"
            controls :expanded="!!expanded" :can-hide="openCount > 1"
            @expand="toggleExpand(z.id)" @hide="settings.toggleFloorZone(z.id)"
          />
          <p v-if="z.id === 'floor' && stalled" class="m-0 border-b border-line bg-(--ab-orange-pale) px-6 py-3 text-sm text-ink">
            No agent has picked up work since {{ formatDateTime(lastSeen) || 'the board started' }}. Is the runner on?
          </p>
          <!-- Filled, a list keeps a readable line length instead of running the width of the screen. -->
          <div class="px-6" :class="expanded && 'mx-auto w-full max-w-[880px]'">
            <EmptyState v-if="empty(z.id)" v-bind="emptyText(z.id)" @action="editor.create()" />
            <FloorMine v-else-if="z.id === 'mine'" :items="floor.mine.value" />
            <FloorAgents v-else-if="z.id === 'floor'" :rows="floor.agents.value" />
            <FloorShipped v-else :items="floor.shipped.value" :limit="expanded ? 60 : 12" />
          </div>
        </template>
      </section>
    </div>

    <!-- Laptop: Needs you keeps the left half; the other two stack on the right with their top rows. -->
    <div v-if="!custom" class="hidden flex-1 grid-cols-2 min-[900px]:grid xl:hidden">
      <section aria-label="Needs you" class="border-r-2 border-rule">
        <EmptyState v-if="!ready" loading :head="{ tone: 'amber', title: 'Needs you' }" />
        <FloorZone v-else tone="amber" :count="floor.mine.value.length" title="Needs you" :line="mineLine" controls can-hide @expand="toggleExpand('mine')" @hide="settings.toggleFloorZone('mine')" />
        <div v-if="ready" class="px-5"><EmptyState v-if="empty('mine')" v-bind="emptyText('mine')" /><FloorMine v-else :items="floor.mine.value" /></div>
      </section>
      <div>
        <section aria-label="On the floor" class="border-b-2 border-rule">
          <EmptyState v-if="!ready" loading :head="{ tone: 'floor', title: 'On the floor' }" compact />
          <FloorZone v-else tone="floor" compact :count="floor.working.value" title="On the floor" :line="floorLine" to="/agents" to-label="See all agents" controls can-hide @expand="toggleExpand('floor')" @hide="settings.toggleFloorZone('floor')" />
          <div v-if="ready" class="px-5"><EmptyState v-if="empty('floor')" v-bind="emptyText('floor')" @action="editor.create()" /><FloorAgents v-else :rows="floor.agents.value" :limit="3" /></div>
        </section>
        <section aria-label="Shipped">
          <EmptyState v-if="!ready" loading :head="{ tone: 'run', title: 'Shipped today' }" compact />
          <FloorZone v-else tone="run" compact :count="floor.shippedToday.value.length" title="Shipped today" :line="shippedLine" to="/shipped" to-label="See all" controls can-hide @expand="toggleExpand('shipped')" @hide="settings.toggleFloorZone('shipped')" />
          <div v-if="ready" class="px-5"><EmptyState v-if="empty('shipped')" v-bind="emptyText('shipped')" /><FloorShipped v-else :items="floor.shipped.value" :limit="4" /></div>
        </section>
      </div>
    </div>

    <!-- Phone and small tablet: three lamps, one zone below. -->
    <div class="flex flex-1 flex-col min-[900px]:hidden">
      <div role="tablist" aria-label="Zones" class="grid grid-cols-3 border-b-2 border-rule">
        <button
          v-for="l in lamps"
          :key="l.id"
          type="button"
          role="tab"
          :aria-selected="zone === l.id"
          class="cursor-pointer px-3 pt-2.5 pb-2 text-left"
          :class="zone === l.id ? l.on : 'text-text2'"
          @click="pickZone(l.id)"
        >
          <span class="block font-display text-[44px] leading-[0.9] font-bold">{{ ready ? l.n : '–' }}</span>
          <span class="mt-1 block text-[13px] font-semibold">{{ l.name }}</span>
        </button>
      </div>
      <div class="px-4">
        <EmptyState v-if="!ready" loading />
        <EmptyState v-else-if="empty(zone)" v-bind="emptyText(zone)" @action="editor.create()" />
        <FloorMine v-else-if="zone === 'mine'" :items="floor.mine.value" />
        <template v-else-if="zone === 'floor'">
          <p v-if="stalled" class="m-0 mt-3 bg-(--ab-orange-pale) px-3 py-2.5 text-sm text-ink">
            No agent has picked up work since {{ formatDateTime(lastSeen) || 'the board started' }}. Is the runner on?
          </p>
          <FloorAgents :rows="floor.agents.value" />
        </template>
        <FloorShipped v-else :items="floor.shipped.value" :limit="20" />
      </div>
    </div>
  </div>
</template>
