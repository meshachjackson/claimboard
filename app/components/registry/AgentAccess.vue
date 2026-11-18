<script setup lang="ts">
import { registrarAgent } from '~/types/board'
const registrar = registrarAgent()
// Access: Current (verified only) and Not current (proposed, declared, unknown). Only verified access is
// current access, so the two groups never mix (design rule 1). A row opens its evidence.
import type { AccessRow, RegistryRow } from '~/types/registry'
import { day } from '~/utils/registry'

const props = defineProps<{ row: RegistryRow, phone?: boolean }>()
const registry = useRegistryStore()
const { composer } = useRegistryUi()

const rows = computed(() => registry.accessFor(props.row.agent_id))
const current = computed(() => rows.value.filter(a => a.grade === 'verified'))
const notCurrent = computed(() => rows.value.filter(a => a.grade !== 'verified'))
const openId = ref('')
watch(() => props.row.agent_id, () => { openId.value = '' })

const groups = computed(() => [
  { id: 'current', title: 'Current', hint: `Verified only · ${current.value.length} row${current.value.length === 1 ? '' : 's'}`, rows: current.value },
  { id: 'not', title: 'Not current', hint: `Proposed, declared or unknown · not access yet · ${notCurrent.value.length} row${notCurrent.value.length === 1 ? '' : 's'}`, rows: notCurrent.value }
])

function rule(a: AccessRow): string {
  if (['send', 'spend', 'delete', 'approve'].includes(a.action) && a.approval_rule === 'none') return `${a.action} with no approval rule: needs one`
  if (a.cross_domain && a.grade !== 'verified') return 'Cross-domain: needs a review before it can be verified'
  if (a.enforcement_point === 'prompt_only') return 'prompt_only is never verified'
  return ''
}

// Ask the registrar (R0): a sample model answer. R1 files a real request through its run_ticket tool.
const question = ref('')
const answer = ref('')
function ask() {
  if (!question.value.trim()) return
  const nc = notCurrent.value
  answer.value = nc.length
    ? `No for ${nc.map(a => a.access_id).join(', ')}: ${nc.length === 1 ? 'that row is' : 'those rows are'} ${[...new Set(nc.map(a => a.grade))].join(' or ')}, not verified, so ${nc.length === 1 ? 'it isn\'t' : 'they aren\'t'} current access. Current access is the ${current.value.length} verified row${current.value.length === 1 ? '' : 's'} above.`
    : `Current access for ${props.row.agent_id} is the ${current.value.length} verified row${current.value.length === 1 ? '' : 's'} listed. Nothing is pending.`
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap items-center gap-2">
      <p class="m-0 flex-1 text-[13px] text-text2">{{ current.length }} verified · {{ notCurrent.length }} not current · only verified rows are current access.</p>
      <button type="button" class="rg-btn rg-btn-ink" :class="phone && 'h-11'" @click="composer = { agentId: row.agent_id, mode: 'access_new' }">Request access</button>
    </div>

    <section v-for="g in groups" :key="g.id" class="flex flex-col gap-2">
      <div class="flex items-baseline gap-2">
        <h3 class="rg-h3 rg-head">{{ g.title }}</h3>
        <span class="text-xs text-text3">{{ g.hint }}</span>
      </div>
      <p v-if="!g.rows.length" class="m-0 rounded border border-dashed border-line px-3 py-3 text-[13px] text-text3">
        {{ g.id === 'current' ? 'No verified access. This agent can touch nothing on record.' : 'Nothing pending.' }}
      </p>
      <div v-else class="overflow-x-auto rounded border border-line">
        <table class="w-full border-collapse text-left text-[13px]">
          <thead v-if="!phone" class="bg-filterbar text-xs text-text3">
            <tr>
              <th class="px-3 py-2 font-semibold">Resource</th>
              <th class="px-2 py-2 font-semibold">Action</th>
              <th class="px-2 py-2 font-semibold">Scope</th>
              <th class="px-2 py-2 font-semibold">Enforced by</th>
              <th class="px-2 py-2 font-semibold">Approval rule</th>
              <th class="px-2 py-2 font-semibold">Grade</th>
              <th class="px-2 py-2 font-semibold">{{ g.id === 'current' ? 'Verified on' : 'Since' }}</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="a in g.rows" :key="a.access_id">
              <tr class="cursor-pointer border-t border-(--ab-neutral-bg) align-top hover:bg-filterbar" :class="phone && 'flex flex-wrap gap-x-3 gap-y-1 px-3 py-2.5'" @click="openId = openId === a.access_id ? '' : a.access_id">
                <td :class="phone ? 'w-full' : 'px-3 py-2.5'">
                  <button type="button" :aria-expanded="openId === a.access_id" class="min-w-[180px] cursor-pointer text-left font-mono text-xs break-words text-ink">{{ a.resource }}</button>
                  <div class="text-xs text-text3">
                    <span class="font-mono">{{ a.access_id }}</span><template v-if="a.cross_domain"> · cross-domain</template><template v-if="a.synthetic"> · synthetic</template>
                  </div>
                </td>
                <td class="font-mono text-xs" :class="!phone && 'px-2 py-2.5'">{{ a.action }}</td>
                <td class="max-w-[160px] text-xs text-text2" :class="!phone && 'px-2 py-2.5'"><span class="rg-clamp">{{ a.scope || 'Unknown' }}</span></td>
                <td class="font-mono text-xs" :class="!phone && 'px-2 py-2.5'">{{ a.enforcement_point }}</td>
                <td class="font-mono text-xs" :class="!phone && 'px-2 py-2.5'">{{ a.approval_rule }}</td>
                <td :class="!phone && 'px-2 py-2.5'">
                  <span class="flex flex-col items-start gap-1">
                    <RegistryGradeBadge :grade="a.grade" />
                    <span v-if="registry.accessPending(a.access_id)" class="rounded bg-(--ab-orange-bg) px-1.5 py-px text-xs font-semibold text-(--ab-orange-fg)">Correction pending</span>
                  </span>
                </td>
                <td class="text-xs whitespace-nowrap text-text3" :class="!phone && 'px-2 py-2.5'">{{ day(g.id === 'current' ? a.verified_at : a.created_at) || 'Unknown' }}</td>
              </tr>
              <tr v-if="openId === a.access_id" class="bg-filterbar">
                <td colspan="7" class="px-3 py-3">
                  <div class="flex flex-col gap-2 text-[13px]">
                    <div class="flex items-center gap-2"><span class="font-mono font-semibold">{{ a.access_id }}</span><RegistryGradeBadge :grade="a.grade" /></div>
                    <p class="m-0 leading-normal"><span class="font-semibold">Evidence</span> {{ a.evidence || 'None yet. A proposed row turns current only after a verification read.' }}</p>
                    <p v-if="rule(a)" class="m-0 text-(--ab-red-text)">{{ rule(a) }}</p>
                    <p class="m-0 text-xs text-text3">Sensitivity {{ a.sensitivity || 'unknown' }} · environment {{ a.environment || 'unknown' }} · resource domain {{ a.resource_domain || 'unknown' }}</p>
                    <div class="flex gap-3">
                      <button v-if="a.grade !== 'verified'" type="button" class="rg-link min-h-10 max-sm:min-h-11" @click.stop="composer = { agentId: row.agent_id, accessId: a.access_id, mode: 'access_verify' }">Verify</button>
                      <button type="button" class="rg-link min-h-10 max-sm:min-h-11" @click.stop="composer = { agentId: row.agent_id, accessId: a.access_id, mode: 'access_correct' }">Correct</button>
                    </div>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </section>

    <section class="flex flex-col gap-2.5 rounded border border-line p-3.5">
      <div class="flex items-center gap-2">
        <RegistryRegAvatar :id="registrar.id" :size="28" />
        <h3 class="m-0 text-sm font-semibold">Ask {{ registrar.name }}</h3>
        <span class="text-xs text-text3">Optional · read-only · the answer is a model answer, not a registry fact</span>
      </div>
      <label class="flex flex-col gap-1.5 text-xs font-semibold text-text2">
        Question for {{ registrar.name }}
        <textarea v-model="question" rows="2" :placeholder="`Can ${row.name} write to … today?`" class="w-full resize-y rounded border border-input px-2.5 py-2 text-sm font-normal text-ink" />
      </label>
      <div class="flex">
        <button type="button" class="rg-btn rg-btn-line ml-auto" :class="phone && 'h-11'" :disabled="!question.trim()" @click="ask">Ask · files a governance request, 1 run</button>
      </div>
      <div v-if="answer" class="flex flex-col gap-1 rounded bg-filterbar p-3 text-[13px]">
        <div class="flex items-center gap-2 text-xs">
          <span class="font-semibold">{{ registrar.name }}</span>
          <span class="rounded bg-(--ab-blue-bg) px-1.5 py-px font-semibold text-approve">Model answer</span>
          <span class="font-mono text-text3">GOV-[id]</span>
          <span class="rounded border border-dashed border-dash px-1.5 py-px text-xs text-text3">Prototype sample · no request filed</span>
        </div>
        <p class="m-0 leading-normal">{{ answer }}</p>
      </div>
    </section>
  </div>
</template>
