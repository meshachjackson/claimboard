<script setup lang="ts">
// The keyboard shortcuts dialog (`?`, or ⋯ > Keyboard shortcuts). The list is SHORTCUTS in types/board.ts, which Settings shows too.
import { SHORTCUTS } from '~/types/board'

const open = useShortcutsOpen()
</script>

<template>
  <UModal v-model:open="open" title="Keyboard shortcuts" description="Shortcuts work anywhere in the board when you are not typing, except ⌘K, which works everywhere.">
    <template #body>
      <dl class="m-0 grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-2.5">
        <template v-for="s in SHORTCUTS" :key="s.keys">
          <dt><kbd class="rounded border border-input px-1.5 py-[3px] font-mono text-xs whitespace-pre text-ink">{{ s.keys }}</kbd></dt>
          <dd class="m-0 text-[13px] text-text2">{{ s.action }}</dd>
        </template>
      </dl>
    </template>
  </UModal>
</template>
