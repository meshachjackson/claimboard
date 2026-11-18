<script setup lang="ts">
// One review awaiting the owner (Approvals): the full findings at a reading width, the agent, remedy and note, what changes,
// then the decision. Approvals shows it beside the list on wide screens and under the picked row on the phone.
import type { ReviewRow } from '~/types/registry'

const props = defineProps<{ review: ReviewRow, phone?: boolean }>()
const emit = defineEmits<{ decide: [status: 'approved' | 'rejected', note: string] }>()
const registry = useRegistryStore()
const { openAgent } = useRegistryUi()

const note = ref('')
watch(() => props.review.review_id, () => { note.value = '' })
const diffs = computed(() => registry.history.filter(h => h.review_id === props.review.review_id))
const agentName = (id: string) => registry.agent(id)?.name ?? id
</script>

<template>
  <div class="flex flex-col gap-5">
    <p class="m-0 max-w-[72ch] text-[15px] leading-normal break-words whitespace-pre-line">{{ review.findings }}</p>

    <dl class="m-0 grid gap-x-4 gap-y-2 text-sm" :class="phone ? 'grid-cols-1' : 'grid-cols-[96px_minmax(0,1fr)]'">
      <dt class="text-text3">Agent</dt>
      <dd class="m-0">
        <button v-if="registry.agent(review.agent_id)" type="button" class="rg-link" @click="openAgent(review.agent_id)">{{ agentName(review.agent_id) }}</button>
        <span v-else class="font-mono">{{ review.agent_id }}</span>
        <span class="font-mono text-text3"> · {{ review.agent_id }}</span>
      </dd>
      <dt class="text-text3">Remedy</dt>
      <dd class="m-0 max-w-[72ch] break-words">{{ review.remedy || 'None given' }}</dd>
      <template v-if="review.note">
        <dt class="text-text3">Note</dt>
        <dd class="m-0 max-w-[72ch] break-words">{{ review.note }}</dd>
      </template>
    </dl>

    <section class="flex flex-col gap-2" aria-label="What changes">
      <h3 class="rg-h3 rg-head">What changes</h3>
      <div v-if="diffs.length" class="overflow-x-auto bg-surface">
        <table class="w-full border-collapse text-left text-sm">
          <thead class="text-xs text-text3">
            <tr class="border-b border-line"><th class="px-3 py-2 font-semibold">Row</th><th class="px-2 py-2 font-semibold">Field</th><th class="px-2 py-2 font-semibold">Now</th><th class="px-2 py-2 font-semibold">After approval</th></tr>
          </thead>
          <tbody>
            <tr v-for="h in diffs" :key="h.history_id" class="border-b border-line align-top last:border-b-0">
              <td class="px-3 py-2 font-mono text-xs">{{ h.row_key }}</td>
              <td class="px-2 py-2 font-mono text-xs">{{ h.field }}</td>
              <td class="px-2 py-2 break-words text-text3 line-through">{{ h.old_value || 'blank' }}</td>
              <td class="px-2 py-2"><span class="rounded-sm bg-(--ab-blue-tint) px-1.5 break-words">{{ h.new_value || 'blank' }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="m-0 text-sm text-text3">No field history on this review.</p>
    </section>

    <div class="flex flex-col gap-3 border-t-2 border-rule pt-4">
      <label class="flex flex-col gap-1.5 text-sm font-semibold text-text2">
        Note (required to reject)
        <textarea v-model="note" rows="2" placeholder="Why, in a sentence" class="w-full resize-y rounded border border-input bg-surface px-2.5 py-2 text-[15px] font-normal text-ink" />
      </label>
      <div class="flex flex-wrap items-center gap-2.5">
        <span class="min-w-48 flex-1 text-sm text-text3">{{ registry.readOnly ? 'Live data: decide in form.gov-approve-change until R2 wires approvals here.' : 'Approving stands in for form.gov-approve-change. Prototype: the decision stays in this browser.' }}</span>
        <button
          type="button"
          class="rg-btn rg-btn-line border-(--ab-red-text)! text-(--ab-red-text)!"
          :class="phone && 'h-11'"
          :disabled="!note.trim() || registry.readOnly"
          :title="note.trim() ? '' : 'Add a note to reject'"
          @click="emit('decide', 'rejected', note.trim())"
        >
          Reject
        </button>
        <button type="button" class="rg-btn rg-btn-ink" :class="phone && 'h-11'" :disabled="registry.readOnly" @click="emit('decide', 'approved', note.trim())">Approve</button>
      </div>
    </div>
  </div>
</template>
