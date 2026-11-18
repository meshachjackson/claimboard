<script setup lang="ts">
// The note thread: agent notes with kind badges, and system lines between hairlines.
// A long note shows its first lines with "Show all", so a wall of technical detail does not bury the ask.
// Quiet mode: each run of automatic status notes (routed, retried, cancelled...) folds into one line that opens on a tap.
import type { GovTaskNote } from '~/types/board'
import { NOTE_KIND_STYLES, statusFoldLabel } from '~/types/board'
import { formatDateTime } from '~/utils/format'

const props = defineProps<{ notes: GovTaskNote[], phone?: boolean }>()
const board = useBoardStore()

// The thread in display order. A note that isn't automatic is a row of its own. A run of consecutive status notes is one
// row with a fold line, showing its notes only while unfolded. Folding never drops a note; the heading still counts it.
interface Row { key: string, run: GovTaskNote[] | null, notes: GovTaskNote[] }
const unfolded = ref(new Set<string>())
const rows = computed<Row[]>(() => {
  const out: Row[] = []
  for (const n of props.notes) {
    const last = out[out.length - 1]
    if (n.kind !== 'status') out.push({ key: n.note_id, run: null, notes: [n] })
    else if (last?.run) last.run.push(n)
    else out.push({ key: n.note_id, run: [n], notes: [] })
  }
  for (const r of out) if (r.run && unfolded.value.has(r.key)) r.notes = r.run
  return out
})
function toggleFold(key: string) {
  const next = new Set(unfolded.value)
  if (!next.delete(key)) next.add(key)
  unfolded.value = next
}

const LONG_NOTE = 400
const open = ref(new Set<string>())
function toggle(id: string) {
  const next = new Set(open.value)
  if (!next.delete(id)) next.add(id)
  open.value = next
}
</script>

<template>
  <div class="flex flex-col gap-3.5">
    <p v-if="notes.length === 0" class="m-0 text-[13px] text-text3">No activity yet.</p>
    <template v-for="r in rows" :key="r.key">
      <div v-if="r.run" class="flex items-center gap-2.5 text-xs text-text3">
        <span aria-hidden="true" class="h-px flex-1 bg-line" />
        <button
          type="button"
          class="cursor-pointer rounded px-1.5 py-0.5 font-semibold hover:bg-chip"
          :aria-expanded="unfolded.has(r.key)"
          @click="toggleFold(r.key)"
        >{{ statusFoldLabel(r.run.length, unfolded.has(r.key)) }} · {{ formatDateTime(r.run[r.run.length - 1]!.created_at) }}</button>
        <span aria-hidden="true" class="h-px flex-1 bg-line" />
      </div>
    <template v-for="n in r.notes" :key="n.note_id">
      <div v-if="n.kind === 'system'" class="flex items-center gap-2.5 text-xs text-text3">
        <span aria-hidden="true" class="h-px flex-1 bg-line" />
        <span class="max-w-[80%] text-center">{{ n.body }} · {{ formatDateTime(n.created_at) }}</span>
        <span aria-hidden="true" class="h-px flex-1 bg-line" />
      </div>
      <div v-else class="flex items-start gap-2.5">
        <AgentAvatar :id="n.author_id" :size="28" aria-hidden="true" />
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-[13px] font-semibold">{{ board.nameOf(n.author_id) }}</span>
            <span
              v-if="NOTE_KIND_STYLES[n.kind]"
              class="rounded px-1.5 py-px text-xs font-semibold"
              :style="{ background: NOTE_KIND_STYLES[n.kind]!.bg, color: NOTE_KIND_STYLES[n.kind]!.fg }"
            >{{ NOTE_KIND_STYLES[n.kind]!.label }}</span>
            <span v-if="board.isSendingNote(n.note_id)" role="status" class="text-xs text-text3">Sending...</span>
            <span v-else class="text-xs text-text3">{{ formatDateTime(n.created_at) }}</span>
          </div>
          <div
            class="leading-normal break-words whitespace-pre-line text-ink"
            :class="[phone ? 'text-[15px]' : 'text-sm', board.isSendingNote(n.note_id) && 'opacity-60', NOTE_KIND_STYLES[n.kind]?.bubble && 'rounded-lg px-3 py-2.5', n.body.length > LONG_NOTE && !open.has(n.note_id) && 'line-clamp-5']"
            :style="{
              background: NOTE_KIND_STYLES[n.kind]?.bubble || 'transparent',
              border: NOTE_KIND_STYLES[n.kind]?.bubbleBorder ? `1px solid ${NOTE_KIND_STYLES[n.kind]!.bubbleBorder}` : undefined
            }"
          >{{ n.body }}</div>
          <button
            v-if="n.body.length > LONG_NOTE"
            type="button"
            class="cursor-pointer self-start text-xs font-semibold text-approve hover:underline"
            :aria-expanded="open.has(n.note_id)"
            @click="toggle(n.note_id)"
          >
            {{ open.has(n.note_id) ? 'Show less' : 'Show all' }}
          </button>
        </div>
      </div>
    </template>
    </template>
  </div>
</template>
