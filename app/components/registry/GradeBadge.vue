<script setup lang="ts">
// Grade badge: 11px, after the field label, never inside the value. Words plus a border style, never color alone.
import type { Grade } from '~/types/registry'
import { GRADE_STYLES } from '~/types/registry'

const props = withDefaults(defineProps<{ grade: Grade, size?: 'sm' | 'md' }>(), { size: 'sm' })
const style = computed(() => GRADE_STYLES[props.grade] ?? GRADE_STYLES.unknown)
</script>

<template>
  <span
    class="inline-flex items-center gap-0.5 rounded font-semibold whitespace-nowrap"
    :class="size === 'sm' ? 'px-1.5 py-px text-xs' : 'px-2 py-0.5 text-xs'"
    :style="{ background: style.bg, color: style.fg, border: style.border }"
  >
    <span v-if="style.mark" aria-hidden="true">{{ style.mark }}</span>{{ style.label }}
  </span>
</template>
