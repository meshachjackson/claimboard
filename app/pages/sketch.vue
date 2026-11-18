<script setup lang="ts">
// Sketch boards: a blank board with columns you design, used to riff on a feature or idea. Notes stay in
// this browser until "Save as project". Saving writes each note as a real card (project_id = the board's name, column in
// a col- tag), so the cards show on the main board. A saved sketch then shows its live cards, grouped by column.
import type { Sketch } from '~/utils/planning'
import { COLUMN_PREFIX, DEFAULT_SKETCH_COLUMNS, sketchProject, slugify } from '~/utils/planning'

const board = useBoardStore()
const plan = usePlanning()

const route = useRoute()
const router = useRouter()
const openId = computed(() => plan.sketches.value.find(s => s.id === route.query.sketch)?.id ?? '')
const sketch = computed(() => plan.sketches.value.find(s => s.id === openId.value))
const pick = (id: string) => router.replace({ query: id ? { sketch: id } : {} })

const newName = ref('')
function create() {
  const name = newName.value.trim()
  if (!name) return
  const s: Sketch = { id: `sk-${Date.now().toString(36)}`, name, columns: [...DEFAULT_SKETCH_COLUMNS], notes: [], saved: false }
  plan.putSketch(s)
  newName.value = ''
  pick(s.id)
}

function remove(s: Sketch) {
  // A saved sketch keeps its cards on the main board; only the board layout goes.
  plan.removeSketch(s.id)
  pick('')
}

// ---- Columns ----
const newColumn = ref('')
function addColumn(s: Sketch) {
  const name = newColumn.value.trim()
  if (!name || s.columns.some(c => slugify(c) === slugify(name))) return
  plan.putSketch({ ...s, columns: [...s.columns, name] })
  newColumn.value = ''
}
function removeColumn(s: Sketch, col: string) {
  if (s.columns.length < 2) return
  const rest = s.columns.filter(c => c !== col)
  // Draft notes in the removed column move to the first one. Saved cards without a matching column show there too.
  plan.putSketch({ ...s, columns: rest, notes: s.notes.map(n => n.col === col ? { ...n, col: rest[0]! } : n) })
}

// ---- Draft notes (before saving) ----
const drafts = reactive<Record<string, string>>({})
function addNote(s: Sketch, col: string) {
  const text = (drafts[col] ?? '').trim()
  if (!text) return
  plan.putSketch({ ...s, notes: [...s.notes, { text, col }] })
  drafts[col] = ''
}
const moveNote = (s: Sketch, i: number, col: string) => plan.putSketch({ ...s, notes: s.notes.map((n, j) => j === i ? { ...n, col } : n) })
const dropNote = (s: Sketch, i: number) => plan.putSketch({ ...s, notes: s.notes.filter((_, j) => j !== i) })
const clearNotes = (s: Sketch) => plan.putSketch({ ...s, notes: [] })

// ---- Save as project ----
const saving = ref(false)
async function saveProject(s: Sketch) {
  saving.value = true
  try {
    const project = sketchProject(s)
    const left = []
    for (const n of s.notes) {
      const id = await board.createTask({ title: n.text.slice(0, 200), project_id: project, tags: COLUMN_PREFIX + slugify(n.col), original_request: `Sketched on the "${s.name}" board, column ${n.col}.` })
      if (!id) left.push(n)
    }
    // Notes that failed stay as drafts so nothing is lost; the board is saved once every note is a card.
    plan.putSketch({ ...s, notes: left, saved: left.length === 0 })
  } finally {
    saving.value = false
  }
}

// ---- Saved sketch: live cards ----
const liveCards = computed(() => sketch.value?.saved ? board.cards.filter(c => c.task.project_id === sketchProject(sketch.value!) && !c.archived) : [])
function cardsIn(s: Sketch, col: string) {
  const known = new Set(s.columns.map(c => COLUMN_PREFIX + slugify(c)))
  return liveCards.value.filter((c) => {
    const tag = c.tags.find(t => t.startsWith(COLUMN_PREFIX))
    return tag === COLUMN_PREFIX + slugify(col) || (col === s.columns[0] && (!tag || !known.has(tag)))
  })
}
async function moveCard(taskId: string, col: string) {
  const card = board.cards.find(c => c.task.task_id === taskId)
  if (!card) return
  const rest = card.tags.filter(t => !t.startsWith(COLUMN_PREFIX))
  await board.updateTask(taskId, { tags: [...rest, COLUMN_PREFIX + slugify(col)].join(',') })
}
async function addCard(s: Sketch, col: string) {
  const text = (drafts[col] ?? '').trim()
  if (!text) return
  drafts[col] = ''
  await board.createTask({ title: text.slice(0, 200), project_id: sketchProject(s), tags: COLUMN_PREFIX + slugify(col), original_request: `Added on the "${s.name}" board, column ${col}.` })
}

const field = 'h-9 rounded-lg border border-input bg-surface px-2.5 text-sm text-ink'
const btn = 'h-9 cursor-pointer rounded-lg bg-ink px-4 text-sm font-semibold text-surface disabled:opacity-50'
const ghost = 'h-9 cursor-pointer rounded-lg border border-line px-3 text-sm font-semibold text-text2 hover:bg-chip disabled:opacity-50'
</script>

<template>
  <div class="flex min-h-dvh flex-col">
    <header class="sticky top-0 z-20 flex min-h-14 items-stretch gap-6 border-b-2 border-rule bg-ground px-5">
      <PageTitle class="self-center" />
      <PageTabs :tabs="[{ to: '/plan', label: 'Plan' }, { to: '/sketch', label: 'Sketch' }]" />
    </header>

    <main class="flex flex-col gap-5 px-6 pt-6 pb-16">
      <section aria-label="Sketch boards" class="flex flex-wrap items-center gap-2">
        <button v-for="s in plan.sketches.value" :key="s.id" type="button" :aria-pressed="s.id === openId" class="h-9 cursor-pointer rounded-full border px-3 text-sm" :class="s.id === openId ? 'border-ink font-semibold' : 'border-line text-text2'" @click="pick(s.id)">
          {{ s.name }}<span v-if="s.saved" class="ml-1.5 text-xs text-text3">project</span>
        </button>
        <form class="ml-auto flex gap-2" aria-label="New blank board" @submit.prevent="create">
          <input v-model="newName" :class="field" placeholder="New board name" aria-label="New board name">
          <button type="submit" :disabled="!newName.trim()" :class="btn">New blank board</button>
        </form>
      </section>

      <p v-if="!sketch" class="m-0 text-sm text-text3">
        A sketch board is a blank pad with columns you choose. Add notes, move them around, then save it as a project: each note becomes a card on the main board.
      </p>

      <template v-else>
        <section class="flex flex-wrap items-center gap-2" :aria-label="`${sketch.name} actions`">
          <h2 class="m-0 text-lg font-bold">{{ sketch.name }}</h2>
          <span v-if="sketch.saved" class="text-sm text-text3">Project <code>{{ sketchProject(sketch) }}</code> · its cards are on the main board</span>
          <span v-else class="text-sm text-text3">Draft · notes stay in this browser until you save</span>
          <span class="flex-1" />
          <NuxtLink v-if="sketch.saved" :to="{ path: '/board', query: { project: sketchProject(sketch) } }" :class="[ghost, 'inline-flex items-center no-underline']">Open on main board</NuxtLink>
          <button v-if="!sketch.saved" type="button" :disabled="!sketch.notes.length || saving || board.readOnly" :class="btn" @click="saveProject(sketch)">{{ saving ? 'Saving…' : 'Save as project' }}</button>
          <button v-if="!sketch.saved" type="button" :disabled="!sketch.notes.length" :class="ghost" @click="clearNotes(sketch)">Clear board</button>
          <button type="button" :class="ghost" @click="remove(sketch)">Delete board</button>
        </section>

        <div class="flex items-start gap-4 overflow-x-auto">
          <section v-for="col in sketch.columns" :key="col" :aria-label="col" class="flex w-[272px] flex-none flex-col gap-2.5 rounded-xl bg-lane p-2">
            <header class="flex items-center gap-2 px-1">
              <h3 class="m-0 text-[13px] font-bold tracking-[0.06em] text-text2 uppercase">{{ col }}</h3>
              <span class="rounded-full bg-(--ab-neutral-strong) px-2 py-px font-mono text-xs text-text2">{{ sketch.saved ? cardsIn(sketch, col).length : sketch.notes.filter(n => n.col === col).length }}</span>
              <button v-if="sketch.columns.length > 1" type="button" class="ml-auto cursor-pointer text-xs text-text3 underline" :aria-label="`Remove column ${col}`" @click="removeColumn(sketch, col)">Remove</button>
            </header>

            <template v-if="!sketch.saved">
              <article v-for="(n, i) in sketch.notes" v-show="n.col === col" :key="i" class="flex flex-col gap-1.5 rounded-lg border border-line bg-surface p-2.5 text-sm">
                {{ n.text }}
                <span class="flex items-center gap-2">
                  <select :value="n.col" :class="[field, 'h-7 flex-1 text-xs']" :aria-label="`Move note ${n.text}`" @change="moveNote(sketch, i, ($event.target as HTMLSelectElement).value)">
                    <option v-for="c in sketch.columns" :key="c" :value="c">{{ c }}</option>
                  </select>
                  <button type="button" class="cursor-pointer text-xs text-text3 underline" @click="dropNote(sketch, i)">Delete</button>
                </span>
              </article>
              <form @submit.prevent="addNote(sketch, col)">
                <input v-model="drafts[col]" :class="[field, 'w-full']" placeholder="Add a note" :aria-label="`Add a note to ${col}`">
              </form>
            </template>

            <template v-else>
              <article v-for="c in cardsIn(sketch, col)" :key="c.task.task_id" class="flex flex-col gap-1.5 rounded-lg border border-line bg-surface p-2.5 text-sm">
                <NuxtLink :to="{ path: '/board', query: { task: c.task.task_id } }" class="text-ink no-underline">
                  <span class="font-mono text-xs text-text3">{{ c.task.task_id }}</span> {{ c.task.title }}
                </NuxtLink>
                <select :value="col" :class="[field, 'h-7 text-xs']" :disabled="board.readOnly" :aria-label="`Move ${c.task.task_id}`" @change="moveCard(c.task.task_id, ($event.target as HTMLSelectElement).value)">
                  <option v-for="o in sketch.columns" :key="o" :value="o">{{ o }}</option>
                </select>
              </article>
              <form @submit.prevent="addCard(sketch, col)">
                <input v-model="drafts[col]" :class="[field, 'w-full']" placeholder="Add a card" :disabled="board.readOnly" :aria-label="`Add a card to ${col}`">
              </form>
            </template>
          </section>

          <form class="flex w-[220px] flex-none gap-2" aria-label="New column" @submit.prevent="addColumn(sketch)">
            <input v-model="newColumn" :class="[field, 'min-w-0 flex-1']" placeholder="New column" aria-label="New column name">
            <button type="submit" :disabled="!newColumn.trim()" :class="ghost">Add</button>
          </form>
        </div>
      </template>
    </main>
  </div>
</template>
