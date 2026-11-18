<script setup lang="ts">
// Phone header menu, the same groups as the desktop ⋯ menu (BoardMenu): Clean up, Data, then Settings. Keyboard shortcuts
// stay off the phone. "Select cards" shows every card's checkbox, since a phone has no hover.
// The three components render only their dialogs here (headless); this menu opens them through their exposed functions.
import { PLAN_HREF, PLAN_LABEL } from '~/types/board'

const board = useBoardStore()
const selection = useBulkSelection()
const dupes = ref<{ open: () => void } | null>(null)
const csv = ref<{ exportCards: () => void, openImport: () => void } | null>(null)
const triage = ref<{ run: () => void } | null>(null)

const items = computed(() => [
  [
    { label: 'Triage board', icon: 'i-lucide-list-checks', onSelect: () => triage.value?.run() },
    ...(!board.readOnly && board.canUse('archive_task') ? [{ label: 'Find duplicates', icon: 'i-lucide-copy', onSelect: () => dupes.value?.open() }] : [])
  ],
  [
    { label: 'Export CSV', icon: 'i-lucide-download', disabled: !board.cards.length, onSelect: () => csv.value?.exportCards() },
    ...(!board.readOnly ? [{ label: 'Import CSV', icon: 'i-lucide-upload', onSelect: () => csv.value?.openImport() }] : [])
  ],
  [
    ...(!board.readOnly ? [{ label: 'Select cards', icon: 'i-lucide-square-check', onSelect: () => { selection.reveal.value = true } }] : []),
    { label: PLAN_LABEL, icon: 'i-lucide-map', to: PLAN_HREF },
    { label: 'How the board works', icon: 'i-lucide-circle-help', to: '/help' },
    { label: 'What changed', icon: 'i-lucide-history', to: '/changelog' },
    { label: 'Settings', icon: 'i-lucide-settings', to: '/settings' }
  ]
])
</script>

<template>
  <UDropdownMenu :items="items" :content="{ align: 'end' }">
    <button type="button" aria-label="More actions" class="inline-flex size-11 cursor-pointer items-center justify-center rounded-full hover:bg-chip">
      <UIcon name="i-lucide-ellipsis" class="size-5" />
    </button>
  </UDropdownMenu>
  <DupesButton ref="dupes" headless />
  <BoardCsv ref="csv" headless />
  <TriageBoard ref="triage" headless />
</template>
