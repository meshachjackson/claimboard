<script setup lang="ts">
// Message text with each card id as a link that opens the card over the current page (?task=, the same
// key the Floor and Agents pages use).
import { linkCardIds } from '~/utils/orchestratorThread'

const props = defineProps<{ text: string }>()
const route = useRoute()
const parts = computed(() => linkCardIds(props.text))
const openTo = (id: string) => ({ path: route.path, query: { ...route.query, task: id } })
</script>

<template>
  <span class="whitespace-pre-wrap"><template v-for="(p, i) in parts" :key="i"><NuxtLink v-if="'card' in p" :to="openTo(p.card)" class="font-mono text-[0.92em] text-ink underline">{{ p.card }}</NuxtLink><template v-else>{{ p.text }}</template></template></span>
</template>
