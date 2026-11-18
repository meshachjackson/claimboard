<script setup lang="ts">
// An on/off switch with role="switch". `phone` is the 44 × 26 size of the phone sheet.
defineProps<{ on: boolean, labelledby: string, phone?: boolean, disabled?: boolean }>()
const emit = defineEmits<{ toggle: [] }>()
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="on"
    :aria-labelledby="labelledby"
    :disabled="disabled"
    class="relative flex-none cursor-pointer rounded-full p-0 after:absolute after:-inset-y-0.5 after:inset-x-0 after:content-[''] max-md:after:-inset-x-1 max-md:after:-inset-y-3 disabled:cursor-not-allowed disabled:opacity-40"
    :class="phone ? 'h-[26px] w-11' : 'h-5 w-9'"
    :style="{ background: on ? 'var(--color-accent)' : 'var(--color-input)' }"
    @click="emit('toggle')"
  >
    <span
      class="absolute rounded-full bg-white transition-[left] duration-150 motion-reduce:transition-none"
      :class="phone ? 'top-[3px] size-5' : 'top-0.5 size-4'"
      :style="{ left: on ? (phone ? '21px' : '18px') : (phone ? '3px' : '2px') }"
    />
  </button>
</template>
