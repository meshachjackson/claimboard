<script setup lang="ts">
// Mounts the headless board tools once (triage, duplicates, CSV) and tells useBoardTools how to start them.
const tools = useBoardTools()
const dupes = ref<{ open: () => void } | null>(null)
const csv = ref<{ exportCards: () => void, openImport: () => void } | null>(null)
const triage = ref<{ run: () => void } | null>(null)

onMounted(() => {
  tools.value = {
    triage: () => triage.value?.run(),
    dupes: () => dupes.value?.open(),
    exportCsv: () => csv.value?.exportCards(),
    importCsv: () => csv.value?.openImport()
  }
})
</script>

<template>
  <DupesButton ref="dupes" headless />
  <BoardCsv ref="csv" headless />
  <TriageBoard ref="triage" headless />
</template>
