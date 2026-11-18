<script setup lang="ts">
// Change request composer (spec screen 6). It picks the write path from what changed:
// registry metadata → Correct Registry; access → Change Access, Correct Access or Verify Access;
// behavior or config (instructions, tools, model, skills) → an upgrade card. Then rehearse, then record.
import type { AccessRow } from '~/types/registry'
import { ACTIONS, APPROVAL_RULES, BEHAVIOR_FIELDS, DOMAINS, ENFORCEMENT_POINTS, FIELD_LABELS, SECTIONS } from '~/types/registry'
import type { RequestDraft } from '~/utils/registry'
import { looksLikeSecret, materialReasons, REQUEST_PATHS, severityFor } from '~/utils/registry'

defineProps<{ phone?: boolean }>()
const registry = useRegistryStore()
const { composer } = useRegistryUi()

const open = computed({
  get: () => !!composer.value,
  set: (v: boolean) => { if (!v) composer.value = null }
})

const row = computed(() => composer.value ? registry.agent(composer.value.agentId) : undefined)
const accessRow = computed(() => composer.value?.accessId ? registry.access.find(a => a.access_id === composer.value!.accessId) : undefined)

// ---------- Form state, reset each time the composer opens ----------

const field = ref('')
const value = ref('')
const note = ref('')
const upgradeTitle = ref('')
const evidence = ref('')
const correctField = ref<'scope' | 'enforcement_point' | 'approval_rule'>('scope')
const correctValue = ref('')
const newAccess = ref<Partial<AccessRow>>({})

const EDITABLE = SECTIONS.flatMap(s => s.fields).filter(f => !['agent_id', 'deploy_state', 'fact_grades', 'last_reviewed_at', 'last_reviewed_by', 'schema_version', 'lifecycle_status'].includes(f))
const isBehavior = computed(() => (BEHAVIOR_FIELDS as readonly string[]).includes(field.value))

// Opening sets field and value together, so the field watcher skips that one change.
let opening = false
watch(composer, (c) => {
  if (!c || !row.value) return
  opening = true
  field.value = c.mode === 'behavior' ? 'instructions' : c.field ?? 'description'
  value.value = c.field && !isBehavior.value ? (registry.requestedValue(c.agentId, c.field)?.new_value ?? row.value[c.field] ?? '') : ''
  if (c.field === 'expected_version' && !row.value.expected_version) value.value = registry.deployed?.agents[c.agentId]?.active_version ?? ''
  note.value = ''
  upgradeTitle.value = ''
  evidence.value = ''
  correctField.value = 'scope'
  correctValue.value = accessRow.value?.scope ?? ''
  newAccess.value = { resource: '', action: 'read', scope: '', enforcement_point: 'workflow_structure', approval_rule: 'none', resource_domain: row.value.domain, environment: 'production', sensitivity: 'internal' }
  nextTick(() => { opening = false })
}, { immediate: true })

watch(field, (f) => {
  if (opening) return
  if (!row.value || composer.value?.mode !== 'field') return
  if (!isBehavior.value) value.value = row.value[f] ?? ''
})
watch(correctField, (f) => { correctValue.value = String(accessRow.value?.[f] ?? '') })

const mode = computed(() => (composer.value?.mode === 'field' && isBehavior.value) ? 'behavior' : composer.value?.mode)

// ---------- The draft the panel rehearses ----------

const draft = computed<RequestDraft>(() => {
  const r = row.value
  const base = { agent_id: r?.agent_id ?? '', note: note.value.trim() }
  if (!r) return { ...base, kind: 'correct_registry', title: '', diffs: [] }
  if (mode.value === 'behavior') {
    return { ...base, kind: 'upgrade', title: upgradeTitle.value.trim() || `Upgrade ${r.name}: change ${field.value}`, diffs: [] }
  }
  if (mode.value === 'access_new') {
    const a = newAccess.value
    const row: AccessRow = {
      access_id: '', agent_id: r.agent_id, resource: a.resource?.trim() ?? '', resource_domain: a.resource_domain ?? '', action: a.action ?? 'read',
      scope: a.scope?.trim() ?? '', environment: a.environment ?? '', sensitivity: a.sensitivity ?? '', approval_rule: a.approval_rule ?? 'none',
      enforcement_point: a.enforcement_point ?? 'unknown', cross_domain: !!a.resource_domain && a.resource_domain !== r.domain, grade: 'proposed', verified_at: '', evidence: ''
    }
    return { ...base, kind: 'change_access', title: `Request ${row.action} on ${row.resource || '[resource]'} for ${r.agent_id}`, diffs: [], newAccess: [row] }
  }
  if (mode.value === 'access_correct' && accessRow.value) {
    const a = accessRow.value
    return { ...base, kind: 'correct_access', title: `Correct ${a.access_id} ${correctField.value} for ${r.agent_id}`,
      diffs: [{ table: 'gov_access', row_key: a.access_id, field: correctField.value, old: String(a[correctField.value] ?? ''), new: correctValue.value.trim() }] }
  }
  if (mode.value === 'access_verify' && accessRow.value) {
    const a = accessRow.value
    const today = new Date().toISOString().slice(0, 10)
    return { ...base, kind: 'verify_access', title: `Verify ${a.access_id} for ${r.agent_id}`,
      diffs: evidence.value.trim()
        ? [{ table: 'gov_access', row_key: a.access_id, field: 'grade', old: a.grade, new: 'verified' },
            { table: 'gov_access', row_key: a.access_id, field: 'verified_at', old: a.verified_at, new: today },
            { table: 'gov_access', row_key: a.access_id, field: 'evidence', old: a.evidence, new: evidence.value.trim() }]
        : [] }
  }
  return { ...base, kind: 'correct_registry', title: `Correct ${FIELD_LABELS[field.value] ?? field.value} on ${r.agent_id}`,
    diffs: [{ table: 'gov_registry', row_key: r.agent_id, field: field.value, old: r[field.value] ?? '', new: value.value.trim() }] }
})

const material = computed(() => materialReasons(draft.value))
const severity = computed(() => severityFor(draft.value))
const accessHints = computed(() => {
  const a = newAccess.value
  const hints: string[] = []
  if (['send', 'spend', 'delete', 'approve'].includes(a.action ?? '')) hints.push(`${a.action} needs an approval rule other than none.`)
  if (row.value && a.resource_domain && a.resource_domain !== row.value.domain) hints.push('Cross-domain: this row needs a review.')
  if (a.enforcement_point === 'prompt_only') hints.push('prompt_only is never verified: the row stays proposed or declared.')
  return hints
})
const secretWarning = computed(() => [value.value, note.value, evidence.value, correctValue.value, newAccess.value.resource ?? '', newAccess.value.scope ?? ''].some(looksLikeSecret))

const titles: Record<string, string> = {
  field: 'Request a change',
  behavior: 'Request a behavior change',
  access_new: 'Request access',
  access_correct: 'Correct an access row',
  access_verify: 'Verify an access row'
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="titles[mode ?? 'field']"
    description="Change request composer"
    :fullscreen="phone"
    :ui="{ content: phone ? '' : 'max-w-[680px]' }"
  >
    <template #content="{ close }">
      <div v-if="row && composer" class="rg-sheet flex max-h-[90dvh] flex-col gap-4 overflow-y-auto p-5.5">
        <div class="flex items-start gap-2.5">
          <div class="flex flex-1 flex-col gap-1">
            <span class="text-xs font-bold tracking-[0.06em] text-text3 uppercase">{{ titles[mode ?? 'field'] }}</span>
            <h2 class="m-0 text-lg font-semibold">{{ row.name }} <span class="font-mono text-[13px] font-medium text-text3">{{ row.agent_id }}</span></h2>
            <span class="text-xs text-text3">Path: <span class="font-mono">{{ REQUEST_PATHS[draft.kind] }}</span></span>
          </div>
          <button type="button" aria-label="Close" class="inline-flex size-11 cursor-pointer items-center justify-center rounded text-text2 hover:bg-chip" @click="close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <!-- Registry field or behavior -->
        <template v-if="mode === 'field' || mode === 'behavior'">
          <label class="flex flex-col gap-1.5 text-xs font-semibold text-text2">
            What to change
            <select v-model="field" class="ab-select">
              <optgroup label="Registry fields (Correct Registry)">
                <option v-for="f in EDITABLE" :key="f" :value="f">{{ FIELD_LABELS[f] ?? f }} · {{ f }}</option>
              </optgroup>
              <optgroup label="Behavior in n8n (upgrade card)">
                <option v-for="f in BEHAVIOR_FIELDS" :key="f" :value="f">{{ f }}</option>
              </optgroup>
            </select>
          </label>

          <template v-if="mode === 'field'">
            <label class="flex flex-col gap-1.5 text-xs font-semibold text-text2">
              New value
              <textarea v-model="value" rows="3" class="w-full resize-y rounded border border-input px-2.5 py-2 font-mono text-[13px] font-normal text-ink" />
            </label>
            <div class="flex flex-col gap-1.5 rounded border border-line p-3">
              <h3 class="rg-h3 rg-head">Before and after</h3>
              <dl class="m-0 grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
                <dt class="text-text3">Now</dt>
                <dd class="m-0 break-words text-text3 line-through">{{ row[field] || 'blank (Unknown)' }}</dd>
                <dt class="text-text3">Requested</dt>
                <dd class="m-0 rounded bg-(--ab-blue-tint) px-1.5 break-words">{{ value || 'blank' }}</dd>
              </dl>
            </div>
          </template>
          <template v-else>
            <div class="rounded border border-(--ab-blue-line) bg-(--ab-blue-tint) p-3 text-[13px] leading-normal text-(--ab-blue-strong)">
              {{ field }} lives in n8n, not the registry. Behavior changes are upgrade tasks (design rule 5): this creates a board card with
              <span class="font-mono">task_type = upgrade</span> and <span class="font-mono">upgrade_target = {{ row.agent_id }}</span>.
              pol-0004 makes it wait for your approval and a manual start. The Registry never publishes to n8n.
            </div>
            <label class="flex flex-col gap-1.5 text-xs font-semibold text-text2">
              Card title
              <input v-model="upgradeTitle" :placeholder="`Upgrade ${row.name}: change ${field}`" class="h-10 rounded border border-input px-2.5 text-sm font-normal text-ink">
            </label>
          </template>
        </template>

        <!-- New access row -->
        <template v-else-if="mode === 'access_new'">
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label class="flex flex-col gap-1.5 text-xs font-semibold text-text2 sm:col-span-2">
              Resource <span class="font-normal text-text3">system:type:name, for example n8n:datatable:vera_ledger</span>
              <input v-model="newAccess.resource" class="h-10 rounded border border-input px-2.5 font-mono text-[13px] font-normal text-ink">
            </label>
            <label class="flex flex-col gap-1.5 text-xs font-semibold text-text2">
              Action
              <select v-model="newAccess.action" class="ab-select"><option v-for="a in ACTIONS" :key="a" :value="a">{{ a }}</option></select>
            </label>
            <label class="flex flex-col gap-1.5 text-xs font-semibold text-text2">
              Resource domain
              <select v-model="newAccess.resource_domain" class="ab-select"><option v-for="d in DOMAINS.filter(d => d !== 'cross_domain')" :key="d" :value="d">{{ d }}</option></select>
            </label>
            <label class="flex flex-col gap-1.5 text-xs font-semibold text-text2">
              Enforcement point
              <select v-model="newAccess.enforcement_point" class="ab-select"><option v-for="e in ENFORCEMENT_POINTS" :key="e" :value="e">{{ e }}</option></select>
            </label>
            <label class="flex flex-col gap-1.5 text-xs font-semibold text-text2">
              Approval rule
              <select v-model="newAccess.approval_rule" class="ab-select"><option v-for="a in APPROVAL_RULES" :key="a" :value="a">{{ a }}</option></select>
            </label>
            <label class="flex flex-col gap-1.5 text-xs font-semibold text-text2 sm:col-span-2">
              Scope
              <input v-model="newAccess.scope" placeholder="What exactly, and how it's limited" class="h-10 rounded border border-input px-2.5 text-sm font-normal text-ink">
            </label>
          </div>
          <ul v-if="accessHints.length" class="m-0 flex flex-col gap-1 border-l-[5px] border-(--ab-red) bg-ground py-2.5 pr-3 pl-7 text-[13px] text-ink">
            <li v-for="h in accessHints" :key="h">{{ h }}</li>
          </ul>
        </template>

        <!-- Correct an access row: never widens access or changes a grade -->
        <template v-else-if="mode === 'access_correct' && accessRow">
          <p class="m-0 text-[13px] text-text2"><span class="font-mono">{{ accessRow.access_id }}</span> · {{ accessRow.resource }} · {{ accessRow.action }}. A correction never widens access or changes a grade; a reject restores the old value.</p>
          <label class="flex flex-col gap-1.5 text-xs font-semibold text-text2">
            Field
            <select v-model="correctField" class="ab-select">
              <option value="scope">scope</option>
              <option value="enforcement_point">enforcement_point</option>
              <option value="approval_rule">approval_rule</option>
            </select>
          </label>
          <label class="flex flex-col gap-1.5 text-xs font-semibold text-text2">
            Corrected value
            <select v-if="correctField === 'enforcement_point'" v-model="correctValue" class="ab-select"><option v-for="e in ENFORCEMENT_POINTS" :key="e" :value="e">{{ e }}</option></select>
            <select v-else-if="correctField === 'approval_rule'" v-model="correctValue" class="ab-select"><option v-for="a in APPROVAL_RULES" :key="a" :value="a">{{ a }}</option></select>
            <textarea v-else v-model="correctValue" rows="3" class="w-full resize-y rounded border border-input px-2.5 py-2 text-sm font-normal text-ink" />
          </label>
          <div class="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1.5 rounded border border-line p-3 text-[13px]">
            <span class="text-text3">Now</span><span class="break-words text-text3 line-through">{{ accessRow[correctField] || 'blank' }}</span>
            <span class="text-text3">Requested</span><span class="rounded bg-(--ab-blue-tint) px-1.5 break-words">{{ correctValue || 'blank' }}</span>
          </div>
        </template>

        <!-- Verify: the owner supplies the evidence -->
        <template v-else-if="mode === 'access_verify' && accessRow">
          <p class="m-0 text-[13px] text-text2"><span class="font-mono">{{ accessRow.access_id }}</span> · {{ accessRow.resource }} · {{ accessRow.action }} · now <RegistryGradeBadge :grade="accessRow.grade" /></p>
          <p v-if="accessRow.enforcement_point === 'prompt_only'" class="m-0 rounded border border-(--ab-red-line) p-3 text-[13px] text-(--ab-red-text)">prompt_only rows are never verified. Correct the enforcement point first.</p>
          <label class="flex flex-col gap-1.5 text-xs font-semibold text-text2">
            Evidence <span class="font-normal text-text3">What you read, where, and when. Workflow and node names only.</span>
            <textarea v-model="evidence" rows="3" class="w-full resize-y rounded border border-input px-2.5 py-2 text-sm font-normal text-ink" />
          </label>
        </template>

        <label class="flex flex-col gap-1.5 text-xs font-semibold text-text2">
          Note for the review (optional)
          <textarea v-model="note" rows="2" placeholder="Why, in a sentence" class="w-full resize-y rounded border border-input px-2.5 py-2 text-sm font-normal text-ink" />
        </label>
        <p v-if="secretWarning" role="alert" class="m-0 rounded border border-(--ab-red-line) px-3 py-2 text-[13px] text-(--ab-red-text)">This looks like a key or token. Refer to credentials by name only.</p>

        <div v-if="mode !== 'behavior'" class="flex flex-wrap items-center gap-2 text-[13px]">
          <span class="font-semibold text-text2">Material change?</span>
          <span
            class="rounded-full px-2 py-0.5 text-xs font-semibold"
            :style="material.length ? { background: 'var(--color-surface)', color: 'var(--ab-red-text)', border: '1px solid var(--ab-red-line)' } : { background: 'var(--ab-neutral-bg)', color: 'var(--color-text2)', border: '1px solid var(--ab-neutral-bg)' }"
          >{{ material.length ? 'Material' : 'Not material' }}</span>
          <span v-if="material.length" class="text-text3">{{ material.join(' · ') }}</span>
          <span class="ml-auto text-text3">Severity <span class="font-mono">{{ severity }}</span></span>
        </div>

        <RegistryRehearsal :draft="draft" :blocked="mode === 'access_verify' && accessRow?.enforcement_point === 'prompt_only'" blocked-text="prompt_only is never verified.">
          <template #done>
            <button type="button" class="rg-btn rg-btn-ink h-11" @click="close">Done</button>
          </template>
        </RegistryRehearsal>
      </div>
    </template>
  </UModal>
</template>
