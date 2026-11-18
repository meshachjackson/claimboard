<script setup lang="ts">
// A segmented radio group (Theme, Card density, Opens on). The picked option is ink on a ground track, the same
// weight as the rail's current place. Generic over the option ids.
defineProps<{ options: { id: string, label: string }[], modelValue: string, labelledby: string }>()
const emit = defineEmits<{ 'update:modelValue': [id: string] }>()
</script>

<template>
  <div role="radiogroup" :aria-labelledby="labelledby" class="inline-flex w-fit flex-wrap gap-0.5 rounded bg-ground p-[3px]">
    <button
      v-for="o in options"
      :key="o.id"
      type="button"
      role="radio"
      :aria-checked="modelValue === o.id"
      class="inline-flex h-9 max-md:h-11 max-md:min-w-11 justify-center cursor-pointer items-center rounded-[3px] px-3.5 text-sm"
      :class="modelValue === o.id ? 'bg-ink font-semibold text-surface' : 'font-medium text-text2 hover:text-ink'"
      @click="emit('update:modelValue', o.id)"
    >
      {{ o.label }}
    </button>
  </div>
</template>
