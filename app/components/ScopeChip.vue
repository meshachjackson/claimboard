<script setup lang="ts">
// "This browser" (neutral, monitor icon) or "Everyone" (cobalt, people icon): who a setting changes things for.
defineProps<{ scope: 'browser' | 'everyone' }>()
</script>

<template>
  <span
    class="inline-flex h-[22px] items-center gap-1 rounded-sm px-2 text-xs font-semibold"
    :class="scope === 'everyone' ? 'bg-(--ab-blue-bg) text-(--ab-blue-strong)' : 'bg-(--ab-neutral-bg) text-text2'"
  >
    <UIcon :name="scope === 'everyone' ? 'i-lucide-users' : 'i-lucide-monitor'" class="size-3" />
    {{ scope === 'everyone' ? 'Everyone' : 'This browser' }}
  </span>
</template>
