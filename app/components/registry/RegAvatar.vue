<script setup lang="ts">
// Agent monogram from the board's avatar table (types/board.ts), named from the registry.
const props = withDefaults(defineProps<{ id: string, size?: number }>(), { size: 32 })
const registry = useRegistryStore()
const avatar = computed(() => registry.avatarOf(props.id))
</script>

<template>
  <span
    :title="registry.nameOf(id)"
    role="img"
    :aria-label="registry.nameOf(id)"
    class="inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white"
    :style="{ width: `${size}px`, height: `${size}px`, background: avatar.color, fontSize: `${Math.max(12, Math.round(size * 0.37))}px` }"
  >{{ avatar.mono }}</span>
</template>
