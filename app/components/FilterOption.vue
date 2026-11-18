<script setup lang="ts">
// One checklist row: a real <label> around a checkbox, a marker, the label, and the faceted count.
// Zero counts show no number. `phone` gives the 44px rows of the phone sheet.
import type { FacetOption } from '~/utils/facets'

defineProps<{ option: FacetOption, phone?: boolean }>()
const emit = defineEmits<{ change: [] }>()
</script>

<template>
  <label
    class="ab-opt flex cursor-pointer items-center rounded-md"
    :class="phone ? 'h-11 gap-3 px-1 text-[15px]' : 'h-7 gap-2 px-1.5 text-[13px]'"
    :style="{ background: option.on ? 'var(--ab-row-on)' : undefined }"
  >
    <input
      type="checkbox"
      class="m-0 flex-none accent-(--color-accent)"
      :class="phone ? 'size-5' : 'size-3.5'"
      :checked="option.on"
      @change="emit('change')"
    >
    <template v-if="option.marker">
      <span
        v-if="option.marker.kind === 'dot'"
        aria-hidden="true"
        class="mx-[3px] size-2 flex-none"
        :class="option.marker.square ? 'rounded-[2px]' : 'rounded-full'"
        :style="option.marker.color ? { background: option.marker.color } : { border: '1px solid var(--color-text3)' }"
      />
      <AgentAvatar v-else-if="option.marker.kind === 'avatar'" :id="option.marker.id" :size="18" aria-hidden="true" />
      <span
        v-else
        aria-hidden="true"
        class="inline-flex size-[18px] flex-none items-center justify-center rounded-[5px] border border-input text-xs font-bold text-text2"
      >{{ option.marker.letter }}</span>
    </template>
    <span
      class="min-w-0 flex-1 truncate"
      :class="option.on ? 'font-semibold text-ink' : option.count ? 'text-text2' : 'text-text3'"
    >{{ option.label }}</span>
    <span class="flex-none font-mono text-text3" :class="phone ? 'text-[13px]' : 'text-xs'">{{ option.count || '' }}</span>
  </label>
</template>
