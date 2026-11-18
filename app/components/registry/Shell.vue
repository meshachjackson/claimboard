<script setup lang="ts">
// Every Registry page: header, load notice, the page, then the shared agent drawer, gate sheet and composer.
const registry = useRegistryStore()
const isPhone = useIsPhone()
const route = useRoute()
const { gate, composer } = useRegistryUi()
const { rewriteLegacy, onFilteredPage } = useRegistryFilters()

// Old ?quick= links open the same view, then the URL is rewritten as ?show=.
watch(() => route.query.quick, () => { if (onFilteredPage.value) rewriteLegacy() }, { immediate: true })

// A link inside a sheet (Open in Approvals, a gate fix) leaves the page: close the sheets with it.
function closeSheets() {
  gate.value = null
  composer.value = null
}
watch(() => route.path, closeSheets)
onMounted(closeSheets)

onMounted(registry.startRefreshing)
onBeforeUnmount(registry.stopRefreshing)
</script>

<template>
  <div class="rg-shell flex min-h-dvh flex-col">
    <RegistryHeader v-if="isPhone" />
    <RegistryBar v-else />
    <div
      v-if="registry.loadError"
      role="status"
      class="border-b border-line border-l-[5px] border-l-(--ab-red) bg-surface px-4 py-2.5 text-sm text-ink sm:px-6"
    >
      Couldn't read the registry ({{ registry.loadError }}). Use Refresh to try again.
    </div>
    <p v-else-if="!registry.loaded" class="m-0 px-4 py-2.5 text-sm text-text3 sm:px-6">Loading the registry…</p>
    <slot v-if="registry.loaded && !registry.loadError" :phone="isPhone" />
    <RegistryAgentDrawer :phone="isPhone" />
    <RegistryGateSheet :phone="isPhone" />
    <RegistryComposer :phone="isPhone" />
  </div>
</template>

<style>
/* Registry classes from the design canvas (docs/design/registry/*.dc.html), moved to direction B on 11/1/2026:
   buttons are 40px, radius 4px; primary is an ink fill (.rg-btn-ink), secondary a 2px ink outline (.rg-btn-line).
   Section heads use the display face, as in Settings and the card panel. */
.rg-clamp {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.rg-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 40px;
  padding: 0 14px;
  border-radius: 4px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.rg-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.rg-btn-ink {
  background: var(--color-ink);
  color: var(--color-surface);
}
.rg-btn-line {
  border: 2px solid var(--color-ink);
  background: var(--color-surface);
  color: var(--color-ink);
}
.rg-btn-line:not(:disabled):hover {
  background: var(--ab-row-hover);
}
.rg-link {
  color: var(--color-accent);
  font-weight: 600;
  cursor: pointer;
}
.rg-link:hover {
  text-decoration: underline;
  text-underline-offset: 2px;
}
/* Registry's selects match the direction B inputs: radius 4px, 14px text. The drawer and sheets teleport out of
   .rg-shell, so they carry .rg-sheet; a bare [role=dialog] would reach the board's dialogs too. */
.rg-shell .ab-select,
.rg-sheet .ab-select {
  border-radius: 4px;
  font-size: 14px;
}
/* Phone: 44px touch targets (spec "Phone"). Sheets teleport out of .rg-shell, hence [role=dialog]. */
@media (max-width: 767px) {
  .rg-btn,
  .rg-shell .ab-select,
  [role='dialog'] .ab-select {
    height: 44px;
  }
}
.rg-h3 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 20px;
  line-height: 1;
  font-weight: 700;
  color: var(--color-ink);
}
/* A page or section head: the display face over a 2px rule (Settings, Plan). */
.rg-head {
  border-bottom: 2px solid var(--color-rule);
  padding-bottom: 8px;
}
.rg-h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 26px;
  line-height: 1;
  font-weight: 700;
  color: var(--color-ink);
}
</style>
