<script setup lang="ts">
// Templates sit in a collapsed shelf under the columns because they're never in service.
import type { AgentView } from '~/stores/registry'

defineProps<{ views: AgentView[] }>()
const emit = defineEmits<{ open: [agentId: string] }>()
const open = ref(false)
</script>

<template>
  <section aria-label="Templates" class="flex flex-col gap-2.5">
    <button
      type="button"
      :aria-expanded="open"
      class="rg-btn rg-btn-line self-start"
      @click="open = !open"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" :style="{ transform: open ? 'rotate(90deg)' : 'none' }"><path d="M9 6l6 6-6 6" /></svg>
      Templates · {{ views.length }}
      <span class="font-normal text-text2">Reference designs, never in service</span>
    </button>
    <div v-if="open" class="flex flex-wrap gap-3 rounded bg-lane p-2">
      <article v-for="v in views" :key="v.row.agent_id" class="relative flex w-[300px] flex-col gap-2 rounded border border-line bg-(--ab-neutral-soft) p-3">
        <div class="flex items-center gap-2">
          <span aria-hidden="true" class="inline-flex size-7 items-center justify-center rounded-full bg-dash text-xs font-bold text-white">{{ v.avatar.mono }}</span>
          <div class="min-w-0 flex-1">
            <h3 class="m-0 text-sm font-semibold text-text2">
              <button type="button" class="cursor-pointer text-left after:absolute after:inset-0 after:content-['']" @click="emit('open', v.row.agent_id)">{{ v.row.name }}</button>
            </h3>
            <span class="font-mono text-xs text-text3">{{ v.row.agent_id }}</span>
          </div>
          <span class="rounded-sm bg-chip px-1.5 py-px text-xs font-semibold text-text3">Reference only</span>
        </div>
        <p class="rg-clamp m-0 text-xs leading-[1.45] text-text3">{{ v.row.description }}</p>
      </article>
    </div>
  </section>
</template>
