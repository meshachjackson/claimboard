<script setup lang="ts">
import type { Flag } from '~/utils/registry'
import { FLAG_STYLES } from '~/types/registry'

const props = defineProps<{ flag: Flag }>()
const style = computed(() => FLAG_STYLES[props.flag.kind])
</script>

<template>
  <span
    class="inline-flex items-center rounded px-1.5 py-px text-xs font-semibold whitespace-nowrap"
    :style="{ background: style.bg, color: style.fg, border: style.border }"
  >{{ flag.label }}</span>
</template>
