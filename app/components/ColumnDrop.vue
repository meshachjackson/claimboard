<script setup lang="ts">
// One drop zone (a column, or a column inside a swimlane). Dropping a card here emits its task_id.
import { ref, watch } from 'vue'
import { VueDraggable, type SortableEvent } from 'vue-draggable-plus'
import type { CardView } from '~/stores/board'

const props = defineProps<{ cards: CardView[], disabled: boolean }>()
const emit = defineEmits<{ drop: [taskId: string], open: [taskId: string] }>()

// vue-draggable-plus needs a mutable list; it is re-synced from the store after every change,
// and after every write, so a refused move puts the card back where it was.
const board = useBoardStore()
const list = ref<CardView[]>([...props.cards])
watch([() => props.cards, () => board.writeCount], () => { list.value = [...props.cards] })

function onAdd(evt: SortableEvent) {
  const id = (evt.item as HTMLElement).dataset.id
  if (id) emit('drop', id)
}
</script>

<template>
  <VueDraggable
    v-model="list"
    group="cards"
    :sort="false"
    :disabled="disabled"
    :animation="150"
    :force-fallback="true"
    :fallback-tolerance="4"
    ghost-class="opacity-40"
    class="flex min-h-[100px] flex-col gap-2.5"
    @add="onAdd"
  >
    <TaskCard
      v-for="card in list"
      :key="card.task.task_id"
      :card="card"
      :class="!disabled && 'cursor-grab active:cursor-grabbing'"
      @open="emit('open', $event)"
    />
  </VueDraggable>
</template>
