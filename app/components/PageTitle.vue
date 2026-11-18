<script setup lang="ts">
import { orchestratorName } from '~/types/board'
// The page's name at the left of its header, in the display face. The rail (desktop) and tabs (phone) carry the
// app's places, so headers no longer repeat them. While the rail is hidden, the button that brings it back sits here.
const props = defineProps<{ label?: string }>()
const route = useRoute()

const TITLES: [string, string][] = [
  ['/board', 'Board'], ['/agents', 'Agents'], ['/registry', 'Agents'], ['/orchestrator', orchestratorName()], ['/shipped', 'Shipped'], ['/report', 'Report'],
  ['/plan', 'Plan'], ['/sketch', 'Sketch'], ['/settings', 'Settings'], ['/access', 'Access'], ['/help', 'Help'], ['/api', 'API'], ['/changelog', 'Changelog']
]
const title = computed(() => props.label ?? TITLES.find(([p]) => route.path.startsWith(p))?.[1] ?? 'Floor')
// The tab title is the page heading, so both match the nav label.
useHead({ title: () => title.value })
</script>

<template>
  <div class="flex flex-none items-center gap-1.5">
    <RailShow />
    <h1 class="m-0 font-display text-[26px] leading-none font-bold whitespace-nowrap text-ink">{{ title }}</h1>
  </div>
</template>
