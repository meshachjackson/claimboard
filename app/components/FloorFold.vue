<script setup lang="ts">
// A hidden Floor zone, folded to a narrow strip: the lamp color, the count and the name, read top to bottom.
// It stays lit, so a hidden Needs you still shows amber when something waits. The whole strip opens it again.
import type { FloorTone } from '~/utils/floorLook'
import { dimZero, zoneLook } from '~/utils/floorLook'

const props = defineProps<{ tone: FloorTone, count: number, title: string }>()
defineEmits<{ show: [] }>()
</script>

<template>
  <button
    type="button"
    class="flex h-full min-h-[320px] w-full cursor-pointer flex-col items-center gap-4 pt-4 pb-6"
    :class="zoneLook(props.tone, props.count)"
    :aria-label="`Show ${title} (${count})`"
    :title="`Show ${title}`"
    @click="$emit('show')"
  >
    <UIcon name="i-lucide-eye" class="size-5 flex-none" />
    <span class="font-display text-[40px] leading-none font-bold" :class="dimZero(props.tone, props.count)">{{ count }}</span>
    <span class="font-display text-[22px] leading-none font-bold whitespace-nowrap [writing-mode:vertical-rl]">{{ title }}</span>
  </button>
</template>
