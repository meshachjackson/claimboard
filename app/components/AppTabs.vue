<script setup lang="ts">
// Phone navigation (redesign): the four places as bottom tabs, within reach of the thumb.
const { items } = useNav()
</script>

<template>
  <nav aria-label="Main" class="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t-2 border-rule bg-ground pb-[env(safe-area-inset-bottom)]">
    <NuxtLink
      v-for="i in items"
      :key="i.to"
      :to="i.to"
      :aria-current="i.on ? 'page' : undefined"
      class="flex h-[60px] flex-col items-center justify-center gap-0.5 text-[13px] text-ink no-underline"
      :class="i.on ? 'font-bold shadow-[inset_0_3px_0_var(--color-ink)]' : 'font-medium text-text3'"
    >
      <span
        :role="i.text ? 'img' : undefined"
        :aria-label="i.text ? i.hint : undefined"
        :title="i.text ? i.hint : undefined"
        class="flex h-5 min-w-5 items-center justify-center rounded-sm px-1 font-display text-[15px] leading-none font-bold"
        :class="i.lit ? 'bg-(--ab-amber) text-(--ab-amber-fg)' : ''"
      >{{ i.text }}</span>
      {{ i.label }}
    </NuxtLink>
  </nav>
</template>
