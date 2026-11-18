<script setup lang="ts">
// The way back to a hidden sidebar: a button at the left of every page header, drawn only while the rail is hidden.
const settings = useSettings()
const isPhone = useIsPhone()
</script>

<template>
  <button
    v-if="settings.railHidden.value && !isPhone"
    type="button"
    aria-label="Show sidebar"
    title="Show sidebar ( [ )"
    class="-ml-1.5 inline-flex size-10 flex-none cursor-pointer items-center justify-center rounded text-ink hover:bg-(--ab-row-hover)"
    @click="settings.setRailHidden(false)"
  >
    <UIcon name="i-lucide-panel-left-open" class="size-5" />
  </button>
</template>
