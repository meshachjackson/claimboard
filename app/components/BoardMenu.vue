<script setup lang="ts">
// The ⋯ Board tools menu (Board v4): Clean up (Triage board, Find duplicates), Data (Export, Import), Settings and the
// shortcuts dialog. The desktop twin of PhoneMore. Triage, duplicates and CSV are the three headless components, which
// draw only their dialogs and expose the function this menu calls.
import { TRIAGE_APPLIABLE } from '~/types/board'
import { triageBoard } from '~/utils/triage'

const board = useBoardStore()
const { matches } = useBoardFilters()
const shortcutsOpen = useShortcutsOpen()
const dupes = ref<{ open: () => void } | null>(null)
const csv = ref<{ exportCards: () => void, openImport: () => void } | null>(null)
const triage = ref<{ run: () => void } | null>(null)

// The badge counts findings the triage can apply (close or archive), the same lines "Apply" would offer.
const triageCount = computed(() => triageBoard({ tasks: board.tasks, steps: board.steps, notes: board.notes, registry: board.registry })
  .filter(f => TRIAGE_APPLIABLE.includes(f.action)).length)
const shownCount = computed(() => board.cards.filter(c => matches(c)).length)

const items = computed(() => [
  [
    { label: 'Board report', icon: 'i-lucide-chart-bar', to: '/report' },
    { label: 'Triage board', icon: 'i-lucide-list-checks', slot: 'triage', onSelect: () => triage.value?.run() },
    ...(!board.readOnly && board.canUse('archive_task') ? [{ label: 'Find duplicates', icon: 'i-lucide-copy', onSelect: () => dupes.value?.open() }] : [])
  ],
  [
    { label: 'Export shown as CSV', icon: 'i-lucide-download', slot: 'export', disabled: !shownCount.value, onSelect: () => csv.value?.exportCards() },
    ...(!board.readOnly ? [{ label: 'Import CSV…', icon: 'i-lucide-upload', onSelect: () => csv.value?.openImport() }] : [])
  ],
  [
    { label: 'How the board works', icon: 'i-lucide-circle-help', to: '/help' },
    { label: 'API reference', icon: 'i-lucide-braces', to: '/api' },
    { label: 'What changed', icon: 'i-lucide-history', to: '/changelog' },
    { label: 'Settings', icon: 'i-lucide-settings', to: '/settings', kbds: [','] },
    { label: 'Keyboard shortcuts', icon: 'i-lucide-keyboard', kbds: ['?'], onSelect: () => { shortcutsOpen.value = true } }
  ]
])
</script>

<template>
  <UDropdownMenu :items="items" :content="{ align: 'end' }" :ui="{ content: 'w-60' }">
    <button type="button" aria-label="Board tools" title="Board tools" class="ab-ghost relative inline-flex size-8 cursor-pointer items-center justify-center rounded-lg border border-line">
      <UIcon name="i-lucide-ellipsis" class="size-4" />
      <span v-if="triageCount > 0" aria-hidden="true" class="absolute -top-px -right-px size-2 rounded-full border border-(--ab-bar) bg-(--ab-orange-dot)" />
    </button>
    <template #triage-trailing>
      <span v-if="triageCount > 0" class="rounded-full bg-(--ab-orange-bg) px-1.5 font-mono text-xs text-(--ab-orange-fg)">{{ triageCount }}</span>
    </template>
    <template #export-trailing>
      <span class="font-mono text-xs text-text3">{{ shownCount }}</span>
    </template>
  </UDropdownMenu>
  <DupesButton ref="dupes" headless />
  <BoardCsv ref="csv" headless />
  <TriageBoard ref="triage" headless />
</template>
