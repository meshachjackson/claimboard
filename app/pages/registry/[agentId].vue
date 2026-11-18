<script setup lang="ts">
// Full agent page for deep links: /registry/agt-<name>. Same panel as the drawer.
const route = useRoute()
const { setTab } = useRegistryUi()
const agentId = computed(() => String(route.params.agentId))
const tab = computed(() => typeof route.query.tab === 'string' ? route.query.tab : 'overview')
useHead({ title: () => `${agentId.value} · Agents` })
</script>

<template>
  <RegistryShell v-slot="{ phone }">
    <main class="mx-auto flex w-full max-w-[1040px] flex-1 flex-col" :class="phone ? '' : 'px-6 pt-7 pb-16'">
      <RegistryBreadcrumb :agent-id="agentId" />
      <div class="overflow-hidden bg-surface">
        <RegistryAgentPanel :agent-id="agentId" :tab="tab" :phone="phone" page @tab="setTab" />
      </div>
    </main>
  </RegistryShell>
</template>
