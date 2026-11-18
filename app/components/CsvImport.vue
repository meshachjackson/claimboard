<script setup lang="ts">
// Import cards from a CSV file, in the way Podio does it: choose a file, see which columns matched which card
// fields, fix the matches by choosing or dragging a column, check the preview, then import. A row with a Task ID updates
// that card; any other row creates one. Both go one card at a time through the board store (createTask, updateTask), so
// the same checks and permissions apply as for a card edited by hand. A create row whose title is already on the board is
// flagged as a duplicate and starts unchecked; the preview's checkboxes decide what is written.
import { parseCsv } from '~~/shared/csv'
import { IMPORT_FIELDS, boardOwner } from '~/types/board'
import type { ImportField } from '~/types/board'
import { buildRows, suggestMapping, tableProblem } from '~/utils/boardCsv'
import { applyProposal } from '~/utils/csvProposal'
import type { Mapping } from '~/utils/csvProposal'

const open = defineModel<boolean>('open', { required: true })
const board = useBoardStore()
const toast = useToast()

const table = ref<string[][]>([])
const problem = ref('')
const mapping = ref<Mapping>(suggestMapping([]))
const dragging = ref(-1) // the CSV column being dragged
// Cards created so far in this run; null when no run is going.
const progress = ref<{ n: number, of: number } | null>(null)

const headers = computed(() => table.value[0] ?? [])
const assignees = computed(() => [boardOwner(), ...board.registry.filter(a => a.lifecycle_status === 'active' && a.agent_type !== 'gateway' && a.switch !== 'off').map(a => a.agent_id)])
const rows = computed(() => (problem.value || !table.value.length ? [] : buildRows(table.value, mapping.value, assignees.value, board.tasks)))
// Lines the user unchecked. Each time the rows change (new file, new match) the duplicates start unchecked and the rest checked.
const unchecked = ref(new Set<number>())
watch(rows, next => { unchecked.value = new Set(next.filter(r => r.duplicate).map(r => r.line)) })
const valid = computed(() => rows.value.filter(r => !r.errors.length))
const ready = computed(() => valid.value.filter(r => !unchecked.value.has(r.line)))
const duplicates = computed(() => rows.value.filter(r => r.duplicate).length)
// Every create row needs a title; an update row is named by its id. With neither column matched nothing can be imported.
const missingTitle = computed(() => mapping.value.title === -1 && mapping.value.task_id === -1)

watch(open, (isOpen) => {
  askToken++ // stops any wait for the agent, whether the dialog just opened or closed
  asking.value = 'idle'
  if (!isOpen) return
  table.value = []
  problem.value = ''
  progress.value = null
})

function toggle(line: number, on: boolean) {
  const next = new Set(unchecked.value)
  if (on) next.delete(line)
  else next.add(line)
  unchecked.value = next
}

async function onFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  table.value = parseCsv(await file.text())
  problem.value = tableProblem(table.value)
  mapping.value = suggestMapping(headers.value)
  proposal.value = null
  void askAgent()
}

// The board manager agent's suggestion (docs/csv-mapping-proposal.md). Loading it replaces the header-name guess;
// the user can still change any match below.
const proposal = ref<{ notes: string, problems: string[] } | null>(null)
function showProposal(text: string) {
  const result = applyProposal(text, headers.value)
  proposal.value = { notes: result.notes, problems: result.problems }
  if (Object.values(result.mapping).some(i => i !== -1)) mapping.value = result.mapping
}
async function onProposal(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (file) showProposal(await file.text())
}

// Asking the agent: the dialog posts the headers and first rows, the agent reads them (GET /api/agent/csv-mapping) and answers,
// and this polls for the answer. The header-name guess stays in place meanwhile. A new file or closing the dialog stops the wait.
const asking = ref<'idle' | 'waiting' | 'timeout'>('idle')
let askToken = 0
async function askAgent() {
  const mine = ++askToken
  asking.value = 'waiting'
  try {
    const { id } = await $fetch<{ id: string }>('/api/board/csv-mapping', { method: 'POST', body: { table: table.value } })
    for (let i = 0; i < 100 && mine === askToken; i++) {
      await new Promise(resolve => setTimeout(resolve, 3000))
      if (mine !== askToken) return
      const { proposal: text } = await $fetch<{ proposal: string | null }>(`/api/board/csv-mapping/${id}`)
      if (text) { showProposal(text); asking.value = 'idle'; return }
    }
  } catch { /* the request failed or expired: fall through to the timeout note */ }
  if (mine === askToken) asking.value = 'timeout'
}

const columnLabel = (i: number) => headers.value[i] || `Column ${i + 1}`
const setColumn = (field: ImportField, value: string) => { mapping.value[field] = Number(value) }
function drop(field: ImportField) {
  if (dragging.value !== -1) mapping.value[field] = dragging.value
  dragging.value = -1
}

const cards = (n: number) => `${n} card${n === 1 ? '' : 's'}`

/** "Create 3 cards in Backlog and update 2 cards": the words the button and the confirm share. */
const summary = computed(() => {
  const creates = ready.value.filter(r => r.action === 'create').length
  const updates = ready.value.length - creates
  return [creates && `create ${cards(creates)} in Backlog`, updates && `update ${cards(updates)}`].filter(Boolean).join(' and ')
})

async function runImport() {
  const todo = ready.value
  if (!todo.length || progress.value) return
  const skipped = rows.value.length - todo.length
  const plural = todo.length === 1 ? '' : 's'
  const what = summary.value.charAt(0).toUpperCase() + summary.value.slice(1)
  if (!confirm(`${what}?${skipped ? ` ${skipped} unchecked row${skipped === 1 ? '' : 's'} or row${skipped === 1 ? '' : 's'} with errors will be skipped.` : ''} This runs at least ${todo.length} write${plural}, one per card.`)) return
  progress.value = { n: 0, of: todo.length }
  for (const row of todo) {
    const ok = row.action === 'update' ? await board.updateTask(row.taskId, row.fields) : !!await board.createTask({ title: '', ...row.fields })
    if (!ok) break
    progress.value = { n: progress.value.n + 1, of: todo.length }
  }
  const n = progress.value.n
  progress.value = null
  if (n === todo.length) {
    toast.add({ title: `Imported ${cards(n)}`, color: 'neutral' })
    open.value = false
  } else {
    toast.add({ title: `Imported ${n} of ${todo.length}`, description: board.lastRefusal?.reason ?? 'Stopped at the first refusal.', color: 'error' })
  }
}

const selectCls = 'h-8 w-full rounded-lg border border-input bg-surface px-2 text-[13px] text-ink'
</script>

<template>
  <UModal v-model:open="open" title="Import cards from CSV" description="Match the file's columns to card fields, check the preview, then import." :ui="{ content: 'sm:max-w-3xl' }">
    <template #body>
      <div class="flex flex-col gap-4">
        <label class="flex flex-col gap-1.5 text-xs font-semibold text-text2">
          CSV file · a Jira, Linear or GitHub Projects export works
          <input type="file" accept=".csv,text/csv" class="text-[13px] font-normal" :disabled="!!progress" @change="onFile">
        </label>
        <p v-if="problem" role="alert" class="m-0 rounded-lg bg-(--ab-red-bg) px-3 py-2 text-[13px] text-(--ab-red-text)">{{ problem }}</p>

        <template v-if="table.length && !problem">
          <section aria-label="Board manager suggestion" class="flex flex-col gap-1.5">
            <p v-if="asking === 'waiting'" role="status" class="m-0 text-[13px] text-text2">Asking the board manager to suggest a mapping, including epics and milestones. The matches below are a name-based guess until it answers.</p>
            <p v-else-if="asking === 'timeout'" role="status" class="m-0 text-[13px] text-text2">The board manager has not answered. You can match the columns yourself, or load its mapping file below.</p>
            <label class="flex flex-col gap-1.5 text-xs font-semibold text-text2">
              Board manager's suggested mapping (arrives here by itself; or load a JSON file)
              <input type="file" accept=".json,application/json" class="text-[13px] font-normal" :disabled="!!progress" @change="onProposal">
            </label>
            <p v-if="proposal?.notes" class="m-0 whitespace-pre-line rounded-lg bg-chip px-3 py-2 text-[13px] text-ink">{{ proposal.notes }}</p>
            <ul v-if="proposal?.problems.length" role="alert" class="m-0 list-disc pl-5 text-[13px] text-(--ab-red-text)">
              <li v-for="p in proposal.problems" :key="p">{{ p }}</li>
            </ul>
          </section>
          <section aria-label="Column matches" class="flex flex-col gap-2">
            <h3 class="m-0 text-xs font-semibold text-text2">Matches · choose a column, or drag one from the list onto a field</h3>
            <div class="flex flex-wrap gap-1.5">
              <span
                v-for="(h, i) in headers"
                :key="i"
                draggable="true"
                class="cursor-grab rounded-full border border-line bg-chip px-2.5 py-0.5 text-xs text-text2"
                @dragstart="dragging = i"
              >{{ columnLabel(i) }}</span>
            </div>
            <div
              v-for="f in IMPORT_FIELDS"
              :key="f.field"
              class="grid grid-cols-[150px_1fr] items-center gap-2 rounded-lg border border-dashed border-transparent px-1"
              :class="dragging !== -1 && 'border-dash bg-filterbar'"
              @dragover.prevent
              @drop.prevent="drop(f.field)"
            >
              <label :for="`csv-${f.field}`" class="text-[13px] text-ink">{{ f.label }}<span v-if="f.required" class="text-(--ab-red-text)"> *</span></label>
              <select :id="`csv-${f.field}`" :value="mapping[f.field]" :class="selectCls" @change="setColumn(f.field, ($event.target as HTMLSelectElement).value)">
                <option :value="-1">Not imported</option>
                <option v-for="(h, i) in headers" :key="i" :value="i">{{ columnLabel(i) }}</option>
              </select>
            </div>
            <p v-if="missingTitle" role="alert" class="m-0 text-[13px] text-(--ab-red-text)">Choose a column for Title (every new card needs one) or for Task ID (to update cards).</p>
          </section>

          <section aria-label="Preview" class="flex flex-col gap-2">
            <h3 class="m-0 text-xs font-semibold text-text2" role="status">
              Preview · {{ ready.length }} checked<template v-if="valid.length - ready.length">, {{ valid.length - ready.length }} unchecked</template><template v-if="rows.length - valid.length">, {{ rows.length - valid.length }} with errors (skipped)</template><template v-if="duplicates"> · {{ duplicates }} with a title already on the board, unchecked unless you check them</template>
            </h3>
            <div class="max-h-64 overflow-auto rounded-lg border border-line">
              <table class="w-full border-collapse text-left text-xs">
                <thead class="sticky top-0 bg-chip text-text2">
                  <tr>
                    <th class="px-2 py-1.5"><span class="sr-only">Import</span></th>
                    <th class="px-2 py-1.5 font-semibold">Line</th>
                    <th class="px-2 py-1.5 font-semibold">Card</th>
                    <th class="px-2 py-1.5 font-semibold">Title</th>
                    <th class="px-2 py-1.5 font-semibold">Project</th>
                    <th class="px-2 py-1.5 font-semibold">Priority</th>
                    <th class="px-2 py-1.5 font-semibold">Result</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="r in rows" :key="r.line" class="border-t border-line align-top" :class="r.errors.length ? 'bg-(--ab-red-bg)' : r.duplicate && 'bg-(--ab-orange-bg)'">
                    <td class="px-2 py-1.5">
                      <input type="checkbox" :aria-label="`Import line ${r.line}`" :checked="!r.errors.length && !unchecked.has(r.line)" :disabled="!!r.errors.length || !!progress" @change="toggle(r.line, ($event.target as HTMLInputElement).checked)">
                    </td>
                    <td class="px-2 py-1.5 font-mono">{{ r.line }}</td>
                    <td class="px-2 py-1.5 font-mono">{{ r.action === 'update' ? r.taskId : 'new' }}</td>
                    <td class="px-2 py-1.5">{{ r.fields.title }}</td>
                    <td class="px-2 py-1.5">{{ r.fields.project_id }}</td>
                    <td class="px-2 py-1.5">{{ r.fields.priority }}</td>
                    <td class="px-2 py-1.5" :class="r.errors.length && 'text-(--ab-red-text)'">
                      {{ r.errors.length ? r.errors.join('; ') : r.duplicate ? `Same title as ${r.duplicate}` : r.action === 'update' ? 'Update' : 'Create' }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </template>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full items-center justify-end gap-2">
        <span v-if="progress" role="status" class="mr-auto text-xs font-semibold text-text2">Creating {{ progress.n }} of {{ progress.of }}…</span>
        <button type="button" class="h-10 cursor-pointer rounded-lg px-4 text-sm font-semibold text-text2 hover:bg-chip" @click="open = false">Cancel</button>
        <button
          type="button"
          :disabled="!ready.length || missingTitle || !!progress"
          class="h-10 cursor-pointer rounded-lg bg-ink px-[18px] text-sm font-semibold text-surface disabled:cursor-not-allowed disabled:opacity-50"
          @click="runImport"
        >
          Import {{ ready.length || '' }} card{{ ready.length === 1 ? '' : 's' }}
        </button>
      </div>
    </template>
  </UModal>
</template>
