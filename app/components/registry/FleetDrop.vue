<script setup lang="ts">
// One Fleet drop zone. Dropping a card here never moves it: it opens the lifecycle gate sheet,
// and the card snaps back until the owner approves the move (design rule 4).
import { nextTick, ref, watch } from 'vue'
import { VueDraggable, type SortableEvent } from 'vue-draggable-plus'
import type { AgentView } from '~/stores/registry'

const props = defineProps<{ views: AgentView[], disabled?: boolean }>()
const emit = defineEmits<{ drop: [agentId: string], open: [agentId: string] }>()

// vue-draggable-plus needs a mutable list. Both sides re-sync from props after a drag,
// because the store doesn't change when a card is dropped.
const list = ref<AgentView[]>([...props.views])
watch(() => props.views, v => { list.value = [...v] })
const resync = () => nextTick(() => { list.value = [...props.views] })

function onAdd(evt: SortableEvent) {
  const id = (evt.item as HTMLElement).dataset.id
  resync()
  if (id) emit('drop', id)
}
</script>

<template>
  <VueDraggable
    v-model="list"
    group="agents"
    :sort="false"
    :disabled="disabled"
    :animation="150"
    :force-fallback="true"
    :fallback-tolerance="4"
    ghost-class="opacity-40"
    class="flex min-h-[60px] flex-col gap-2.5"
    @add="onAdd"
    @remove="resync"
  >
    <RegistryAgentCard
      v-for="v in list"
      :key="v.row.agent_id"
      :view="v"
      :class="!disabled && 'cursor-grab active:cursor-grabbing'"
      @open="emit('open', $event)"
    />
  </VueDraggable>
</template>
