<script setup lang="ts">
// Registry · Plan an agent: a wizard that follows form.gov-register-agent's sections and labels (spec screen 5).
// The last step rehearses the registration, then records it: the row as declared and a review awaiting approval.
import { boardOwnerName } from '~/types/board'
import type { AccessRow, Lifecycle, RegistryRow } from '~/types/registry'
import {
  ACTIONS, AGENT_TYPES, APPROVAL_RULES, DISPATCH_LINES, DOMAINS, ENFORCEMENT_POINTS, FIELD_LABELS, HOSTS, INFERENCES,
  LIFECYCLE_LABELS, REACH_LABELS, REACHABILITIES, RUNTIMES
} from '~/types/registry'
import type { RequestDraft } from '~/utils/registry'
import { AGENT_ID_PATTERN, flagsFor, gateItems, looksLikeSecret, signalsFor } from '~/utils/registry'
import { API_AGENT_CLASS_RESOURCE, API_AGENT_PREFILL, avatarFor } from '~/types/board'

useHead({ title: 'Plan an agent · Registry' })
const registry = useRegistryStore()
const route = useRoute()
const { composer } = useRegistryUi()

const STEPS = ['Boundary check', 'Who it is', 'What it does and never does', 'Where it runs', 'How it starts', 'Access it will need', 'Review']
const step = ref(0)

// ---------- Step 1: an agent is a permission boundary (design rule 9) ----------
const boundary = reactive({ credentials: false, host: false, audit: false })
const needsAgent = computed(() => boundary.credentials || boundary.host || boundary.audit)
const similarType = ref('advisor')
const similar = computed(() => registry.registry.filter(r => r.agent_type === similarType.value && r.lifecycle_status !== 'retired'))

// ---------- The registry row being planned ----------
const from = typeof route.query.from === 'string' ? route.query.from : ''
const blank = (): RegistryRow => Object.fromEntries(Object.keys(registry.registry[0] ?? {}).map(k => [k, ''])) as RegistryRow
const row = reactive<RegistryRow>({
  ...blank(),
  agent_id: '',
  name: from,
  description: from ? `Registers ${from}, found by the drift loader outside any registered agent.` : '',
  owner: boardOwnerName(),
  domain: 'personal',
  lifecycle_status: 'proposed',
  deploy_state: 'declared',
  runtime: from ? 'n8n_cloud' : '',
  host: from ? 'hosted' : '',
  agent_type: from ? 'gateway' : '',
  schema_version: '1.2'
})
// "Register API agent" (?lane=api): the API-agent fields filled in, and the class-general access row drafted.
// There is no key field. The provider key is an n8n credential, named in gov_config api.agents and never entered here.
const apiLane = route.query.lane === 'api'
if (apiLane) Object.assign(row, API_AGENT_PREFILL, { agent_id: 'agt-api-', name: 'API agent' })
const triggers = ref<string[]>([])
watch(triggers, t => { row.triggers = t.join(',') }, { deep: true })

// Picking a type with a definition prefills request types and a starter never-list from an agent of that type.
watch(() => row.agent_type, (type) => {
  const model = registry.registry.find(r => r.agent_type === type && r.type_version)
  if (!model) return
  row.type_version = model.type_version
  if (!row.request_types) row.request_types = model.request_types
  if (!row.exclusions) row.exclusions = model.exclusions
})

const idError = computed(() => {
  if (!row.agent_id) return ''
  if (!AGENT_ID_PATTERN.test(row.agent_id)) return 'Must match ^agt-[a-z0-9-]+$ (lowercase letters, numbers and dashes after agt-)'
  if (registry.agent(row.agent_id)) return `${row.agent_id} is already in the registry. IDs are never reused.`
  return ''
})
const idOk = computed(() => !!row.agent_id && !idError.value)

// ---------- Step 6: draft access rows ----------
const access = ref<AccessRow[]>([])
function addAccess() {
  access.value.push({ access_id: '', agent_id: row.agent_id, resource: '', resource_domain: row.domain, action: 'read', scope: '', environment: 'production', sensitivity: 'internal', approval_rule: 'none', enforcement_point: 'workflow_structure', cross_domain: false, grade: 'proposed', verified_at: '', evidence: '' })
}
function hints(a: AccessRow): string[] {
  const out: string[] = []
  if (['send', 'spend', 'delete', 'approve'].includes(a.action) && a.approval_rule === 'none') out.push(`${a.action} needs an approval rule.`)
  if (a.resource_domain && a.resource_domain !== row.domain) out.push('Cross-domain rows need a review.')
  if (a.enforcement_point === 'prompt_only') out.push('prompt_only is never verified.')
  return out
}
if (apiLane) {
  addAccess()
  Object.assign(access.value[0]!, { resource: API_AGENT_CLASS_RESOURCE, action: 'read', approval_rule: 'none', enforcement_point: 'caller_policy', scope: 'Cards tagged class-general only; no other class.' })
}
watch([access, () => row.domain], () => {
  for (const a of access.value) a.cross_domain = !!a.resource_domain && a.resource_domain !== row.domain
}, { deep: true })

// ---------- Step 7: preview, checklist, rehearsal ----------
const buildCard = ref(true)
const preview = computed(() => {
  const r = { ...row } as RegistryRow
  const signals = signalsFor(r, { access: access.value, live: undefined, reviews: [], upgradeCards: 0, unreadableHosts: [] })
  return { row: r, signals, flags: flagsFor(signals, false), attention: false, requested: [], avatar: avatarFor(r.agent_id, r.name || 'New') }
})
const activeChecklist = computed(() => gateItems({ ...row, deploy_state: 'declared' } as RegistryRow, 'active', access.value.length, ''))
const draft = computed<RequestDraft>(() => ({
  kind: 'register',
  agent_id: row.agent_id,
  title: `Register ${row.agent_id || '[agent id]'}: ${row.agent_type || 'untyped'} on ${row.host || 'an unknown host'}, lifecycle ${row.lifecycle_status}, ${access.value.length} access row${access.value.length === 1 ? '' : 's'} proposed`,
  diffs: [],
  newAgent: { ...row } as RegistryRow,
  newAccess: access.value.map(a => ({ ...a, agent_id: row.agent_id })),
  buildCard: buildCard.value,
  note: ''
}))
const secretWarning = computed(() => Object.values(row).some(v => typeof v === 'string' && looksLikeSecret(v)))

const canNext = computed(() => {
  if (step.value === 1) return idOk.value && !!row.name && !!row.owner
  return true
})
const STATUS_INTERFACES = ['ledger_table', 'get_agent', 'read_workflow', 'self_report', 'none']
const TRIGGERS = ['chat', 'slack', 'telegram', 'schedule', 'workflow', 'mcp', 'webhook']
const inputCls = 'h-10 rounded border border-input bg-surface px-2.5 text-sm font-normal text-ink'
const areaCls = 'w-full resize-y rounded border border-input bg-surface px-2.5 py-2 text-sm font-normal text-ink'
const labelCls = 'flex flex-col gap-1.5 text-sm font-semibold text-text2'
</script>

<template>
  <RegistryShell v-slot="{ phone }">
    <main class="mx-auto flex w-full max-w-[1200px] flex-1 gap-6" :class="phone ? 'flex-col px-4 pt-3 pb-24' : 'px-6 pt-6 pb-12'">
      <div class="flex min-w-0 flex-1 flex-col gap-4">
        <div class="rg-head">
          <h2 class="rg-h2">Plan an agent</h2>
          <p class="m-0 mt-1.5 text-sm text-text3">Follows form.gov-register-agent. Nothing is written until the last step's Record.</p>
        </div>

        <ol class="ab-row m-0 flex w-fit max-w-full list-none gap-0.5 overflow-x-auto rounded bg-surface p-[3px]" aria-label="Steps">
          <li v-for="(s, i) in STEPS" :key="s" class="flex-none">
            <button
              type="button"
              :aria-current="step === i ? 'step' : undefined"
              class="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-[3px] px-3 text-sm disabled:cursor-not-allowed"
              :class="step === i ? 'bg-ink font-semibold text-surface' : i < step ? 'font-medium text-ink hover:bg-(--ab-row-hover)' : 'font-medium text-text3 hover:bg-(--ab-row-hover)'"
              :disabled="i > step && !canNext"
              @click="step = i"
            >
              <span class="font-display text-base font-bold">{{ i + 1 }}</span>{{ phone && step !== i ? '' : s }}
            </button>
          </li>
        </ol>

        <section class="flex flex-col gap-4 bg-surface p-5" :aria-labelledby="`rg-step-${step}`">
          <h3 :id="`rg-step-${step}`" class="rg-h3 rg-head text-[24px]!">{{ step + 1 }}. {{ STEPS[step] }}</h3>

          <!-- 1. Boundary check -->
          <template v-if="step === 0">
            <p class="m-0 text-sm">Does it need its own credentials, its own host, or its own audit trail?</p>
            <label v-for="(text, key) in { credentials: 'Its own credentials', host: 'Its own host', audit: 'Its own audit trail' }" :key="key" class="flex h-10 cursor-pointer items-center gap-2 text-sm">
              <input v-model="boundary[key]" type="checkbox" class="size-4 accent-ink">{{ text }}
            </label>
            <div v-if="!needsAgent" class="flex flex-col gap-2.5 border-l-[5px] border-accent bg-ground p-3.5 text-sm text-ink">
              <p class="m-0">An agent is a permission boundary. Without its own credentials, host or audit trail, add a skill or request type to an existing agent instead.</p>
              <label class="flex items-center gap-2 font-semibold">Agents of type
                <select v-model="similarType" class="ab-select font-normal"><option v-for="t in AGENT_TYPES" :key="t" :value="t">{{ t }}</option></select>
              </label>
              <ul class="m-0 flex list-none flex-col gap-1.5 p-0">
                <li v-for="r in similar" :key="r.agent_id" class="flex flex-wrap items-center gap-2 text-ink">
                  <span class="font-semibold">{{ r.name }}</span><span class="font-mono text-xs">{{ r.agent_id }}</span>
                  <span class="text-xs text-text3">{{ r.request_types || 'no request types filed' }}</span>
                  <button type="button" class="rg-link ml-auto" @click="composer = { agentId: r.agent_id, mode: 'behavior' }">Add a request type instead</button>
                </li>
                <li v-if="!similar.length" class="text-text3">No agents of that type yet.</li>
              </ul>
            </div>
          </template>

          <!-- 2. Who it is -->
          <template v-else-if="step === 1">
            <label :class="labelCls">{{ FIELD_LABELS.agent_id }}
              <input v-model.trim="row.agent_id" placeholder="agt-" :class="[inputCls, 'font-mono']" :aria-invalid="!!idError">
              <span v-if="idError" class="font-normal text-(--ab-red-text)">{{ idError }}</span>
              <span v-else-if="idOk" class="font-normal text-(--ab-green-fg)">✓ Available</span>
            </label>
            <label :class="labelCls">{{ FIELD_LABELS.name }} <span class="font-normal text-text3">A nickname; it may change.</span><input v-model="row.name" :class="inputCls"></label>
            <label :class="labelCls">{{ FIELD_LABELS.description }}<textarea v-model="row.description" rows="2" :class="areaCls" /></label>
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label :class="labelCls">{{ FIELD_LABELS.owner }}<input v-model="row.owner" :class="inputCls"></label>
              <label :class="labelCls">{{ FIELD_LABELS.domain }}<select v-model="row.domain" class="ab-select"><option v-for="d in DOMAINS" :key="d" :value="d">{{ d }}</option></select></label>
            </div>
          </template>

          <!-- 3. What it does and never does -->
          <template v-else-if="step === 2">
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label :class="labelCls">{{ FIELD_LABELS.responsibilities }}<textarea v-model="row.responsibilities" rows="5" :class="areaCls" /></label>
              <label :class="labelCls">{{ FIELD_LABELS.exclusions }}<textarea v-model="row.exclusions" rows="5" :class="areaCls" /></label>
            </div>
            <label :class="labelCls">{{ FIELD_LABELS.expected_outputs }}<textarea v-model="row.expected_outputs" rows="2" :class="areaCls" /></label>
            <label :class="labelCls">{{ FIELD_LABELS.intended_users }}<input v-model="row.intended_users" :class="inputCls"></label>
          </template>

          <!-- 4. Where it runs and what kind it is -->
          <template v-else-if="step === 3">
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label :class="labelCls">{{ FIELD_LABELS.runtime }}<select v-model="row.runtime" class="ab-select"><option value="">Not filed</option><option v-for="r in RUNTIMES" :key="r" :value="r">{{ r }}</option></select></label>
              <label :class="labelCls">{{ FIELD_LABELS.host }}<select v-model="row.host" class="ab-select"><option value="">Not filed</option><option v-for="h in HOSTS" :key="h" :value="h">{{ h }}</option></select></label>
              <label :class="labelCls">{{ FIELD_LABELS.environment }}<input v-model="row.environment" :class="inputCls"></label>
              <label :class="labelCls">{{ FIELD_LABELS.deploy_ref }}<input v-model="row.deploy_ref" :class="[inputCls, 'font-mono']"></label>
              <label :class="labelCls">{{ FIELD_LABELS.agent_type }}<select v-model="row.agent_type" class="ab-select"><option value="">Not filed</option><option v-for="t in AGENT_TYPES" :key="t" :value="t">{{ t }}</option></select></label>
              <label :class="labelCls">{{ FIELD_LABELS.type_version }}<input v-model="row.type_version" :class="[inputCls, 'font-mono']"></label>
              <label :class="labelCls">{{ FIELD_LABELS.inference }}<select v-model="row.inference" class="ab-select"><option value="">Not filed</option><option v-for="i in INFERENCES" :key="i" :value="i">{{ i }}</option></select></label>
              <label :class="labelCls" class="sm:col-span-2">{{ FIELD_LABELS.reachability }}
                <select v-model="row.reachability" class="ab-select"><option value="">Not filed</option><option v-for="r in REACHABILITIES" :key="r" :value="r">{{ REACH_LABELS[r] }} · {{ r }}</option></select>
              </label>
            </div>
            <p class="m-0 bg-ground px-3 py-2 text-sm">
              <span class="font-semibold">Dispatch:</span> {{ DISPATCH_LINES[row.reachability] ?? 'Pick reachability to see how the orchestrator will reach it.' }}
            </p>
          </template>

          <!-- 5. How it starts and how you watch it -->
          <template v-else-if="step === 4">
            <label :class="labelCls">{{ FIELD_LABELS.request_types }} <span class="font-normal text-text3">Comma-separated</span><input v-model="row.request_types" :class="[inputCls, 'font-mono']"></label>
            <fieldset class="m-0 flex flex-col gap-1.5 border-0 p-0">
              <legend class="mb-1.5 text-xs font-semibold text-text2">{{ FIELD_LABELS.triggers }}</legend>
              <div class="flex flex-wrap gap-x-4">
                <label v-for="t in TRIGGERS" :key="t" class="flex h-10 cursor-pointer items-center gap-1.5 font-mono text-[13px]"><input v-model="triggers" type="checkbox" :value="t" class="size-4 accent-ink">{{ t }}</label>
              </div>
            </fieldset>
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label :class="labelCls">{{ FIELD_LABELS.status_interface }}<select v-model="row.status_interface" class="ab-select"><option value="">Not filed</option><option v-for="s in STATUS_INTERFACES" :key="s" :value="s">{{ s }}</option></select></label>
              <label :class="labelCls">{{ FIELD_LABELS.log_location }} <span class="font-normal text-text3">Table name only, never rows</span><input v-model="row.log_location" :class="[inputCls, 'font-mono']"></label>
            </div>
            <label :class="labelCls">{{ FIELD_LABELS.depends_on }}<input v-model="row.depends_on" :class="inputCls"></label>
          </template>

          <!-- 6. Access it will need -->
          <template v-else-if="step === 5">
            <p class="m-0 text-[13px] text-text2">Each row is filed as proposed. It becomes current access only after deployment and a verification read.</p>
            <div v-for="(a, i) in access" :key="i" class="flex flex-col gap-2.5 border-l-[5px] border-line bg-ground p-3">
              <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-[minmax(0,2fr)_repeat(2,minmax(0,1fr))]">
                <label :class="labelCls">Resource<input v-model="a.resource" placeholder="system:type:name" :class="[inputCls, 'font-mono']"></label>
                <label :class="labelCls">Action<select v-model="a.action" class="ab-select"><option v-for="x in ACTIONS" :key="x" :value="x">{{ x }}</option></select></label>
                <label :class="labelCls">Resource domain<select v-model="a.resource_domain" class="ab-select"><option v-for="d in DOMAINS.filter(d => d !== 'cross_domain')" :key="d" :value="d">{{ d }}</option></select></label>
                <label :class="labelCls">Scope<input v-model="a.scope" :class="inputCls"></label>
                <label :class="labelCls">Enforced by<select v-model="a.enforcement_point" class="ab-select"><option v-for="e in ENFORCEMENT_POINTS" :key="e" :value="e">{{ e }}</option></select></label>
                <label :class="labelCls">Approval rule<select v-model="a.approval_rule" class="ab-select"><option v-for="r in APPROVAL_RULES" :key="r" :value="r">{{ r }}</option></select></label>
              </div>
              <ul v-if="hints(a).length" class="m-0 flex flex-col gap-0.5 pl-4.5 text-[13px] text-(--ab-red-text)"><li v-for="h in hints(a)" :key="h">{{ h }}</li></ul>
              <button type="button" class="rg-link self-start text-[13px]" @click="access.splice(i, 1)">Remove row</button>
            </div>
            <button type="button" class="rg-btn rg-btn-line self-start" @click="addAccess">Add an access row</button>
          </template>

          <!-- 7. Review -->
          <template v-else>
            <fieldset class="m-0 flex flex-col gap-1.5 border-0 p-0">
              <legend class="mb-1.5 text-xs font-semibold text-text2">{{ FIELD_LABELS.lifecycle_status }}</legend>
              <div class="flex flex-wrap gap-x-4">
                <label v-for="lc in (['proposed', 'in_development', 'template'] as Lifecycle[])" :key="lc" class="flex h-10 cursor-pointer items-center gap-1.5 text-sm">
                  <input v-model="row.lifecycle_status" type="radio" :value="lc" class="size-4 accent-ink">{{ LIFECYCLE_LABELS[lc] }}
                </label>
              </div>
            </fieldset>
            <label class="flex h-10 cursor-pointer items-center gap-2 text-sm"><input v-model="buildCard" type="checkbox" class="size-4 accent-ink">Also add a Build card to Backlog (pol-0003: waits for your start)</label>
            <p v-if="secretWarning" role="alert" class="m-0 rounded border border-(--ab-red-line) px-3 py-2 text-[13px] text-(--ab-red-text)">A field looks like a key or token. Refer to credentials by name only.</p>
            <RegistryRehearsal :draft="draft" :blocked="!idOk" blocked-text="Fill in a valid, unused Agent ID in step 2 first.">
              <template #secondary>
                <button type="button" class="rg-btn rg-btn-line h-11" @click="step--">Back</button>
              </template>
              <template #done>
                <NuxtLink :to="{ path: '/registry', query: { agent: row.agent_id } }" class="rg-btn rg-btn-ink h-11">Open in Fleet</NuxtLink>
              </template>
            </RegistryRehearsal>
          </template>

          <div v-if="step < STEPS.length - 1" class="flex items-center gap-2.5 border-t border-line pt-4">
            <button v-if="step > 0" type="button" class="rg-btn rg-btn-line h-11" @click="step--">Back</button>
            <span class="flex-1" />
            <button type="button" class="rg-btn rg-btn-ink h-11" :disabled="!canNext" @click="step++">
              {{ step === 0 && !needsAgent ? 'Plan an agent anyway' : 'Next' }}
            </button>
          </div>
        </section>
      </div>

      <!-- Right rail: the card preview and the checklist the agent must pass to become Active. -->
      <aside :class="phone ? '' : 'sticky top-20 w-[320px] flex-none self-start'" class="flex flex-col gap-3">
        <details :open="!phone" class="flex flex-col gap-2">
          <summary class="h-10 cursor-pointer font-display text-xl leading-10 font-bold" :class="phone && 'rg-btn rg-btn-line normal-case tracking-normal'">{{ phone ? 'Preview' : 'Card preview' }}</summary>
          <RegistryAgentCard :view="preview" />
        </details>
        <div class="flex flex-col gap-2 bg-surface p-3.5">
          <h3 class="rg-h3 rg-head">To become Active it needs</h3>
          <ul class="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px]">
            <li v-for="it in activeChecklist" :key="it.label" class="flex gap-2">
              <span class="font-semibold" :class="it.pass ? 'text-(--ab-green-fg)' : 'text-text3'">{{ it.pass ? '✓' : '○' }}</span>
              <span class="flex flex-col"><span>{{ it.label }}</span><span class="text-xs text-text3">{{ it.detail }}</span></span>
            </li>
          </ul>
          <p class="m-0 text-xs text-text3">A verified deployment comes later, from a verification read.</p>
        </div>
      </aside>
    </main>
  </RegistryShell>
</template>
