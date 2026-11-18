<script setup lang="ts">
// Macro planning: every epic, milestone and release with its deadline and progress, and the unplanned cards
// (no epic, no milestone or release) that nothing is batching yet. Epic and milestone membership is in the card's tags
// (utils/planning.ts); deadlines are per device (composables/usePlanning.ts). Direction B layout: three signal numbers,
// the plan on the left, the unplanned queue to place on the right (stacked under 1100px).
import type { PlanKind, PlanSort } from '~/utils/planning'
import { epicOf, isOrphan, KIND_LABELS, milestoneOf, PLAN_KINDS, rollup, setPlanTag, sortPlanRows } from '~/utils/planning'
import { formatDate } from '~/utils/format'

const board = useBoardStore()
const plan = usePlanning()

const today = new Date().toISOString().slice(0, 10)
const live = computed(() => board.cards.filter(c => !c.archived))
const sortBy = ref<PlanSort>('deadline')
const rows = computed(() => sortPlanRows(rollup(live.value.map(c => ({ tags: c.tags, done: c.workState === 'done' })), plan.items.value, today), sortBy.value))
const epics = computed(() => rows.value.filter(r => r.kind === 'epic'))
const milestones = computed(() => rows.value.filter(r => r.kind !== 'epic'))

const orphans = computed(() => live.value.filter(c => c.workState !== 'done' && isOrphan(c.tags)))
const placed = computed(() => live.value.filter(c => c.workState !== 'done').length - orphans.value.length)
const overdue = computed(() => rows.value.filter(r => r.overdue).length)
const signals = computed(() => [
  { n: placed.value, label: 'Open cards planned', look: 'bg-surface text-ink', href: '' },
  // Neutral, not amber: amber stays the Needs you lamp, and unplanned cards are a tidy-up, not a wait.
  { n: orphans.value.length, label: 'Unplanned', look: 'bg-surface text-ink', href: '#unplanned' },
  { n: overdue.value, label: overdue.value === 1 ? 'Deadline passed' : 'Deadlines passed', look: overdue.value ? 'bg-(--ab-red) text-white' : 'bg-surface text-ink', href: '' }
])
const kindChoices = PLAN_KINDS.map(id => ({ id, label: KIND_LABELS[id] }))
const route = useRoute()
const openTo = (id: string) => ({ path: route.path, query: { ...route.query, task: id } })
const pct = (r: { done: number, total: number }) => r.total ? Math.round(r.done / r.total * 100) : 0

// New item form.
const kind = ref<PlanKind>('epic')
const name = ref('')
const due = ref('')
function add() {
  if (!name.value.trim()) return
  plan.saveItem(kind.value, name.value, due.value)
  name.value = ''
  due.value = ''
}

// Place an unplanned card: write the epic or milestone tag through update_task.
const target = (rowsOfKind: typeof epics.value) => rowsOfKind.map(r => r.tag)
async function place(taskId: string, slot: 'epic' | 'milestone', tag: string) {
  const card = board.cards.find(c => c.task.task_id === taskId)
  if (!card || !tag) return
  const kindOfSlot: PlanKind = slot === 'epic' ? 'epic' : tag.startsWith('rel-') ? 'release' : 'milestone'
  const tags = setPlanTag(card.tags, kindOfSlot, tag.replace(/^(epic|ms|rel)-/, ''))
  await board.updateTask(taskId, { tags: tags.join(',') })
}

const boardLink = (r: { kind: PlanKind, tag: string }) => ({ path: '/board', query: { [r.kind === 'epic' ? 'epic' : 'milestone']: r.tag } })
const field = 'h-10 rounded border border-input bg-surface px-2.5 text-sm text-ink'
</script>

<template>
  <div class="flex min-h-dvh flex-col">
    <header class="sticky top-0 z-20 flex min-h-14 items-stretch gap-6 border-b-2 border-rule bg-ground px-5">
      <PageTitle class="self-center" />
      <PageTabs :tabs="[{ to: '/plan', label: 'Plan' }, { to: '/sketch', label: 'Sketch' }]" />
      <span class="flex-1" />
      <label class="flex items-center gap-2 self-center text-sm text-text3 max-[599px]:hidden">
        Sort by
        <select v-model="sortBy" :class="field">
          <option value="deadline">Deadline</option>
          <option value="name">Name</option>
          <option value="cards">Card count</option>
        </select>
      </label>
    </header>

    <!-- Three signal numbers: what is planned, what still needs a place, and what has run past its deadline. -->
    <section aria-label="Plan at a glance" class="grid grid-cols-3 border-b-2 border-rule">
      <component
        :is="s.href ? 'a' : 'div'"
        v-for="(s, i) in signals"
        :key="s.label"
        :href="s.href || undefined"
        class="flex items-end gap-3 px-6 py-4 text-current no-underline max-[699px]:flex-col max-[699px]:items-start max-[699px]:gap-1 max-[699px]:px-4"
        :class="[s.look, i < 2 && 'border-r-2 border-rule']"
      >
        <span class="font-display text-[56px] leading-[0.8] font-bold max-[699px]:text-[40px]">{{ s.n }}</span>
        <span class="pb-0.5 font-display text-[22px] leading-none font-bold max-[699px]:text-[15px]">{{ s.label }}</span>
      </component>
    </section>

    <main class="grid flex-1 gap-x-10 gap-y-10 px-6 pt-7 pb-16 max-[699px]:px-4 min-[1100px]:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div class="flex min-w-0 flex-col gap-10">
        <form class="flex flex-col gap-3" aria-labelledby="plan-new" @submit.prevent="add">
          <div class="border-b-2 border-rule pb-2">
            <h2 id="plan-new" class="m-0 font-display text-[26px] leading-none font-bold">New epic, milestone or release</h2>
            <p class="m-0 mt-1.5 text-sm text-text3">Deadlines are saved in this browser. Cards join one through the field on the card, or from the list on the right.</p>
          </div>
          <SegChoice :options="kindChoices" :model-value="kind" labelledby="plan-new" @update:model-value="kind = $event as PlanKind" />
          <div class="flex flex-wrap items-end gap-2">
            <label class="flex min-w-48 flex-1 flex-col gap-1.5 text-xs font-semibold text-text2">
              Name
              <input v-model="name" :class="field" placeholder="auth, beta, 1.0">
            </label>
            <label class="flex flex-col gap-1.5 text-xs font-semibold text-text2">
              Deadline (optional)
              <input v-model="due" type="date" :class="field">
            </label>
            <button type="submit" :disabled="!name.trim()" class="h-10 cursor-pointer rounded bg-ink px-4 text-sm font-semibold text-surface disabled:cursor-not-allowed disabled:opacity-50">Add {{ KIND_LABELS[kind].toLowerCase() }}</button>
          </div>
        </form>

        <section v-for="group in [{ id: 'epics', title: 'Epics', list: epics }, { id: 'milestones', title: 'Milestones and releases', list: milestones }]" :key="group.id" :aria-labelledby="`plan-${group.id}`">
          <div class="flex items-baseline gap-3 border-b-2 border-rule pb-2">
            <h2 :id="`plan-${group.id}`" class="m-0 font-display text-[26px] leading-none font-bold">{{ group.title }}</h2>
            <span class="font-display text-[22px] leading-none font-bold text-text3">{{ group.list.length }}</span>
          </div>
          <p v-if="!group.list.length" class="m-0 py-4 text-sm text-text3">None yet. Add one above, or type a name in a card.</p>
          <ul v-else class="m-0 list-none bg-surface p-0">
            <li v-for="r in group.list" :key="r.tag" class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-b border-line px-4 py-3 last:border-b-0">
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <NuxtLink :to="boardLink(r)" class="truncate text-[15px] font-semibold text-ink underline-offset-2 hover:underline">{{ r.label }}</NuxtLink>
                  <span v-if="r.kind === 'release'" class="rounded-sm bg-(--ab-neutral-bg) px-1.5 py-px text-xs font-semibold text-text2">Release</span>
                  <span v-if="r.overdue" class="rounded-sm bg-(--ab-red) px-1.5 py-px text-xs font-semibold text-white">Past deadline</span>
                </div>
                <!-- Progress: a bar for the eye and the numbers for the record. -->
                <div class="mt-2 flex items-center gap-3">
                  <div class="h-2 max-w-60 flex-1 overflow-hidden rounded-sm bg-(--ab-neutral-bg)" role="img" :aria-label="`${r.done} of ${r.total} done`">
                    <div class="h-full bg-(--ab-run)" :style="{ width: `${pct(r)}%` }" />
                  </div>
                  <span class="text-sm whitespace-nowrap text-text2">{{ r.done }} of {{ r.total }} done</span>
                </div>
              </div>
              <div class="flex items-center gap-2">
                <input
                  type="date"
                  :value="r.due_at"
                  :aria-label="`Deadline for ${r.label}`"
                  :title="r.overdue ? `Deadline ${formatDate(r.due_at)} has passed` : 'Deadline'"
                  :class="[field, r.overdue && 'border-2 border-(--ab-red-text)']"
                  @change="plan.saveItem(r.kind, r.label, ($event.target as HTMLInputElement).value)"
                >
                <button
                  v-if="plan.items.value.some(p => p.tag === r.tag)"
                  type="button"
                  class="inline-flex size-10 cursor-pointer items-center justify-center rounded text-text3 hover:bg-(--ab-row-hover) hover:text-ink"
                  :aria-label="`Forget the deadline for ${r.label}`"
                  title="Forget the deadline. Cards keep their tag."
                  @click="plan.removeItem(r.tag)"
                >
                  <UIcon name="i-lucide-x" class="size-4" />
                </button>
                <span v-else class="size-10" aria-hidden="true" />
              </div>
            </li>
          </ul>
        </section>
      </div>

      <section id="unplanned" aria-labelledby="plan-unplanned" class="min-w-0 scroll-mt-20">
        <div class="border-b-2 border-rule pb-2">
          <div class="flex items-baseline gap-3">
            <h2 id="plan-unplanned" class="m-0 font-display text-[26px] leading-none font-bold">Unplanned</h2>
            <span class="font-display text-[22px] leading-none font-bold text-text3">{{ orphans.length }}</span>
            <NuxtLink :to="{ path: '/board', query: { epic: '_none', milestone: '_none' } }" class="ml-auto inline-flex min-h-6 items-center text-sm font-semibold text-accent underline-offset-2 hover:underline">On the board</NuxtLink>
          </div>
          <p class="m-0 mt-1.5 text-sm text-text3">Open cards with no epic, milestone or release. Pick one to place a card; it leaves this list.</p>
        </div>
        <p v-if="!orphans.length" class="m-0 py-4 text-sm text-text3">Every open card has an epic or a milestone.</p>
        <ul v-else class="m-0 list-none bg-surface p-0">
          <li v-for="c in orphans" :key="c.task.task_id" class="flex flex-col gap-2 border-b border-line px-4 py-3 last:border-b-0">
            <NuxtLink :to="openTo(c.task.task_id)" class="block min-h-6 py-px text-[15px] leading-snug text-ink no-underline hover:underline">
              <span class="font-mono text-xs text-text3">{{ c.task.task_id }}</span> {{ c.task.title }}
            </NuxtLink>
            <div class="flex flex-wrap gap-2">
              <select :class="[field, 'min-w-0 flex-1']" :aria-label="`Epic for ${c.task.task_id}`" :disabled="board.readOnly || !epics.length" :value="epicOf(c.tags)" @change="place(c.task.task_id, 'epic', ($event.target as HTMLSelectElement).value)">
                <option value="">{{ epics.length ? 'Epic…' : 'No epics yet' }}</option>
                <option v-for="t in target(epics)" :key="t" :value="t">{{ epics.find(e => e.tag === t)?.label }}</option>
              </select>
              <select :class="[field, 'min-w-0 flex-1']" :aria-label="`Milestone for ${c.task.task_id}`" :disabled="board.readOnly || !milestones.length" :value="milestoneOf(c.tags)" @change="place(c.task.task_id, 'milestone', ($event.target as HTMLSelectElement).value)">
                <option value="">{{ milestones.length ? 'Milestone…' : 'No milestones yet' }}</option>
                <option v-for="t in target(milestones)" :key="t" :value="t">{{ milestones.find(m => m.tag === t)?.label }}</option>
              </select>
            </div>
          </li>
        </ul>
      </section>
    </main>
  </div>
</template>
