<script setup lang="ts">
// The one agent drawer every Registry screen opens (?agent=agt-…&tab=…). On the phone it's a full-height sheet.
defineProps<{ phone?: boolean }>()
const route = useRoute()
const registry = useRegistryStore()
const { closeAgent, setTab } = useRegistryUi()

const agentId = computed(() => typeof route.query.agent === 'string' ? route.query.agent : '')
const tab = computed(() => typeof route.query.tab === 'string' ? route.query.tab : 'overview')
const open = computed({
  get: () => !!agentId.value && !!registry.agent(agentId.value) && !route.path.startsWith('/registry/agt-'),
  set: (v: boolean) => { if (!v) closeAgent() }
})
</script>

<template>
  <USlideover
    v-model:open="open"
    side="right"
    :title="agentId || 'Agent'"
    description="Agent detail"
    :ui="{ content: phone ? 'max-w-none w-full' : 'sm:max-w-[860px] w-full' }"
  >
    <template #content="{ close }">
      <RegistryAgentPanel v-if="agentId" :agent-id="agentId" :tab="tab" :phone="phone" @close="close" @tab="setTab" />
    </template>
  </USlideover>
</template>
