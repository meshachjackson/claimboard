<script setup lang="ts">
// "Find duplicates": lists cards with the same title. Per group the owner picks the keeper, sees a preview of what would happen to
// each other card, and confirms. Nothing is closed or archived before that confirm. One group at a time.
import { findDupes, planMerge, suggestKeeper } from '~/utils/dupes'
import { formatDate } from '~/utils/format'

const open = defineModel<boolean>('open', { default: false })
const board = useBoardStore()
const toast = useToast()

const groups = computed(() => open.value ? findDupes(board.tasks) : [])
// Keeper picked per group (keyed by the group's oldest task_id); unpicked groups use the suggestion.
const picked = ref<Record<string, string>>({})
// The group whose preview is waiting for the confirm click.
const confirming = ref('')
const busy = ref(false)

type Group = typeof groups.value[number]
const groupKey = (g: Group) => g[0]!.task_id
const keeperOf = (g: Group) => picked.value[groupKey(g)] ?? suggestKeeper(g)
const planOf = (g: Group) => planMerge(g, board.steps, keeperOf(g))

function pick(g: Group, id: string) {
  picked.value[groupKey(g)] = id
  confirming.value = ''
}

async function merge(g: Group) {
  const plan = planOf(g)
  busy.value = true
  const ok = await board.mergeDupes(plan)
  busy.value = false
  confirming.value = ''
  if (ok) toast.add({ title: `Merged into ${plan.keeper}`, color: 'neutral' })
  else toast.add({ title: 'Merge stopped', description: board.lastRefusal?.reason ?? 'The gateway refused a step.', color: 'error' })
}
</script>

<template>
  <UModal v-model:open="open" title="Find duplicates" description="Cards with the same title. Nothing changes until you confirm a merge." :ui="{ content: 'sm:max-w-2xl' }">
    <template #body>
      <p v-if="!groups.length" class="m-0 text-sm text-text2">No duplicates found.</p>
      <fieldset v-for="g in groups" :key="groupKey(g)" class="m-0 mb-4 flex flex-col gap-1.5 rounded-lg border border-line p-3">
        <legend class="px-1 text-[13px] font-semibold text-ink">{{ g[0]!.title }}</legend>
        <label v-for="t in g" :key="t.task_id" class="flex cursor-pointer items-center gap-2 text-[13px] text-text2">
          <input type="radio" :name="groupKey(g)" :value="t.task_id" :checked="keeperOf(g) === t.task_id" @change="pick(g, t.task_id)">
          <span class="font-semibold text-ink">{{ t.task_id }}</span>
          <span>{{ t.work_state }}, created {{ formatDate(t.created_at) }}{{ t.pinned_at ? ', pinned' : '' }}</span>
        </label>

        <template v-if="confirming === groupKey(g)">
          <ul class="m-0 mt-1 list-none p-0 text-[13px] text-text2">
            <li>Keeps <b class="text-ink">{{ planOf(g).keeper }}</b> and adds a note naming what was merged.</li>
            <li v-for="r in planOf(g).remove" :key="r.task.task_id">
              <b class="text-ink">{{ r.task.task_id }}</b> goes to Done and is archived<template v-if="r.cancel.length">, after cancelling {{ r.cancel.length }} open step(s)</template>.
            </li>
            <li v-for="k in planOf(g).kept" :key="k.task.task_id">
              <b class="text-ink">{{ k.task.task_id }}</b> stays on the board ({{ k.reason }}).
            </li>
            <li>Rows are not deleted; they stay in the tables.</li>
          </ul>
          <div class="mt-1 flex gap-2">
            <button type="button" :disabled="busy" class="h-8 cursor-pointer rounded-lg bg-ink px-3 text-[13px] font-semibold text-surface disabled:opacity-50" @click="merge(g)">
              Confirm merge
            </button>
            <button type="button" :disabled="busy" class="h-8 cursor-pointer rounded-lg border border-line px-3 text-[13px] font-semibold text-ink" @click="confirming = ''">
              Cancel
            </button>
          </div>
        </template>
        <button
          v-else
          type="button"
          :disabled="busy || !planOf(g).remove.length"
          class="mt-1 h-8 cursor-pointer self-start rounded-lg bg-ink px-3 text-[13px] font-semibold text-surface disabled:opacity-50"
          @click="confirming = groupKey(g)"
        >
          {{ planOf(g).remove.length ? `Preview merge into ${keeperOf(g)}` : 'Nothing can be removed here' }}
        </button>
      </fieldset>
    </template>
  </UModal>
</template>
