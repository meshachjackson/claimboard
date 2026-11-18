<script setup lang="ts">
import { orchestratorName } from '~/types/board'
const orch = orchestratorName()
// Desktop navigation (redesign): the four places, saved views, then Plan, Settings and Help low in the rail.
// Replaces the Board / Plan / Sketch / Registry tabs that used to sit in each page's top bar.
import { PLAN_HREF, PLAN_LABEL } from '~/types/board'
import { viewHref } from '~/utils/savedViews'

const { items } = useNav()
const { views } = useSavedViews()
const route = useRoute()
const palette = useCommandPalette()
const settings = useSettings()
const manager = useManagerOpen() // the orchestrator panel (ManagerChat.vue), mounted in the layout so it opens on any page
const at = (p: string) => route.path.startsWith(p)
// Plan has its own rail link, so Board stays unlit there and exactly one item is current.
const isOn = (i: { to: string, on: boolean }) => i.on && !(i.to === '/board' && (at('/plan') || at('/sketch')))
</script>

<template>
  <nav aria-label="Main" class="sticky top-0 flex h-dvh w-[212px] flex-none flex-col gap-1 border-r-2 border-rule bg-ground px-3 py-4">
    <div class="flex items-start justify-between pb-4">
      <NuxtLink to="/" class="px-2.5 pt-1 font-display text-[24px] leading-none font-bold text-ink no-underline">Agent board</NuxtLink>
      <!-- Hides the rail for more room. The button at the left of each page header, or [, brings it back. -->
      <button
        type="button"
        aria-label="Hide sidebar"
        title="Hide sidebar ( [ )"
        class="-mt-1.5 inline-flex size-9 cursor-pointer items-center justify-center rounded text-text2 hover:bg-(--ab-row-hover) hover:text-ink"
        @click="settings.setRailHidden(true)"
      >
        <UIcon name="i-lucide-panel-left-close" class="size-5" />
      </button>
    </div>

    <!-- Ask the orchestrator / the board manager from any page. Same toggle as the board bar button. -->
    <button
      type="button"
      :aria-pressed="manager"
      class="mb-2 flex h-10 cursor-pointer items-center gap-2 rounded border border-line px-2.5 text-left text-[15px] font-semibold text-ink hover:bg-(--ab-row-hover)"
      @click="manager = !manager"
    >
      <UIcon name="i-lucide-bot" class="size-4" />
      <span class="flex-1">Ask {{ orch }}</span>
    </button>

    <NuxtLink
      v-for="i in items"
      :key="i.to"
      :to="i.to"
      :aria-current="isOn(i) ? 'page' : undefined"
      class="flex h-10 items-center gap-2 rounded px-2.5 text-[15px] text-ink no-underline"
      :class="isOn(i) ? 'bg-surface font-semibold shadow-[inset_3px_0_0_var(--color-ink)]' : 'font-medium hover:bg-(--ab-row-hover)'"
    >
      <span class="flex-1">{{ i.label }}</span>
      <span
        v-if="i.text"
        role="img"
        :aria-label="i.hint"
        :title="i.hint"
        class="rounded-sm px-1.5 font-display text-[15px] leading-5 font-bold"
        :class="i.lit ? 'bg-(--ab-amber) text-(--ab-amber-fg)' : 'text-text3'"
      >{{ i.text }}</span>
    </NuxtLink>

    <template v-if="views.length">
      <p class="m-0 px-2.5 pt-5 pb-1 text-xs font-semibold text-text3">Saved views</p>
      <NuxtLink
        v-for="v in views"
        :key="v.name"
        :to="viewHref(v)"
        class="flex h-8 items-center truncate rounded px-2.5 text-sm text-text2 no-underline hover:bg-(--ab-row-hover)"
      >{{ v.name }}</NuxtLink>
    </template>

    <div class="flex-1" />

    <button type="button" class="flex h-9 items-center justify-between rounded px-2.5 text-left text-sm text-text2 hover:bg-(--ab-row-hover)" @click="palette.open.value = true">
      Search or command <kbd class="font-sans text-xs text-text3">⌘K</kbd>
    </button>
    <NuxtLink :to="PLAN_HREF" :aria-current="at('/plan') || at('/sketch') ? 'page' : undefined" class="flex h-9 items-center rounded px-2.5 text-sm no-underline hover:bg-(--ab-row-hover)" :class="at('/plan') || at('/sketch') ? 'font-semibold text-ink' : 'text-text2'">{{ PLAN_LABEL }}</NuxtLink>
    <NuxtLink to="/settings" :aria-current="at('/settings') || at('/access') ? 'page' : undefined" class="flex h-9 items-center justify-between rounded px-2.5 text-sm no-underline hover:bg-(--ab-row-hover)" :class="at('/settings') || at('/access') ? 'font-semibold text-ink' : 'text-text2'">
      Settings <kbd class="font-sans text-xs text-text3">,</kbd>
    </NuxtLink>
    <NuxtLink to="/help" :aria-current="at('/help') ? 'page' : undefined" class="flex h-9 items-center rounded px-2.5 text-sm no-underline hover:bg-(--ab-row-hover)" :class="at('/help') ? 'font-semibold text-ink' : 'text-text2'">Help</NuxtLink>
    <div class="mt-1 border-t border-line pt-2">
      <AccountMenu />
    </div>
  </nav>
</template>
