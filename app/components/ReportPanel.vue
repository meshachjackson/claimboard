<script setup lang="ts">
// The frame every report section shares: an icon chip, the title with its count, one sentence, and an optional action.
// A pinned finding outlines its section in its own accent.
defineProps<{
  id?: string
  title: string
  summary: string
  look: { accent: string, bg: string, glyph: string }
  count?: number
  pinned?: boolean
}>()
</script>

<template>
  <section :id="id" class="rounded-[14px] border bg-(--ab-bar)" :class="pinned ? '' : 'border-line'" :style="pinned ? { borderColor: look.accent } : undefined">
    <div class="flex flex-wrap items-start gap-x-3 gap-y-2 px-[18px] pt-4 pb-3">
      <span aria-hidden="true" class="inline-flex size-[30px] flex-none items-center justify-center rounded-lg text-[13px] font-bold" :style="{ background: look.bg, color: look.accent }">{{ look.glyph }}</span>
      <div class="min-w-0 flex-[1_1_240px]">
        <h2 class="m-0 text-[15px] font-bold">
          {{ title }}
          <span v-if="count" class="ml-1 font-mono text-xs" :style="{ color: look.accent }">{{ count }}</span>
        </h2>
        <p class="mt-[3px] mb-0 text-[13px] text-text2">{{ summary }}</p>
      </div>
      <slot name="actions" />
    </div>
    <slot />
  </section>
</template>
