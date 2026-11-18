<script setup lang="ts">
// The app shell (redesign): the rail on desktop, bottom tabs on the phone, and everything that opens over
// any page: the ticket panel (?task= in the URL, so Back closes it), the ticket editor, the board manager, the command
// palette and the shortcuts dialog. The board reads and live updates start here once, not per page.
const board = useBoardStore()
const isPhone = useIsPhone()
const route = useRoute()
const router = useRouter()
const palette = useCommandPalette()
const settings = useSettings()
const managerOpen = useManagerOpen()

const openId = computed(() => {
  const t = route.query.task
  return typeof t === 'string' && board.tasks.some(x => x.task_id === t) ? t : ''
})
const drawerOpen = computed({
  get: () => !!openId.value,
  set: (open: boolean) => {
    if (open) return
    const { task: _drop, ...rest } = route.query
    router.push({ query: rest })
  }
})

// A new ticket opens in the panel at once, so its fields can be checked.
function onCreated(taskId: string) {
  router.push({ query: { ...route.query, task: taskId } })
}

// The skip link moves focus to the page frame (it has tabindex -1), past the sidebar.
const skipToContent = () => document.getElementById('app-frame')?.focus()

// App-wide keys. The page keys (/, F, X, 1 2 3 4, ?) stay in useBoardKeys. G then a letter goes to a place.
// While a dialog is open (ticket editor, palette) the single-letter keys stand down.
const editor = useTicketEditor()
const idle = () => !editor.open.value && !palette.open.value
defineShortcuts({
  meta_k: { usingInput: true, handler: () => { palette.open.value = !palette.open.value } },
  n: () => { if (idle() && !board.readOnly) editor.create() },
  ',': () => { if (idle()) navigateTo('/settings') },
  '[': () => { if (idle() && !isPhone.value) settings.setRailHidden(!settings.railHidden.value) },
  'g-f': () => navigateTo('/'),
  'g-b': () => navigateTo('/board'),
  'g-a': () => navigateTo('/agents'),
  'g-s': () => navigateTo('/shipped')
})

onMounted(() => board.startRefreshing())
onBeforeUnmount(() => board.stopRefreshing())
</script>

<template>
  <!-- Frames: the window is split into side-by-side frames (rail, app, the orchestrator) that each scroll on their own. Opening
       the rail or the orchestrator shrinks the app frame; the app keeps its own layout inside it. On the phone the orchestrator replaces the
       app frame, so only one scrollbar is ever on screen. -->
  <div class="flex h-dvh overflow-hidden">
    <!-- First tab stop: jumps past the sidebar to the page (WCAG 2.4.1). Hidden until it has focus. -->
    <a
      href="#app-frame"
      class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded focus:bg-ink focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-surface"
      @click.prevent="skipToContent"
    >Skip to content</a>
    <AppRail v-if="!isPhone && !settings.railHidden.value" />
    <div v-show="!(isPhone && managerOpen)" id="app-frame" tabindex="-1" class="min-w-0 flex-1 overflow-auto outline-none" :class="isPhone ? 'pb-[76px]' : ''">
      <slot />
    </div>
    <ManagerChat />
    <AppTabs v-if="isPhone && !managerOpen" />

    <USlideover
      v-model:open="drawerOpen"
      side="right"
      :title="openId ? `Card ${openId}` : 'Card'"
      description="Card detail"
      :ui="{ content: isPhone ? 'max-w-none sm:max-w-none w-full' : 'sm:max-w-[520px] max-[1099px]:sm:max-w-none w-full' }"
    >
      <template #content="{ close }">
        <TicketPanel v-if="openId" :task-id="openId" :phone="isPhone" @close="close" />
      </template>
    </USlideover>

    <TicketEditor :phone="isPhone" @created="onCreated" />
    <CommandPalette />
    <ShortcutsModal />
    <BoardToolsHost />
  </div>
</template>
