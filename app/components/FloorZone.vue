<script setup lang="ts">
// One zone head on the Floor (direction B): a big signal number, the zone's name and one line. The tone is the lamp
// (utils/floorLook.ts). On the Floor page the head also carries the zone's two controls: fill the screen and fold away.
// Agents and Shipped show the head without them.
import type { FloorTone } from '~/utils/floorLook'
import { dimZero, zoneLook } from '~/utils/floorLook'

const props = defineProps<{
  tone: FloorTone, count: number, title: string, line: string, compact?: boolean, to?: string, toLabel?: string
  controls?: boolean, expanded?: boolean, canHide?: boolean
}>()
const emit = defineEmits<{ expand: [], hide: [] }>()

const look = computed(() => zoneLook(props.tone, props.count))
const numberClass = computed(() => dimZero(props.tone, props.count))
const iconBtn = 'inline-flex size-10 flex-none cursor-pointer items-center justify-center rounded text-current hover:bg-black/10 disabled:cursor-not-allowed disabled:opacity-40'
</script>

<template>
  <div class="flex items-end gap-4" :class="[look, compact ? 'px-5 py-3' : 'px-6 pt-5 pb-4']">
    <span class="font-display leading-[0.8] font-bold" :class="[numberClass, compact ? 'text-[56px]' : 'text-[112px]']">{{ count }}</span>
    <div class="min-w-0 flex-1 pb-0.5">
      <h2 class="m-0 font-display leading-none font-bold" :class="compact ? 'text-[24px]' : 'text-[34px]'">{{ title }}</h2>
      <p class="m-0 mt-1.5 text-[15px] font-medium">{{ line }}</p>
    </div>
    <NuxtLink v-if="to" :to="to" class="inline-flex min-h-6 min-w-6 items-end justify-center pb-1 text-sm font-semibold whitespace-nowrap text-current underline-offset-2 hover:underline">{{ toLabel }}</NuxtLink>
    <div v-if="controls" class="flex flex-none gap-0.5 self-start" :class="compact ? '' : '-mt-1 -mr-2'">
      <button
        type="button"
        :class="iconBtn"
        :aria-label="expanded ? 'Show all three zones' : `Fill the screen with ${title}`"
        :title="expanded ? 'Show all zones' : 'Full screen'"
        @click="emit('expand')"
      >
        <UIcon :name="expanded ? 'i-lucide-minimize-2' : 'i-lucide-maximize-2'" class="size-5" />
      </button>
      <button
        v-if="!expanded"
        type="button"
        :class="iconBtn"
        :disabled="!canHide"
        :aria-label="`Hide ${title}`"
        :title="canHide ? 'Hide this zone' : 'One zone stays open'"
        @click="emit('hide')"
      >
        <UIcon name="i-lucide-eye-off" class="size-5" />
      </button>
    </div>
  </div>
</template>
