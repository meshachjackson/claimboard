<script setup lang="ts">
// API reference: every route the board serves, who may call it, and the response to expect.
// The content is plain data in utils/apiDocs.ts (test/api-docs.test.ts fails when a route is missing there).
// Same layout as Help: header, a section list that follows the scroll, a reading column.
// Two jobs it serves: make a first call that works, then find one route fast (search, one-line rows, expand all).
import { API_AUTH, API_ENDPOINTS, API_GROUPS, ERROR_RESULT, WRITE_RESULT, leadSentence, matchesQuery, quickStartCall, type ApiEndpoint, type HttpMethod } from '~/utils/apiDocs'

const origin = useRequestURL().origin
const quickStart = quickStartCall(origin)

const query = ref('')
// The OAuth routes belong to the Claude connector, which is part of the orchestrator feature (shared/features.ts).
const connector = useOrchestratorFeature()
const total = API_ENDPOINTS.filter(e => connector || e.group !== 'oauth').length
const groups = computed(() => API_GROUPS
  .filter(g => connector || g.id !== 'oauth')
  .map(g => ({ ...g, endpoints: API_ENDPOINTS.filter(e => e.group === g.id && matchesQuery(e, query.value)) }))
  .filter(g => g.endpoints.length))
const shown = computed(() => groups.value.reduce((n, g) => n + g.endpoints.length, 0))

// "Before you start" only shows when nobody is searching; the section list follows what is on the page.
const nav = computed(() => [...(query.value.trim() ? [] : [{ id: 'start', label: 'Before you start' }]), ...groups.value.map(g => ({ id: g.id, label: g.label }))])
const current = ref('start')

// Same rule as Help: the current section is the last one whose head has passed the top fifth of the screen.
function spy() {
  const list = nav.value
  if (!list.length) return
  const frame = document.getElementById('app-frame')
  if (!frame) return
  const line = frame.clientHeight * 0.2
  const atEnd = frame.scrollTop + frame.clientHeight >= frame.scrollHeight - 4
  const passed = list.filter(n => (document.getElementById(n.id)?.getBoundingClientRect().top ?? Infinity) <= line)
  current.value = atEnd ? list[list.length - 1]!.id : passed.at(-1)?.id ?? list[0]!.id
}
let raf = 0
const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(spy) }
onMounted(() => { document.getElementById('app-frame')?.addEventListener('scroll', onScroll, { passive: true }); spy() })
onBeforeUnmount(() => document.getElementById('app-frame')?.removeEventListener('scroll', onScroll))
watch(query, () => nextTick(spy))

// Which rows are open. The page owns it so "Expand all" works and a search keeps what you opened.
const key = (e: ApiEndpoint) => `${e.method} ${e.path}`
const opened = ref(new Set<string>())
function onToggle(e: ApiEndpoint, ev: Event) {
  const next = new Set(opened.value)
  if ((ev.target as HTMLDetailsElement).open) next.add(key(e))
  else next.delete(key(e))
  opened.value = next
}
const allShown = computed(() => groups.value.flatMap(g => g.endpoints))
const allOpen = computed(() => allShown.value.length > 0 && allShown.value.every(e => opened.value.has(key(e))))
function toggleAll() {
  const next = new Set(opened.value)
  for (const e of allShown.value) allOpen.value ? next.delete(key(e)) : next.add(key(e))
  opened.value = next
}

const METHOD_CLASS: Record<HttpMethod, string> = {
  GET: 'bg-(--ab-green-bg) text-(--ab-green-fg)',
  POST: 'bg-(--ab-orange-bg) text-(--ab-orange-fg)',
  PUT: 'bg-(--ab-orange-bg) text-(--ab-orange-fg)'
}

const head = 'border-b-2 border-rule pb-2'
const h2 = 'm-0 font-display text-[26px] leading-none font-bold'
</script>

<template>
  <div class="flex min-h-dvh flex-col">
    <header class="sticky top-0 z-20 flex min-h-14 items-center gap-4 border-b-2 border-rule bg-ground px-5">
      <PageTitle label="API" />
      <p class="m-0 truncate text-sm text-text3 max-[699px]:hidden">
        {{ query.trim() ? `${shown} of ${total}` : total }} routes, what each takes and returns.
      </p>
      <div class="relative ml-auto w-full max-w-[320px]">
        <UIcon name="i-lucide-search" class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text3" />
        <input
          v-model="query"
          type="search"
          aria-label="Search routes"
          placeholder="Search routes, e.g. claim or token"
          class="h-10 w-full rounded border border-input bg-surface pr-3 pl-9 text-[15px] text-ink placeholder:text-text3"
        >
      </div>
    </header>

    <div class="@container mx-auto w-full max-w-[1080px] px-6 pt-7 pb-24 max-[699px]:px-4">
      <div class="grid grid-cols-[188px_minmax(0,1fr)] gap-10 @max-[820px]:grid-cols-1 @max-[820px]:gap-5">
        <nav aria-label="API sections" class="ab-row sticky top-[84px] flex flex-col gap-0.5 self-start @max-[820px]:top-14 @max-[820px]:z-10 @max-[820px]:-mx-6 @max-[820px]:flex-row @max-[820px]:overflow-x-auto @max-[820px]:border-b @max-[820px]:border-line @max-[820px]:bg-ground @max-[820px]:px-6 @max-[820px]:py-1.5">
          <a
            v-for="n in nav"
            :key="n.id"
            :href="`#${n.id}`"
            :aria-current="current === n.id ? 'true' : undefined"
            class="flex h-10 flex-none items-center rounded px-2.5 text-[15px] whitespace-nowrap text-ink no-underline"
            :class="current === n.id ? 'bg-surface font-semibold shadow-[inset_3px_0_0_var(--color-ink)]' : 'font-medium text-text2 hover:bg-(--ab-row-hover)'"
            @click="current = n.id"
          >{{ n.label }}</a>
        </nav>

        <main class="flex min-w-0 flex-col gap-12">
          <section v-if="!query.trim()" id="start" aria-labelledby="h-start" class="scroll-mt-20">
            <div :class="head">
              <h2 id="h-start" :class="h2">Before you start</h2>
              <p class="m-0 mt-1.5 max-w-[68ch] text-sm text-text3">Bodies are JSON. Dates are ISO timestamps. Field names and values match the registry schema.</p>
            </div>
            <div class="flex flex-col gap-5 bg-surface p-5">
              <div>
                <h3 class="m-0 mb-2 text-[15px] font-semibold">Try your first call</h3>
                <p class="m-0 mb-2 max-w-[68ch] text-[15px] text-text2">Lists the steps waiting for your agent. Put your agent token in <code class="font-mono text-[13px]">AGENT_TOKEN</code> first. A 200 with <code class="font-mono text-[13px]">"ok": true</code> means you are connected.</p>
                <ApiCode :text="quickStart" label="first call" />
              </div>
              <div>
                <h3 class="m-0 mb-2 text-[15px] font-semibold">Who may call</h3>
                <dl class="m-0 grid grid-cols-[150px_minmax(0,1fr)] gap-x-4 gap-y-2 @max-[600px]:grid-cols-1">
                  <template v-for="(a, id) in API_AUTH" :key="id">
                    <dt class="text-[15px] font-medium">{{ a.label }}</dt>
                    <dd class="m-0 max-w-[68ch] text-[15px] text-text2">{{ a.help }}</dd>
                  </template>
                </dl>
              </div>
              <div>
                <h3 class="m-0 mb-2 text-[15px] font-semibold">What a write answers with</h3>
                <ApiCode :text="WRITE_RESULT" label="write answer" />
              </div>
              <div>
                <h3 class="m-0 mb-2 text-[15px] font-semibold">What a failed call answers with</h3>
                <ApiCode :text="ERROR_RESULT" label="error answer" />
              </div>
            </div>
          </section>

          <div v-if="allShown.length" class="-mb-6 flex items-center justify-between gap-3">
            <p class="m-0 text-sm text-text3" aria-live="polite">{{ query.trim() ? `${shown} of ${total} routes match` : 'Open a route for what to send and what you get.' }}</p>
            <button type="button" class="h-10 flex-none cursor-pointer rounded px-2.5 text-[15px] font-medium text-text2 hover:bg-(--ab-row-hover) hover:text-ink" @click="toggleAll">
              {{ allOpen ? 'Collapse all' : 'Expand all' }}
            </button>
          </div>

          <section v-for="g in groups" :id="g.id" :key="g.id" :aria-labelledby="`h-${g.id}`" class="scroll-mt-20">
            <div :class="head">
              <h2 :id="`h-${g.id}`" :class="h2">{{ g.label }}</h2>
              <p class="m-0 mt-1.5 max-w-[68ch] text-sm text-text3">{{ g.blurb }}</p>
            </div>
            <div class="flex flex-col divide-y divide-line bg-surface">
              <details v-for="e in g.endpoints" :key="key(e)" class="group px-5" :open="opened.has(key(e))" @toggle="onToggle(e, $event)">
                <summary class="grid cursor-pointer list-none grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-0.5 py-3.5 [&::-webkit-details-marker]:hidden">
                  <span class="w-12 flex-none rounded px-1.5 py-0.5 text-center font-mono text-[12px] font-semibold" :class="METHOD_CLASS[e.method]">{{ e.method }}</span>
                  <code class="min-w-0 font-mono text-[15px] font-semibold break-all text-ink">{{ e.path }}</code>
                  <span class="rounded-full border border-line px-2 py-0.5 text-[12px] whitespace-nowrap text-text2">{{ API_AUTH[e.auth].label }}</span>
                  <UIcon name="i-lucide-chevron-down" class="size-4 flex-none text-text3 transition-transform group-open:rotate-180" />
                  <!-- The first sentence, so a closed list still reads as an index. -->
                  <span class="col-start-2 col-end-5 truncate text-sm text-text3 group-open:hidden">{{ leadSentence(e.summary) }}</span>
                </summary>
                <div class="flex flex-col gap-3 pb-5">
                  <p class="m-0 max-w-[68ch] text-[15px] leading-normal text-text2">{{ e.summary }}</p>
                  <div v-if="e.request">
                    <h4 class="m-0 mb-1 text-[13px] font-semibold text-text2">Send</h4>
                    <ApiCode :text="e.request" label="request" />
                  </div>
                  <div v-if="e.response">
                    <h4 class="m-0 mb-1 text-[13px] font-semibold text-text2">You get</h4>
                    <ApiCode :text="e.response" label="response" />
                  </div>
                </div>
              </details>
            </div>
          </section>

          <div v-if="!allShown.length" class="bg-surface p-8 text-center">
            <p class="m-0 text-[15px] font-medium">No route matches "{{ query }}".</p>
            <p class="m-0 mt-1 text-sm text-text3">Try a path, a verb like claim, or a sign-in type like token.</p>
            <button type="button" class="mt-4 h-10 cursor-pointer rounded border border-line px-3 text-[15px] font-medium hover:bg-(--ab-row-hover)" @click="query = ''">Clear search</button>
          </div>
        </main>
      </div>
    </div>
  </div>
</template>
