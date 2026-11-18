<script setup lang="ts">
// Export and Import. Export downloads the cards the board shows now, filters
// included. Import opens CsvImport. Both are CSV only.
const board = useBoardStore()
const { matches } = useBoardFilters()
const importOpen = ref(false)

const exportAny = useCsvExport()
const exportCards = () => exportAny(board.cards.filter(c => matches(c)), 'The cards shown now, with the current filters.')

// `headless` draws only the import dialog; the ⋯ menu (BoardMenu, PhoneMore) calls these.
const props = defineProps<{ headless?: boolean }>()
defineExpose({ exportCards, openImport: () => { importOpen.value = true } })

const btn = 'ab-ghost inline-flex h-8 cursor-pointer items-center rounded-lg border border-line px-2.5 text-[13px] font-medium disabled:cursor-not-allowed disabled:opacity-50'
</script>

<template>
  <div v-if="!props.headless" class="flex items-center gap-1.5">
    <button type="button" :class="btn" title="Download the cards shown as a CSV file" :disabled="!board.cards.length" @click="exportCards">Export</button>
    <button v-if="!board.readOnly" type="button" :class="btn" title="Create cards from a CSV file" @click="importOpen = true">Import</button>
  </div>
  <CsvImport v-model:open="importOpen" />
</template>
