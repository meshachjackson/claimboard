<script setup lang="ts">
import { orchestratorName } from '~/types/board'
const orch = orchestratorName()
// The ⌘K palette (redesign): places, tickets by ID or words, board actions, and a question for the board
// manager when nothing else matches. Every action here also has a button somewhere; the palette is a shortcut, not the
// only way in.
const { open } = useCommandPalette()
const { items: places } = useNav()
const board = useBoardStore()
const tools = useBoardTools()
const editor = useTicketEditor()
const managerOpen = useManagerOpen()
const managerDraft = useState('ab-manager-draft', () => '')
const managerMode = useState<'orchestrator' | 'helper'>('ab-manager-mode', () => 'orchestrator')
const shortcuts = useShortcutsOpen()
const settings = useSettings()
const route = useRoute()
const term = ref('')

function go(to: string | { path: string, query?: Record<string, string> }) {
  open.value = false
  navigateTo(to)
}
function run(fn?: () => void) {
  open.value = false
  fn?.()
}
// A ticket opens over the page you are on, the same as clicking its card.
const openTicket = (id: string) => go({ path: route.path, query: { ...route.query as Record<string, string>, task: id } })

const groups = computed(() => {
  const list = [
    {
      id: 'places',
      label: 'Go to',
      items: [
        ...places.value.map(p => ({ label: p.label, suffix: p.text || undefined, kbds: p.key.split(' '), onSelect: () => go(p.to) })),
        { label: 'Board report', onSelect: () => go('/report') },
        { label: 'Agent roster (registry)', onSelect: () => go('/registry') },
        { label: 'Plan', onSelect: () => go('/plan') },
        { label: 'Settings', kbds: [','], onSelect: () => go('/settings') },
        { label: 'How the board works', onSelect: () => go('/help') },
        { label: 'API reference', onSelect: () => go('/api') },
        { label: 'What changed (changelog)', onSelect: () => go('/changelog') }
      ]
    },
    {
      id: 'actions',
      label: 'Actions',
      items: [
        ...(!board.readOnly ? [{ label: 'New card', kbds: ['N'], onSelect: () => run(() => editor.create()) }] : []),
        { label: 'Triage the board', onSelect: () => run(tools.value.triage) },
        ...(!board.readOnly && board.canUse('archive_task') ? [{ label: 'Find duplicates', onSelect: () => run(tools.value.dupes) }] : []),
        { label: 'Export cards as CSV', onSelect: () => run(tools.value.exportCsv) },
        ...(!board.readOnly ? [{ label: 'Import CSV', onSelect: () => run(tools.value.importCsv) }] : []),
        { label: 'Board in Stages view (drag and drop)', kbds: ['1'], onSelect: () => go({ path: '/board', query: { layout: 'board' } }) },
        { label: 'Board as a table', kbds: ['2'], onSelect: () => go({ path: '/board', query: { layout: 'table' } }) },
        { label: 'Refresh the board', onSelect: () => run(() => board.refresh(true)) },
        { label: settings.railHidden.value ? 'Show the sidebar' : 'Hide the sidebar', kbds: ['['], onSelect: () => run(() => settings.setRailHidden(!settings.railHidden.value)) },
        { label: 'Keyboard shortcuts', kbds: ['?'], onSelect: () => run(() => { shortcuts.value = true }) }
      ]
    },
    {
      id: 'tickets',
      label: 'Cards',
      items: board.cards
        .filter(c => !c.archived)
        .map(c => ({ label: c.task.title, prefix: c.task.task_id, onSelect: () => openTicket(c.task.task_id) }))
    }
  ]
  // Text that is not a page, action or card becomes a question for the orchestrator (or a bulk-edit request for the board manager).
  const q = term.value.trim()
  if (q.length > 3) {
    list.push({
      id: 'ask',
      label: 'Ask',
      ignoreFilter: true,
      items: [
        { label: `Ask ${orch}: "${q}"`, onSelect: () => run(() => { managerMode.value = 'orchestrator'; managerDraft.value = q; managerOpen.value = true }) },
        // Bulk edits go to the board manager voice; the request is routed exactly as before.
        ...(!board.readOnly ? [{ label: `Ask the board manager: "${q}"`, onSelect: () => run(() => { managerMode.value = 'helper'; managerDraft.value = q; managerOpen.value = true }) }] : [])
      ]
    } as never)
  }
  return list
})

watch(open, (o) => { if (!o) term.value = '' })
</script>

<template>
  <UModal v-model:open="open" title="Command palette" :description="`Go to a page, open a card, run an action or ask ${orch}.`" :ui="{ content: 'sm:max-w-2xl' }">
    <template #content>
      <UCommandPalette
        v-model:search-term="term"
        :groups="groups"
        placeholder="Type a page, a card, an action or a question"
        :fuse="{ resultLimit: 8 }"
        close
        @update:open="open = $event"
      />
    </template>
  </UModal>
</template>
