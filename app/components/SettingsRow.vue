<script setup lang="ts">
// A Settings row: label and helper text on the left, the control on the right. Below 820px of page width it stacks.
defineProps<{ label: string, help?: string, scope?: 'browser' | 'everyone', labelId?: string }>()
</script>

<template>
  <div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-2 py-4 @max-[820px]:grid-cols-1">
    <div class="min-w-0">
      <div class="flex items-center gap-2">
        <h3 :id="labelId" class="m-0 text-[15px] font-semibold">{{ label }}</h3>
        <ScopeChip v-if="scope" :scope="scope" />
      </div>
      <p v-if="help" class="m-0 mt-0.5 max-w-[60ch] text-sm text-text3">{{ help }}</p>
    </div>
    <div class="flex flex-wrap items-center gap-2 @max-[820px]:justify-self-start"><slot /></div>
  </div>
</template>
