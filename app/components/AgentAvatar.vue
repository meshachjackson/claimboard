<script setup lang="ts">
// Monogram avatar. Blank or pool:* assignees show the dashed "unassigned" circle.
import { isPool } from '~/utils/rollup'

const props = withDefaults(defineProps<{ id: string, size?: number }>(), { size: 24 })
const board = useBoardStore()

const unassigned = computed(() => !props.id || isPool(props.id))
const avatar = computed(() => board.avatarOf(props.id))
const name = computed(() => unassigned.value ? `Unassigned${props.id ? ` · ${board.nameOf(props.id)}` : ''}` : board.nameOf(props.id))
</script>

<template>
  <span
    v-if="unassigned"
    :title="name"
    role="img"
    :aria-label="name"
    class="inline-block shrink-0 rounded-full border border-dashed border-dash"
    :style="{ width: `${size - 2}px`, height: `${size - 2}px` }"
  />
  <span
    v-else
    :title="name"
    role="img"
    :aria-label="name"
    class="inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white"
    :style="{ width: `${size}px`, height: `${size}px`, background: avatar.color, fontSize: `${Math.max(12, Math.round(size * 0.37))}px` }"
  >{{ avatar.mono }}</span>
</template>
