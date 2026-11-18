<script setup lang="ts">
// Settings (direction B): the page header, a sticky section list that follows the scroll, and one section per topic.
// Each section says who a change touches. "This browser" is saved in localStorage; "Everyone" changes the board for every
// viewer. The clean-up thresholds are read-only until the board has a settings row behind the gateway (Part 2).
import type { DefaultView, Density, SortKey } from '~/types/board'
import { ARCHIVE_AFTER_DAYS, DENSITIES, DENSITY_LABELS, LOCAL_FILE_LABEL, SHORTCUTS, SORT_KEYS, SORT_LABELS, TRIAGE_APPLIABLE, TRIAGE_REPLY_HOURS, TRIAGE_STALE_DAYS, orchestratorId } from '~/types/board'
import type { ThemeChoice } from '~/composables/useSettings'
import { FLOOR_ZONES, LIVE_SECONDS } from '~/composables/useSettings'
import { SWITCH_HELP, SWITCH_LABELS, SWITCH_MODES, lastSeen, presence } from '~/utils/availability'
import type { SwitchMode } from '~/utils/availability'
import { triageBoard } from '~/utils/triage'
import { formatTime } from '~/utils/format'

const board = useBoardStore()
const toast = useToast()
const { user, clear } = useUserSession()
const exportAny = useCsvExport()
const s = useSettings()
const access = useAccess()
onMounted(() => access.load())

const nav = [
  { id: 'appearance', label: 'Appearance', everyone: false },
  { id: 'layout', label: 'Layout', everyone: false },
  { id: 'defaults', label: 'Board defaults', everyone: false },
  { id: 'live', label: 'Live updates', everyone: false },
  { id: 'agents', label: 'Agents', everyone: true },
  { id: 'cleanup', label: 'Clean-up', everyone: true },
  { id: 'data', label: 'Data', everyone: true },
  { id: 'shortcuts', label: 'Keyboard shortcuts', everyone: false },
  { id: 'account', label: 'Account', everyone: false }
]
const current = ref('appearance')

// The section list follows the scroll: the current section is the last one whose head has passed the top fifth of the
// screen. At the very bottom the short last sections can't reach that line, so the last one wins.
function spy() {
  const frame = document.getElementById('app-frame')
  if (!frame) return
  const line = frame.clientHeight * 0.2
  const atEnd = frame.scrollTop + frame.clientHeight >= frame.scrollHeight - 4
  const passed = nav.filter(n => (document.getElementById(n.id)?.getBoundingClientRect().top ?? Infinity) <= line)
  current.value = atEnd ? nav[nav.length - 1]!.id : passed.at(-1)?.id ?? nav[0]!.id
}
let raf = 0
const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(spy) }
onMounted(() => { document.getElementById('app-frame')?.addEventListener('scroll', onScroll, { passive: true }); spy() })
onBeforeUnmount(() => document.getElementById('app-frame')?.removeEventListener('scroll', onScroll))

const themes = [{ id: 'system', label: 'System' }, { id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }]
const densities = DENSITIES.map(id => ({ id, label: DENSITY_LABELS[id] }))
const views = [{ id: 'stages', label: 'Stages' }, { id: 'table', label: 'Table' }]
const liveChoices = LIVE_SECONDS.map(n => ({ id: String(n), label: n === 0 ? 'Off' : n < 60 ? `${n}s` : '1 min' }))
const lanes = [{ id: 'none', label: 'None' }, { id: 'project', label: 'Project' }]
const railChoices = [{ id: 'shown', label: 'Shown' }, { id: 'hidden', label: 'Hidden' }]
const zoneNames = { mine: 'Needs you', floor: 'On the floor', shipped: 'Shipped today' }

// Agents: on, auto or off for each agent in service. The server keeps the switch in a file, so this needs the local board.
const switchChoices = SWITCH_MODES.map(id => ({ id, label: SWITCH_LABELS[id] }))
const agentRows = computed(() => board.registry
  .filter(a => a.lifecycle_status === 'active' && a.agent_id !== orchestratorId())
  .map(a => ({ id: a.agent_id, name: a.name || a.agent_id, mode: (a.switch ?? 'on') as SwitchMode, seen: presence(lastSeen(a.agent_id, board.steps, board.notes)).text })))
async function changeSwitch(id: string, mode: SwitchMode) {
  const name = agentRows.value.find(a => a.id === id)?.name ?? id
  const label = SWITCH_LABELS[mode]
  // The toast opens at the click, then turns into the answer.
  const { id: toastId } = toast.add({ title: `Setting ${name} to ${label} ...`, color: 'neutral', duration: 0 })
  const problem = await board.setSwitch(id, mode)
  if (problem) toast.update(toastId, { title: `${name} stays ${SWITCH_LABELS[agentRows.value.find(a => a.id === id)?.mode ?? 'on']}`, description: problem, color: 'error', duration: 8000 })
  else toast.update(toastId, { title: `${name} is now ${label}`, color: 'success', duration: 3000 })
}

// Clean-up: the triage and the duplicates dialogs are the headless components; the buttons here open them.
const triage = ref<{ run: () => void } | null>(null)
const dupes = ref<{ open: () => void } | null>(null)
const csv = ref<{ openImport: () => void } | null>(null)
const triageCount = computed(() => triageBoard({ tasks: board.tasks, steps: board.steps, notes: board.notes, registry: board.registry })
  .filter(f => TRIAGE_APPLIABLE.includes(f.action)).length)
const thresholds = [
  { label: 'Archive Done cards after', value: `${ARCHIVE_AFTER_DAYS} days` },
  { label: 'Flag cards with no activity after', value: `${TRIAGE_STALE_DAYS} days` },
  { label: 'Flag unanswered comments after', value: `${TRIAGE_REPLY_HOURS} hours` }
]

// Data
const source = computed(() => board.saved ? LOCAL_FILE_LABEL : board.source === 'gateway' ? 'Live' : 'Prototype · fixtures')
const status = computed(() => [source.value, board.readOnly ? 'read only' : '', board.updatedAt ? `updated ${formatTime(board.updatedAt)}` : ''].filter(Boolean).join(' · '))
function resetSample() {
  if (!confirm('Reset sample data? This drops every local edit.')) return
  board.reset()
  toast.add({ title: 'Sample data reloaded', color: 'neutral' })
}

async function signOut() {
  await clear()
  await navigateTo('/login')
}

// The Floor's secondary button: an ink outline. Disabled buttons say why in the row's help text.
const btn = 'inline-flex h-10 max-md:h-11 cursor-pointer items-center rounded border-2 border-ink px-3.5 text-sm font-semibold text-ink no-underline hover:bg-(--ab-row-hover) disabled:cursor-not-allowed disabled:opacity-50'
</script>

<template>
  <div class="flex min-h-dvh flex-col">
    <header class="sticky top-0 z-20 flex min-h-14 items-center gap-4 border-b-2 border-rule bg-ground px-5">
      <PageTitle />
      <p class="m-0 truncate text-sm text-text3 max-[699px]:hidden">Saved in this browser, unless a section says Everyone.</p>
    </header>

    <div class="@container mx-auto w-full max-w-[1080px] px-6 pt-7 pb-24 max-[699px]:px-4">
      <div class="grid grid-cols-[188px_minmax(0,1fr)] gap-10 @max-[820px]:grid-cols-1 @max-[820px]:gap-5">
        <nav aria-label="Settings sections" class="sticky top-[84px] flex flex-col gap-0.5 self-start @max-[820px]:top-14 @max-[820px]:z-10 @max-[820px]:-mx-6 @max-[820px]:flex-row @max-[820px]:overflow-x-auto @max-[820px]:border-b @max-[820px]:border-line @max-[820px]:bg-ground @max-[820px]:px-6 @max-[820px]:py-1.5">
          <a
            v-for="n in nav"
            :key="n.id"
            :href="`#${n.id}`"
            :aria-current="current === n.id ? 'true' : undefined"
            class="flex h-10 max-md:h-11 flex-none items-center gap-2 rounded px-2.5 text-[15px] whitespace-nowrap text-ink no-underline"
            :class="current === n.id ? 'bg-surface font-semibold shadow-[inset_3px_0_0_var(--color-ink)]' : 'font-medium text-text2 hover:bg-(--ab-row-hover)'"
            @click="current = n.id"
          >
            <span class="flex-1">{{ n.label }}</span>
            <UIcon v-if="n.everyone" name="i-lucide-users" class="size-3.5 flex-none text-accent" aria-label="Changes for everyone" />
          </a>
          <p class="m-0 mt-4 flex gap-1.5 px-2.5 text-xs leading-normal text-text3 @max-[820px]:hidden">
            <UIcon name="i-lucide-users" class="mt-0.5 size-3.5 flex-none text-accent" />Changes for everyone who uses the board.
          </p>
        </nav>

        <div class="flex min-w-0 flex-col gap-10">
          <SettingsSection id="appearance" title="Appearance" :scopes="['browser']">
            <SettingsRow label="Theme" help="System follows your phone or computer." label-id="st-theme">
              <SegChoice :options="themes" :model-value="s.theme.value" labelledby="st-theme" @update:model-value="s.theme.value = $event as ThemeChoice" />
            </SettingsRow>
            <SettingsRow label="Card density" help="Compact cards use less padding and hide the activity line." label-id="st-density">
              <SegChoice :options="densities" :model-value="s.density.value" labelledby="st-density" @update:model-value="s.setDensity($event as Density)" />
            </SettingsRow>
          </SettingsSection>

          <SettingsSection id="layout" title="Layout" :scopes="['browser']" note="The same switches sit on the screens themselves: the sidebar's own button, and the buttons on each Floor zone.">
            <SettingsRow label="Sidebar" help="Hidden gives the page the full width. The button at the left of each page header, or [, brings it back." label-id="st-rail">
              <SegChoice :options="railChoices" :model-value="s.railHidden.value ? 'hidden' : 'shown'" labelledby="st-rail" @update:model-value="s.setRailHidden($event === 'hidden')" />
            </SettingsRow>
            <SettingsRow v-for="z in FLOOR_ZONES" :key="z" :label="`Floor: ${zoneNames[z]}`" :help="z === 'mine' ? 'Hidden folds it to a strip that still lights amber when something waits on you.' : 'Hidden folds it to a strip with its count.'" :label-id="`st-zone-${z}`">
              <ToggleSwitch
                :on="!s.floorHidden.value.includes(z)"
                :labelledby="`st-zone-${z}`"
                :disabled="!s.floorHidden.value.includes(z) && s.floorHidden.value.length >= FLOOR_ZONES.length - 1"
                @toggle="s.toggleFloorZone(z)"
              />
            </SettingsRow>
          </SettingsSection>

          <SettingsSection id="defaults" title="Board defaults" :scopes="['browser']" note="Used when the link names no view, sort or grouping.">
            <SettingsRow label="Opens on" help="Stages runs Backlog to Done. Table is one row per card." label-id="st-view">
              <SegChoice :options="views" :model-value="s.defaultView.value" labelledby="st-view" @update:model-value="s.setDefaultView($event as DefaultView)" />
            </SettingsRow>
            <SettingsRow label="Sort cards by" label-id="st-sort">
              <select aria-labelledby="st-sort" class="ab-select h-10 rounded px-2 text-sm" :value="s.defaultSort.value" @change="s.setDefaultSort(($event.target as HTMLSelectElement).value as SortKey)">
                <option v-for="k in SORT_KEYS" :key="k" :value="k">{{ SORT_LABELS[k] }}</option>
              </select>
            </SettingsRow>
            <SettingsRow label="Group by" label-id="st-lanes">
              <SegChoice :options="lanes" :model-value="s.defaultLanes.value ? 'project' : 'none'" labelledby="st-lanes" @update:model-value="s.setDefaultLanes($event === 'project')" />
            </SettingsRow>
            <SettingsRow label="Remember the filter panel" help="Off means it always starts closed." label-id="st-remember">
              <ToggleSwitch :on="s.rememberFilters.value" labelledby="st-remember" @toggle="s.setRememberFilters(!s.rememberFilters.value)" />
            </SettingsRow>
          </SettingsSection>

          <SettingsSection id="live" title="Live updates" :scopes="['browser']" note="Off keeps the board quiet: it reads on load, on Refresh and when you come back to the tab.">
            <SettingsRow label="Refresh the board" help="On the local board the server also pushes each change at once, so messages show instantly. On the hosted board the interval is at least 1 minute." label-id="st-live">
              <SegChoice :options="liveChoices" :model-value="String(s.liveSeconds.value)" labelledby="st-live" @update:model-value="s.setLiveSeconds(Number($event))" />
            </SettingsRow>
          </SettingsSection>

          <SettingsSection id="agents" title="Agents" :scopes="['everyone']" note="Off cuts that agent off from the board: no messages, wake-ups, assignments or claims. What it does elsewhere (Telegram, other agents) is not touched. Saved in n8n when the gateway has set_switch, otherwise in a file on the local board.">
            <SettingsRow v-for="a in agentRows" :key="a.id" :label="a.name" :help="`${SWITCH_HELP[a.mode]} ${a.seen.charAt(0).toUpperCase()}${a.seen.slice(1)}.`" :label-id="`st-sw-${a.id}`">
              <SegChoice :options="switchChoices" :model-value="a.mode" :labelledby="`st-sw-${a.id}`" @update:model-value="changeSwitch(a.id, $event as SwitchMode)" />
            </SettingsRow>
            <p v-if="!agentRows.length" class="m-0 py-4 text-sm text-text3">No agents in service yet.</p>
          </SettingsSection>

          <SettingsSection id="cleanup" title="Clean-up" :scopes="['everyone']" note="Pinned cards are never archived.">
            <SettingsRow label="Run triage" :help="`${triageCount} card${triageCount === 1 ? '' : 's'} the rules would close or archive. You see the list before anything changes.`">
              <button type="button" :class="btn" @click="triage?.run()">Triage board</button>
            </SettingsRow>
            <SettingsRow v-if="!board.readOnly && board.canUse('archive_task')" label="Find duplicates" help="Cards that look like the same work.">
              <button type="button" :class="btn" @click="dupes?.open()">Find duplicates</button>
            </SettingsRow>
            <div class="py-4">
              <h3 class="m-0 text-[15px] font-semibold">Thresholds</h3>
              <p class="m-0 mt-0.5 text-sm text-text3">Set in code. They change for everyone when the board gets a settings table.</p>
              <dl class="m-0 mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-2 text-sm">
                <template v-for="t in thresholds" :key="t.label">
                  <dt class="text-text2">{{ t.label }}</dt>
                  <dd class="m-0 text-right font-display text-[18px] leading-tight font-bold">{{ t.value }}</dd>
                </template>
              </dl>
            </div>
          </SettingsSection>

          <SettingsSection id="data" title="Data" :scopes="['browser', 'everyone']">
            <SettingsRow label="Source" :help="status" scope="browser">
              <button type="button" :class="btn" :disabled="board.refreshing" @click="board.refresh(true)">{{ board.refreshing ? 'Refreshing…' : 'Refresh now' }}</button>
            </SettingsRow>
            <SettingsRow label="Export all as CSV" help="Every card, archived ones included." scope="everyone">
              <button type="button" :class="btn" :disabled="!board.cards.length" @click="exportAny(board.cards, 'Every card, archived ones included.')">Export all</button>
            </SettingsRow>
            <SettingsRow v-if="!board.readOnly" label="Import CSV" help="Create cards from a CSV file. You check the mapping before anything is created." scope="everyone">
              <button type="button" :class="btn" @click="csv?.openImport()">Import CSV…</button>
            </SettingsRow>
            <SettingsRow v-if="board.localOnly" label="Reset sample data" help="Drops every local edit and reloads the fixtures. This can't be undone." scope="browser">
              <button type="button" :class="[btn, 'border-(--ab-red-text) text-(--ab-red-text)']" @click="resetSample">Reset sample data</button>
            </SettingsRow>
          </SettingsSection>

          <SettingsSection id="shortcuts" title="Keyboard shortcuts" note="Single keys stand down while you type or a dialog is open.">
            <dl class="m-0 grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-2.5 py-4">
              <template v-for="k in SHORTCUTS" :key="k.keys">
                <dt><kbd class="inline-block min-w-7 rounded-sm border border-b-2 border-input bg-ground px-1.5 py-[3px] text-center font-mono text-xs whitespace-pre text-ink">{{ k.keys }}</kbd></dt>
                <dd class="m-0 text-sm text-text2">{{ k.action }}</dd>
              </template>
            </dl>
          </SettingsSection>

          <SettingsSection id="account" title="Account">
            <SettingsRow :label="user?.login ?? 'Signed in'" help="Signed in with GitHub.">
              <button type="button" :class="btn" @click="signOut">Sign out</button>
            </SettingsRow>
            <SettingsRow label="Access" :help="access.state.value.admin ? 'Who can see and change each board, project and card. Admins only.' : 'Who can see and change the board. Only admins can edit it.'" scope="everyone">
              <NuxtLink to="/access" :class="btn">Open Access</NuxtLink>
            </SettingsRow>
          </SettingsSection>
        </div>
      </div>
    </div>
    <DupesButton ref="dupes" headless />
    <BoardCsv ref="csv" headless />
    <TriageBoard ref="triage" headless />
  </div>
</template>
