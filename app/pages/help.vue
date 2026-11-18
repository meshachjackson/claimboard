<script setup lang="ts">
// How the board works: what each status means, what each stage waits for, which agent can do what, and the behaviors that
// surprise people. The words are in types/board.ts and utils/explain.ts, so this page and the drawer never disagree.
// Direction B layout (11/1/2026): the page header, a section list that follows the scroll (as in Settings), and a reading
// column kept near 70 characters a line.
import { BOARD_QUIRKS, NO_RESPONSE_REASONS, SHORTCUTS, STAGES, STAGE_HELP, STAGE_LABELS, WORK_STATE_HELP, WORK_STATE_PILLS } from '~/types/board'
import { agentProfile } from '~/utils/explain'
import { repoLink } from '~/utils/links'

const board = useBoardStore()

const states = (Object.keys(WORK_STATE_PILLS) as (keyof typeof WORK_STATE_PILLS)[]).map(id => ({ id, pill: WORK_STATE_PILLS[id], help: WORK_STATE_HELP[id] }))
const stages = STAGES.map(id => ({ id, label: STAGE_LABELS[id], help: STAGE_HELP[id] }))

// Agents in service first; gateways and templates are plumbing, not workers.
const agents = computed(() => board.registry
  .filter(a => a.agent_type !== 'gateway' && a.lifecycle_status === 'active')
  .map(a => agentProfile(a, board.columns)))

const nav = [
  { id: 'states', label: 'Card status' },
  { id: 'stages', label: 'Columns' },
  { id: 'agents', label: 'Who does what' },
  { id: 'quirks', label: 'Surprises' },
  { id: 'shortcuts', label: 'Keyboard shortcuts' },
  { id: 'reference', label: 'Reference' }
]
// The map lives in the repo as markdown (the board does not render it); this opens it on GitHub.
const TAXONOMY_MAP_URL = repoLink(useRuntimeConfig().public.repoSlug, 'blob/main/docs/ux/taxonomy-usability-map.md') // '' hides the link
const current = ref('states')

// Same rule as Settings: the current section is the last one whose head has passed the top fifth of the screen, and at
// the very bottom the last one wins.
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

const head = 'border-b-2 border-rule pb-2'
const h2 = 'm-0 font-display text-[26px] leading-none font-bold'
</script>

<template>
  <div class="flex min-h-dvh flex-col">
    <header class="sticky top-0 z-20 flex min-h-14 items-center gap-4 border-b-2 border-rule bg-ground px-5">
      <PageTitle />
      <p class="m-0 truncate text-sm text-text3 max-[699px]:hidden">The same words the card panel uses.</p>
    </header>

    <div class="@container mx-auto w-full max-w-[1080px] px-6 pt-7 pb-24 max-[699px]:px-4">
      <div class="grid grid-cols-[188px_minmax(0,1fr)] gap-10 @max-[820px]:grid-cols-1 @max-[820px]:gap-5">
        <nav aria-label="Help sections" class="ab-row sticky top-[84px] flex flex-col gap-0.5 self-start @max-[820px]:top-14 @max-[820px]:z-10 @max-[820px]:-mx-6 @max-[820px]:flex-row @max-[820px]:overflow-x-auto @max-[820px]:border-b @max-[820px]:border-line @max-[820px]:bg-ground @max-[820px]:px-6 @max-[820px]:py-1.5">
          <a
            v-for="n in nav"
            :key="n.id"
            :href="`#${n.id}`"
            :aria-current="current === n.id ? 'true' : undefined"
            class="flex h-10 max-md:h-11 flex-none items-center rounded px-2.5 text-[15px] whitespace-nowrap text-ink no-underline"
            :class="current === n.id ? 'bg-surface font-semibold shadow-[inset_3px_0_0_var(--color-ink)]' : 'font-medium text-text2 hover:bg-(--ab-row-hover)'"
            @click="current = n.id"
          >{{ n.label }}</a>
        </nav>

        <main class="flex min-w-0 flex-col gap-12">
          <section id="states" aria-labelledby="h-states" class="scroll-mt-20">
            <div :class="head">
              <h2 id="h-states" :class="h2">What a card's status means</h2>
              <p class="m-0 mt-1.5 max-w-[68ch] text-sm text-text3">The pill on a card says what is happening to it right now.</p>
            </div>
            <dl class="m-0 flex flex-col divide-y divide-line bg-surface px-5">
              <div v-for="s in states" :key="s.id" class="grid grid-cols-[136px_minmax(0,1fr)] items-baseline gap-4 py-3.5 @max-[600px]:grid-cols-1 @max-[600px]:gap-1.5">
                <dt><StatusPill :pill="s.pill" /></dt>
                <dd class="m-0 max-w-[68ch] text-[15px] leading-normal text-text2">{{ s.help }}</dd>
              </div>
            </dl>
          </section>

          <section id="stages" aria-labelledby="h-stages" class="scroll-mt-20">
            <div :class="head">
              <h2 id="h-stages" :class="h2">What each column waits for</h2>
              <p class="m-0 mt-1.5 max-w-[68ch] text-sm text-text3">A card moves left to right. Each column names what has to happen before it moves on.</p>
            </div>
            <dl class="m-0 flex flex-col divide-y divide-line bg-surface px-5">
              <div v-for="s in stages" :key="s.id" class="grid grid-cols-[136px_minmax(0,1fr)] items-baseline gap-4 py-3.5 @max-[600px]:grid-cols-1 @max-[600px]:gap-1">
                <dt class="font-display text-[20px] leading-none font-bold">{{ s.label }}</dt>
                <dd class="m-0 max-w-[68ch] text-[15px] leading-normal text-text2">{{ s.help }}</dd>
              </div>
            </dl>
          </section>

          <section id="agents" aria-labelledby="h-agents" class="flex scroll-mt-20 flex-col gap-6">
            <div :class="head">
              <h2 id="h-agents" :class="h2">Who does what</h2>
              <p class="m-0 mt-1.5 max-w-[68ch] text-sm text-text3">
                An agent joins a column's pool when its agent type matches. Agents in no pool only get work when you name them on a card.
                How fast one answers depends on how work reaches it.
              </p>
            </div>

            <div class="border-l-[5px] border-rule bg-surface px-5 py-4">
              <h3 class="m-0 text-[15px] font-semibold">If an agent is not responding</h3>
              <ul class="m-0 mt-2 flex max-w-[68ch] list-disc flex-col gap-1.5 pl-5 text-[15px] leading-normal text-text2">
                <li v-for="r in NO_RESPONSE_REASONS" :key="r">{{ r }}</li>
              </ul>
            </div>

            <p v-if="!agents.length" class="m-0 text-sm text-text3">No agents loaded yet.</p>
            <ul v-else class="m-0 flex list-none flex-col divide-y divide-line bg-surface p-0">
              <li v-for="a in agents" :key="a.id" class="flex flex-col gap-2.5 px-5 py-4">
                <div class="flex items-center gap-2.5">
                  <AgentAvatar :id="a.id" :size="32" />
                  <h3 class="m-0 font-display text-[22px] leading-none font-bold">{{ a.name }}</h3>
                </div>
                <p v-if="a.summary" class="m-0 max-w-[68ch] text-[15px] leading-normal text-text2">{{ a.summary }}</p>
                <dl class="m-0 grid grid-cols-[132px_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm leading-normal @max-[600px]:grid-cols-1 @max-[600px]:gap-y-0.5">
                  <dt class="text-text3">Takes work in</dt>
                  <dd class="m-0 @max-[600px]:mb-1.5">{{ a.takes.length ? a.takes.join(' · ') : a.noPool }}</dd>
                  <template v-if="a.does.length">
                    <dt class="text-text3">Answers</dt>
                    <dd class="m-0 @max-[600px]:mb-1.5">{{ a.does.join(' · ') }}</dd>
                  </template>
                  <dt class="text-text3">Messages</dt>
                  <dd class="m-0 @max-[600px]:mb-1.5">{{ a.messages }}</dd>
                  <template v-if="a.delivery">
                    <dt class="text-text3">How it gets work</dt>
                    <dd class="m-0 @max-[600px]:mb-1.5">{{ a.delivery }}</dd>
                  </template>
                  <template v-if="a.classes.length">
                    <dt class="text-text3">Data it may see</dt>
                    <dd class="m-0">{{ a.classes.map(c => `class-${c}`).join(', ') }} cards only</dd>
                  </template>
                </dl>
              </li>
            </ul>
          </section>

          <section id="quirks" aria-labelledby="h-quirks" class="scroll-mt-20">
            <div :class="head">
              <h2 id="h-quirks" :class="h2">Things that surprise people</h2>
            </div>
            <ul class="m-0 flex list-none flex-col divide-y divide-line bg-surface p-0">
              <li v-for="q in BOARD_QUIRKS" :key="q.title" class="flex flex-col gap-1 px-5 py-4">
                <h3 class="m-0 text-[15px] font-semibold">{{ q.title }}</h3>
                <p class="m-0 max-w-[68ch] text-[15px] leading-normal text-text2">{{ q.body }}</p>
              </li>
            </ul>
          </section>

          <section id="shortcuts" aria-labelledby="h-shortcuts" class="scroll-mt-20">
            <div :class="head">
              <h2 id="h-shortcuts" :class="h2">Keyboard shortcuts</h2>
            </div>
            <p class="mt-3 mb-0 text-[15px] text-text2">Press <kbd class="rounded border border-input px-1.5 py-[3px] font-mono text-xs text-ink">?</kbd> on any page to open this list in a dialog.</p>
            <dl class="m-0 mt-3 grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-2.5 bg-surface px-5 py-4">
              <template v-for="s in SHORTCUTS" :key="s.keys">
                <dt><kbd class="rounded border border-input px-1.5 py-[3px] font-mono text-xs whitespace-pre text-ink">{{ s.keys }}</kbd></dt>
                <dd class="m-0 text-[15px] text-text2">{{ s.action }}</dd>
              </template>
            </dl>
          </section>

          <section id="reference" aria-labelledby="h-reference" class="scroll-mt-20">
            <div :class="head">
              <h2 id="h-reference" :class="h2">Reference</h2>
            </div>
            <ul class="m-0 flex list-none flex-col divide-y divide-line bg-surface p-0">
              <li class="flex flex-col gap-1 px-5 py-4">
                <h3 class="m-0 text-[15px] font-semibold">
                  <a v-if="TAXONOMY_MAP_URL" :href="TAXONOMY_MAP_URL" target="_blank" rel="noopener">Taxonomy and usability map</a>
                  <template v-else>Taxonomy and usability map</template>
                </h3>
                <p class="m-0 max-w-[68ch] text-[15px] leading-normal text-text2">
                  Every word the board uses, where the wording conflicts, and the questions for the UX agent. Opens on GitHub.
                </p>
              </li>
            </ul>
          </section>
        </main>
      </div>
    </div>
  </div>
</template>
