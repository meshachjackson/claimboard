<script setup lang="ts">
// Tag chip for one attribute. A blank value reads "<what> unknown" with a dotted border.
const props = defineProps<{ what: string, value: string }>()
const known = computed(() => !!props.value)
</script>

<template>
  <span
    class="inline-flex items-center rounded px-1.5 py-0.5 text-xs whitespace-nowrap"
    :class="known ? 'bg-chip font-mono font-medium text-text2' : 'text-text3'"
    :style="{ border: known ? '1px solid var(--color-chip)' : '1px dotted var(--color-dash)' }"
  >{{ known ? value : `${what} unknown` }}</span>
</template>
