<script setup lang="ts">
// Quiet notice when /api/board can't be read. The last good rows stay on screen.
import { formatTime } from '~/utils/format'

const board = useBoardStore()
</script>

<template>
  <div
    v-if="board.loadError"
    role="status"
    class="border-b border-(--ab-orange-soft-line) bg-(--ab-orange-soft) px-4 py-2 sm:px-6 text-[13px] text-(--ab-orange-strong)"
  >
    Couldn't refresh the board ({{ board.loadError }}).
    <template v-if="board.updatedAt">Showing rows from {{ formatTime(board.updatedAt) }}.</template>
    Use Refresh to try again.
  </div>
  <p v-else-if="!board.loaded" class="m-0 px-4 py-2 text-[13px] text-text3 sm:px-6">Loading the board…</p>
</template>
