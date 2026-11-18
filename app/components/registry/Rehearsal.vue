<script setup lang="ts">
// Rehearse before record (design rule 3): the dry run in plain words, then Record as a second click,
// then the pending state. Every Registry write goes through this panel.
import type { RequestDraft } from '~/utils/registry'
import { REQUEST_PATHS, rehearse } from '~/utils/registry'

const props = defineProps<{ draft: RequestDraft, blocked?: boolean, blockedText?: string }>()
const emit = defineEmits<{ recorded: [id: string], back: [] }>()
const registry = useRegistryStore()

const step = ref<'edit' | 'rehearsed' | 'recorded'>('edit')
const recordedId = ref('')
// Re-rehearse after any edit: an old dry run never stands in for a new request.
watch(() => JSON.stringify(props.draft), () => { if (step.value === 'rehearsed') step.value = 'edit' })

const result = computed(() => rehearse(props.draft, registry.registry.map(r => r.agent_id)))
const isCard = computed(() => props.draft.kind === 'upgrade')

function record() {
  if (result.value.errors.length || registry.readOnly) return
  recordedId.value = registry.record(props.draft)
  step.value = 'recorded'
  emit('recorded', recordedId.value)
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <template v-if="step === 'edit'">
      <div class="flex flex-wrap items-center gap-2.5">
        <span class="flex-1 text-xs" :class="blocked ? 'text-(--ab-red-text)' : 'text-text3'">
          {{ blocked ? blockedText : `Rehearse runs ${REQUEST_PATHS[draft.kind]} as a dry run. Nothing is written.` }}
        </span>
        <slot name="secondary" />
        <button
          type="button"
          class="rg-btn rg-btn-ink h-11"
          :disabled="blocked"
          :aria-disabled="blocked"
          @click="step = 'rehearsed'"
        >
          Rehearse request
        </button>
      </div>
    </template>

    <template v-else-if="step === 'rehearsed'">
      <div class="flex flex-col gap-2.5 border-l-[5px] border-dash bg-ground p-3.5">
        <div class="flex items-center gap-2">
          <span class="rounded-sm border border-dashed border-dash bg-surface px-1.5 py-px text-xs font-semibold text-text2">Rehearsal</span>
          <span class="text-[13px] font-semibold">{{ result.errors.length ? `${result.errors.length} validation error${result.errors.length > 1 ? 's' : ''}. Nothing is written.` : 'Dry run passed. Nothing is written yet.' }}</span>
        </div>
        <ul v-if="result.errors.length" class="m-0 flex flex-col gap-1 pl-4.5 text-[13px] text-(--ab-red-text)">
          <li v-for="e in result.errors" :key="e">{{ e }}</li>
        </ul>
        <p class="m-0 text-[13px] text-text2">Recording would add:</p>
        <ul class="m-0 flex flex-col gap-1.5 pl-4.5 text-[13px] leading-[1.45]">
          <li v-for="r in result.rows" :key="r" class="break-words">{{ r }}</li>
          <li v-if="draft.kind === 'register'">The agent shows "Awaiting you" until you approve the review</li>
          <li v-else-if="!isCard && draft.kind !== 'verify_access'">No change to gov_registry or gov_access until you approve</li>
        </ul>
      </div>
      <div class="flex items-center gap-2.5">
        <button type="button" class="rg-btn rg-btn-line h-11" @click="step = 'edit'">Back</button>
        <span class="flex-1" />
        <span v-if="registry.readOnly" class="text-xs text-text3">Live data: recording arrives with gw.gov-registry-write (R2).</span>
        <button
          type="button"
          class="rg-btn rg-btn-ink h-11"
          :disabled="result.errors.length > 0 || registry.readOnly"
          @click="record"
        >
          {{ isCard ? 'Create board card' : 'Record request' }}
        </button>
      </div>
    </template>

    <template v-else>
      <!-- A recorded request waits on the owner, so it carries the amber lamp; a verification is done, so it reads green. -->
      <div class="flex flex-col gap-2 border-l-[5px] bg-ground p-3.5" :class="draft.kind === 'verify_access' ? 'border-(--ab-run)' : 'border-(--ab-amber)'">
        <div class="flex items-center gap-2">
          <span class="rounded-sm px-1.5 py-px text-xs font-semibold" :class="draft.kind === 'verify_access' ? 'bg-(--ab-run) text-(--ab-run-fg)' : 'bg-(--ab-amber) text-(--ab-amber-fg)'">{{ isCard ? 'Waits for approval' : draft.kind === 'verify_access' ? 'Verified' : 'Awaiting you' }}</span>
          <span class="font-mono text-[13px] font-semibold">Recorded as {{ recordedId }}</span>
        </div>
        <p class="m-0 text-[13px] leading-normal text-text2">
          <template v-if="isCard">The upgrade card waits in Backlog for your approval and a manual start (pol-0004). Nothing is published to n8n.</template>
          <template v-else-if="draft.kind === 'verify_access'">The grade reads verified with today's date. The evidence opens from the row.</template>
          <template v-else-if="draft.kind === 'register'">{{ draft.agent_id }} is in the registry as declared and shows "Awaiting you" until you approve the review.</template>
          <template v-else>Nothing changes in the registry until you approve the review. Until then the agent shows "Change requested."</template>
        </p>
      </div>
      <div class="flex items-center gap-2.5">
        <NuxtLink v-if="!isCard && draft.kind !== 'verify_access'" :to="{ path: '/registry/approvals', query: { review: recordedId } }" class="rg-link text-sm">Open in Approvals</NuxtLink>
        <span class="flex-1" />
        <slot name="done" />
      </div>
    </template>
  </div>
</template>
