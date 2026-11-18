<script setup lang="ts">
// A checkbox that picks a card or a table row. It sits in a 44px target on a phone. `state` 'some' shows the
// dash a header checkbox uses when only part of the list is checked.
const props = withDefaults(defineProps<{ checked: boolean, label: string, state?: 'all' | 'some' | 'none', phone?: boolean }>(), { state: undefined, phone: false })
const emit = defineEmits<{ toggle: [shift: boolean] }>()

const box = ref<HTMLInputElement>()
// indeterminate is a DOM property, not an attribute.
watchEffect(() => { if (box.value) box.value.indeterminate = props.state === 'some' })
</script>

<template>
  <!-- z-10 lifts it over the card's click-through overlay. -->
  <label class="relative z-10 inline-flex cursor-pointer items-center justify-center" :class="phone ? 'size-11' : 'size-8'" @click.stop>
    <input
      ref="box"
      type="checkbox"
      :checked="checked"
      :aria-label="label"
      class="size-[18px] cursor-pointer accent-(--color-accent)"
      @click="emit('toggle', ($event as MouseEvent).shiftKey)"
    >
  </label>
</template>
