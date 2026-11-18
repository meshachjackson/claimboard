<script setup lang="ts">
// Done column cleanup: "Clean up n" archives the Done cards older than ARCHIVE_AFTER_DAYS, "Archive all n" every Done card
// shown. One archive_task per card, in order; it stops at the first refusal. Each card is one n8n execution.
import type { CardView } from '~/stores/board'
import { ARCHIVE_AFTER_DAYS } from '~/types/board'

const props = defineProps<{ cards: CardView[], phone?: boolean }>()
const board = useBoardStore()
const toast = useToast()

// Pinned cards are never offered for cleanup; the gateway refuses them too.
const done = computed(() => props.cards.filter(c => c.workState === 'done' && !c.archived && !c.pinned))
const pinnedKept = computed(() => props.cards.filter(c => c.workState === 'done' && !c.archived && c.pinned).length)
const stale = computed(() => done.value.filter(c => c.stale))
// Cards archived so far in this run, for the button label; null when no run is going.
const progress = ref<{ n: number, of: number } | null>(null)

async function archiveCards(cards: CardView[], what: string) {
  const ids = cards.map(c => c.task.task_id)
  if (!ids.length) return
  const plural = ids.length === 1 ? '' : 's'
  if (!confirm(`Archive ${ids.length} ${what}${plural}? They leave the board; their rows stay in the tables. This runs ${ids.length} write${plural}, one per card.`)) return
  progress.value = { n: 0, of: ids.length }
  for (const id of ids) {
    if (!await board.archive(id)) break
    progress.value = { n: progress.value.n + 1, of: ids.length }
  }
  const n = progress.value.n
  progress.value = null
  if (n === ids.length) toast.add({ title: `Archived ${n} card${n === 1 ? '' : 's'}`, color: 'neutral' })
  else toast.add({ title: `Archived ${n} of ${ids.length}`, description: board.lastRefusal?.reason ?? 'Stopped at the first refusal.', color: 'error' })
}
</script>

<template>
  <div v-if="board.canUse('archive_task') && done.length" class="ml-auto flex items-center gap-1">
    <span v-if="progress" role="status" class="px-2 text-xs font-semibold text-text2">Archiving {{ progress.n }} of {{ progress.of }}…</span>
    <template v-else>
      <button
        v-if="stale.length && stale.length < done.length"
        type="button"
        class="cursor-pointer rounded-md px-2 text-xs font-semibold text-approve hover:bg-chip"
        :class="phone ? 'h-11' : 'h-8'"
        :title="`Archive Done cards older than ${ARCHIVE_AFTER_DAYS} days`"
        @click="archiveCards(stale, `Done card older than ${ARCHIVE_AFTER_DAYS} days`)"
      >
        Clean up {{ stale.length }}
      </button>
      <button
        type="button"
        class="cursor-pointer rounded-md px-2 text-xs font-semibold text-approve hover:bg-chip"
        :class="phone ? 'h-11' : 'h-8'"
        title="Archive every Done card shown"
        @click="archiveCards(done, 'Done card')"
      >
        Archive all {{ done.length }}<template v-if="pinnedKept"> · {{ pinnedKept }} pinned kept</template>
      </button>
    </template>
  </div>
</template>
