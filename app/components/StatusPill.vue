<script setup lang="ts">
import type { PillStyle } from '~/types/board'

withDefaults(defineProps<{ pill: PillStyle, large?: boolean }>(), { large: false })
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 rounded-full font-semibold whitespace-nowrap"
    :class="large ? 'px-2.5 py-[3px] text-[13px]' : 'px-2 py-0.5 text-xs'"
    :style="{ background: pill.bg, color: pill.fg, border: pill.border }"
  >
    <span
      aria-hidden="true"
      class="rounded-full"
      :class="[pill.pulse && 'ab-pulse', large ? 'size-2' : 'size-[7px]']"
      :style="{ background: pill.dot }"
    />
    {{ pill.label }}
  </span>
</template>
