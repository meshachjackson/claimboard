<script setup lang="ts">
// The "Find duplicates" button and its dialog. Hidden when the board can't write or the gateway has no archive_task.
const board = useBoardStore()
const open = ref(false)
// `headless` draws only the dialog; the ⋯ menu (BoardMenu, PhoneMore) opens it.
const props = defineProps<{ headless?: boolean }>()
defineExpose({ open: () => { open.value = true } })
</script>

<template>
  <button
    v-if="!props.headless && !board.readOnly && board.canUse('archive_task')"
    type="button"
    class="inline-flex h-8 cursor-pointer items-center rounded-lg border border-line px-2.5 text-[13px] font-semibold text-ink"
    @click="open = true"
  >
    Find duplicates
  </button>
  <DupesModal v-model:open="open" />
</template>
