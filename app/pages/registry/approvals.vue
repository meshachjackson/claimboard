<script setup lang="ts">
// Registry · Approvals: review events awaiting the owner, newest first. Approve or Reject with a note.
// In R0 a decision stands in for form.gov-approve-change and stays in this browser.
// Direction B layout (11/1/2026): the queue on the left with each finding cut to three lines, the picked review in full on the
// right (RegistryReviewDetail). On the phone the review opens under its row. Every row waits on the owner, so each carries the
// amber lamp.
import type { ReviewRow } from '~/types/registry'
import { EVENT_LABELS, SEVERITY_STYLES, STATUS_LABELS } from '~/types/registry'
import { dayTime } from '~/utils/registry'

useHead({ title: 'Approvals · Registry' })
const registry = useRegistryStore()
const route = useRoute()
const router = useRouter()
const toast = useToast()

const awaiting = computed(() => registry.awaitingApproval)
const decided = computed(() => registry.reviews.filter(r => (r.status === 'approved' || r.status === 'rejected') && (registry.isLocal(r.review_id) || r.synthetic)).slice(0, 10))
const selected = computed(() => typeof route.query.review === 'string' ? route.query.review : awaiting.value[0]?.review_id ?? '')
const current = computed(() => awaiting.value.find(r => r.review_id === selected.value))

function select(id: string) {
  router.replace({ query: { ...route.query, review: id } })
}
const agentName = (id: string) => registry.agent(id)?.name ?? id

function decide(r: ReviewRow, status: 'approved' | 'rejected', note: string) {
  if (status === 'rejected' && !note) return
  registry.decide(r.review_id, status, note)
  toast.add({ title: `${r.review_id} ${status}`, description: status === 'approved' ? 'The agent\'s flag clears. Access rows stay proposed until deployed and verified.' : 'Nothing changed in the registry.', color: 'neutral' })
  const next = awaiting.value.find(x => x.review_id !== r.review_id)
  router.replace({ query: { ...route.query, review: next?.review_id ?? '' } })
}
</script>

<template>
  <RegistryShell v-slot="{ phone }">
    <main class="mx-auto flex w-full max-w-[1280px] flex-col gap-6" :class="phone ? 'px-4 pt-4 pb-10' : 'px-6 pt-7 pb-16'">
      <div class="rg-head">
        <div class="flex items-baseline gap-3">
          <h2 class="rg-h2">Approvals</h2>
          <span class="rounded-sm px-2 py-0.5 font-display text-[22px] leading-none font-bold" :class="awaiting.length ? 'bg-(--ab-amber) text-(--ab-amber-fg)' : 'text-text3'">{{ awaiting.length }}</span>
        </div>
        <p class="m-0 mt-1.5 text-sm text-text3">Review events waiting for your decision, newest first. Only you can approve them.</p>
      </div>

      <p v-if="!awaiting.length" class="m-0 bg-surface px-5 py-6 text-[15px] text-text2">Inbox clear. Nothing waits for you.</p>

      <div v-else class="grid items-start gap-6" :class="!phone && 'grid-cols-[minmax(300px,2fr)_minmax(0,3fr)]'">
        <ul class="m-0 flex list-none flex-col divide-y divide-line bg-surface p-0" aria-label="Waiting for you">
          <li v-for="r in awaiting" :key="r.review_id" class="border-l-[5px] border-l-(--ab-amber)" :class="r.review_id === selected && 'bg-ground'">
            <button
              type="button"
              :aria-expanded="phone ? r.review_id === selected : undefined"
              :aria-current="!phone && r.review_id === selected ? 'true' : undefined"
              class="flex w-full cursor-pointer flex-col gap-1.5 px-4 py-3 text-left hover:bg-(--ab-row-hover)"
              :class="r.review_id === selected && 'shadow-[inset_0_0_0_2px_var(--color-ink)]'"
              @click="select(r.review_id)"
            >
              <span class="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span class="rounded-sm bg-(--ab-neutral-bg) px-1.5 py-px text-xs font-semibold text-text2">{{ EVENT_LABELS[r.event_type] ?? r.event_type }}</span>
                <span v-if="r.severity && SEVERITY_STYLES[r.severity]" class="rounded-sm px-1.5 py-px text-xs font-semibold" :style="{ background: SEVERITY_STYLES[r.severity]!.bg, color: SEVERITY_STYLES[r.severity]!.fg, border: SEVERITY_STYLES[r.severity]!.border }">{{ SEVERITY_STYLES[r.severity]!.label }}</span>
                <span class="text-[15px] font-semibold">{{ agentName(r.agent_id) }}</span>
                <span v-if="r.synthetic" class="rounded-sm border border-dashed border-dash px-1.5 text-xs text-text3">synthetic</span>
                <span v-if="registry.isLocal(r.review_id)" class="rounded-sm border border-dashed border-dash px-1.5 text-xs text-text3">recorded here</span>
              </span>
              <span class="line-clamp-3 text-sm leading-[1.45] text-text2">{{ r.findings }}</span>
              <span class="flex gap-2 text-xs text-text3"><span class="font-mono">{{ r.review_id }}</span><span>{{ dayTime(r.created_at) }}</span></span>
            </button>
            <div v-if="phone && r.review_id === selected" class="border-t border-line bg-surface px-4 py-4">
              <RegistryReviewDetail :review="r" phone @decide="(status, note) => decide(r, status, note)" />
            </div>
          </li>
        </ul>

        <section v-if="!phone && current" :aria-label="`Review ${current.review_id}`" class="sticky top-20 flex max-h-[calc(100dvh-6rem)] flex-col overflow-y-auto bg-surface">
          <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b-2 border-rule px-5 pt-4 pb-3">
            <h3 class="m-0 font-display text-[24px] leading-none font-bold">{{ agentName(current.agent_id) }}</h3>
            <span class="text-sm text-text2">{{ EVENT_LABELS[current.event_type] ?? current.event_type }}</span>
            <span class="ml-auto font-mono text-xs text-text3">{{ current.review_id }} · {{ dayTime(current.created_at) }}</span>
          </div>
          <div class="px-5 py-5">
            <RegistryReviewDetail :review="current" @decide="(status, note) => decide(current!, status, note)" />
          </div>
        </section>
      </div>

      <section v-if="decided.length" aria-labelledby="ap-decided" class="flex flex-col gap-2">
        <h2 id="ap-decided" class="rg-h3 rg-head">Decided here</h2>
        <ul class="m-0 flex list-none flex-col divide-y divide-line bg-surface p-0 text-sm">
          <li v-for="r in decided" :key="r.review_id" class="flex flex-wrap gap-x-3 gap-y-1 px-4 py-2.5">
            <span class="font-mono text-text2">{{ r.review_id }}</span>
            <span class="font-semibold">{{ STATUS_LABELS[r.status] }}</span>
            <span class="line-clamp-1 min-w-0 flex-1 text-text3">{{ r.findings }}</span>
          </li>
        </ul>
      </section>
    </main>
  </RegistryShell>
</template>
