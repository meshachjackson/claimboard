<script setup lang="ts">
// Fleet's Display controls in the filter panel: Swimlanes (Off | Host | Domain) and Show retired.
const { query, set } = useRegistryFilters()
const lanes = [['none', 'Off'], ['host', 'Host'], ['domain', 'Domain']] as const
</script>

<template>
  <div class="ab-display-item flex flex-col gap-1.5">
    <span id="rg-lanes" class="text-xs text-text3">Swimlanes</span>
    <div role="group" aria-labelledby="rg-lanes" class="ab-seg">
      <button v-for="l in lanes" :key="l[0]" type="button" :aria-pressed="query.lanes === l[0]" @click="set({ lanes: l[0] === 'none' ? '' : l[0] })">{{ l[1] }}</button>
    </div>
  </div>
  <div class="ab-display-item flex h-8 items-center gap-2.5">
    <span id="rg-retired" class="flex-1 text-[13px]">Show retired</span>
    <ToggleSwitch :on="query.retired" labelledby="rg-retired" @toggle="set({ retired: !query.retired })" />
  </div>
</template>
