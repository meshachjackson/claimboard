<script setup lang="ts">
// Saved views: a popover with this browser's named board links. "Save current view" names the
// URL as it is now (filters, search, view, layout, sort); opening one is a plain link. Desktop only for now. It sits in the
// Filters panel (UX Phase 5).
import { isCurrent, viewHref } from '~/utils/savedViews'

const route = useRoute()
const saved = useSavedViews()
const name = ref('')

function save() {
  saved.save(name.value, route.query)
  name.value = ''
}
</script>

<template>
  <div class="flex min-w-0 flex-col gap-2.5" role="group" aria-label="Saved views">
    <h3 class="m-0 text-xs font-semibold text-ink">Saved views <span class="font-normal text-text3">(this browser)</span></h3>
    <p v-if="!saved.views.value.length" class="m-0 text-[13px] text-text3">None yet. Set the filters and view you want, then save them with a name.</p>
    <ul v-else class="m-0 flex list-none flex-col p-0">
      <li v-for="v in saved.views.value" :key="v.name" class="flex items-center gap-1">
        <NuxtLink
          :to="viewHref(v)"
          class="h-8 min-w-0 flex-1 truncate rounded-md px-2 text-[13px] leading-8 no-underline hover:bg-chip"
          :class="isCurrent(v, route.query) ? 'font-semibold text-ink' : 'text-text2'"
          :aria-current="isCurrent(v, route.query) ? 'page' : undefined"
        >{{ v.name }}</NuxtLink>
        <button
          type="button"
          :aria-label="`Remove view ${v.name}`"
          class="inline-flex size-8 flex-none cursor-pointer items-center justify-center rounded-md text-text3 hover:bg-chip hover:text-ink"
          @click="saved.remove(v.name)"
        >
          <UIcon name="i-lucide-x" class="size-3.5" />
        </button>
      </li>
    </ul>
    <form class="flex gap-1.5 border-t border-line pt-2.5" @submit.prevent="save">
      <input v-model="name" aria-label="View name" placeholder="Name this view" maxlength="40" class="ab-select h-8 min-w-0 flex-1 rounded-lg px-2 text-[13px]">
      <button type="submit" :disabled="!name.trim()" class="h-8 flex-none cursor-pointer rounded-lg bg-ink px-2.5 text-[13px] font-semibold text-surface disabled:cursor-not-allowed disabled:opacity-40">Save</button>
    </form>
  </div>
</template>
