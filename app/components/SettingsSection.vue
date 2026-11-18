<script setup lang="ts">
// One Settings section (direction B): the name in the display face over a 2px rule, who the change touches, one line
// on what the section does, then its rows on a surface panel.
defineProps<{ id: string, title: string, scopes?: ('browser' | 'everyone')[], note?: string }>()
</script>

<template>
  <section :id="id" :aria-labelledby="`${id}-title`" class="scroll-mt-20">
    <header class="border-b-2 border-rule pb-2">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 :id="`${id}-title`" class="m-0 font-display text-[26px] leading-none font-bold">{{ title }}</h2>
        <ScopeChip v-for="s in scopes" :key="s" :scope="s" />
      </div>
      <p v-if="note" class="m-0 mt-1.5 text-sm text-text3">{{ note }}</p>
    </header>
    <div class="flex flex-col divide-y divide-line bg-surface px-5">
      <slot />
    </div>
  </section>
</template>
