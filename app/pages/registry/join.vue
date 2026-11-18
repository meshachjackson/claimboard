<script setup lang="ts">
// Registry · Add an agent (reference install). A short request: name, webhook URL and basic permissions. It files a pending
// request; the agent has no registry row and no token until the owner approves it here. Approving shows the token once.
// On the n8n deployment this page does not apply: agents are registered through form.gov-register-agent (/registry/new).
import type { AgentRequest } from '~/types/registry'

useHead({ title: 'Add an agent · Registry' })
const registry = useRegistryStore()
const toast = useToast()

const form = reactive({ agent_id: '', name: '', webhook_url: '', classes: 'general' })
const error = ref('')
const requests = ref<AgentRequest[]>([])
const unavailable = ref(false)
const note = ref('')
const shownToken = ref<{ agent_id: string, token: string } | null>(null)

async function load() {
  try {
    requests.value = (await $fetch<{ requests: AgentRequest[] }>('/api/registry/requests')).requests
  } catch {
    unavailable.value = true // this board has no approval path of its own
  }
}
onMounted(load)

/** The message the server sent, without the framework's wrapper. */
const reason = (err: unknown) => (err as { statusMessage?: string, data?: { statusMessage?: string } }).data?.statusMessage ?? (err as { statusMessage?: string }).statusMessage ?? 'Something went wrong'

async function file() {
  error.value = ''
  try {
    await $fetch('/api/registry/requests', { method: 'POST', body: { ...form, classes: form.classes.split(',').map(c => c.trim()).filter(Boolean) } })
    toast.add({ title: `Requested ${form.agent_id}`, description: 'It has no token until you approve it below.' })
    Object.assign(form, { agent_id: '', name: '', webhook_url: '', classes: 'general' })
    await load()
  } catch (err) {
    error.value = reason(err)
  }
}

async function decide(r: AgentRequest, decision: 'approve' | 'reject') {
  error.value = ''
  if (decision === 'reject' && !note.value.trim()) { error.value = 'Say why in the note box to reject.'; return }
  try {
    const res = await $fetch<{ request: AgentRequest, token?: string }>(`/api/registry/requests/${r.request_id}/${decision}`, { method: 'POST', body: { note: note.value } })
    if (res.token) shownToken.value = { agent_id: r.agent_id, token: res.token }
    note.value = ''
    await load()
    await registry.refresh(true)
  } catch (err) {
    error.value = reason(err)
  }
}

async function copy() {
  try {
    await navigator.clipboard.writeText(shownToken.value!.token)
    toast.add({ title: 'Token copied' })
  } catch {
    toast.add({ title: 'Copy failed', description: 'Select the token and copy it by hand.' })
  }
}

const pending = computed(() => requests.value.filter(r => r.status === 'pending'))
const decided = computed(() => requests.value.filter(r => r.status !== 'pending').slice(0, 10))
const inputCls = 'h-10 rounded border border-input bg-surface px-2.5 text-sm font-normal text-ink'
const labelCls = 'flex flex-col gap-1.5 text-sm font-semibold text-text2'
</script>

<template>
  <RegistryShell v-slot="{ phone }">
    <main class="mx-auto flex w-full max-w-[720px] flex-1 flex-col gap-6" :class="phone ? 'px-4 pt-3 pb-24' : 'px-6 pt-6 pb-12'">
      <div class="rg-head">
        <h2 class="rg-h2">Add an agent</h2>
        <p class="m-0 mt-1.5 text-sm text-text3">Name, webhook and basic permissions. The agent gets no token until you approve it.</p>
      </div>

      <p v-if="unavailable" class="m-0 bg-surface px-5 py-4 text-[15px] text-text2">
        This board registers agents through form.gov-register-agent. Use <NuxtLink to="/registry/new" class="text-accent underline">Plan an agent</NuxtLink>.
      </p>

      <template v-else>
        <div v-if="shownToken" class="flex flex-col gap-2 border-l-[5px] border-(--ab-run) bg-surface p-4" role="status">
          <strong class="text-sm">Token for {{ shownToken.agent_id }}</strong>
          <p class="m-0 text-[13px] text-text3">Shown once. Give it to the agent now; only its hash is kept here.</p>
          <code class="break-all rounded-sm bg-ground p-2 font-mono text-xs">{{ shownToken.token }}</code>
          <div class="flex gap-2">
            <button type="button" class="rg-btn rg-btn-ink" @click="copy">Copy</button>
            <button type="button" class="rg-btn rg-btn-line" @click="shownToken = null">Done, I have it</button>
          </div>
        </div>

        <form class="flex flex-col gap-3 bg-surface p-5" aria-label="Request an agent" @submit.prevent="file">
          <label :class="labelCls">Agent id<input v-model="form.agent_id" :class="inputCls" placeholder="agt-my-agent" required></label>
          <label :class="labelCls">Name<input v-model="form.name" :class="inputCls" placeholder="My agent" required></label>
          <label :class="labelCls">Webhook URL<input v-model="form.webhook_url" :class="inputCls" placeholder="https://example.com/agent" required></label>
          <label :class="labelCls">Classes it may take (comma-separated)<input v-model="form.classes" :class="inputCls"></label>
          <p v-if="error" class="m-0 text-sm font-semibold text-(--ab-red-text)" role="alert">{{ error }}</p>
          <button type="submit" class="rg-btn rg-btn-ink w-fit">Request</button>
        </form>

        <section class="flex flex-col gap-3">
          <div class="rg-head flex items-baseline gap-3">
            <h2 class="rg-h3 text-[24px]!">Waiting for you</h2>
            <span class="rounded-sm px-1.5 font-display text-xl leading-none font-bold" :class="pending.length ? 'bg-(--ab-amber) text-(--ab-amber-fg)' : 'text-text3'">{{ pending.length }}</span>
          </div>
          <p v-if="!pending.length" class="m-0 text-[13px] text-text3">Nothing is waiting.</p>
          <template v-else>
            <label :class="labelCls">Note (needed to reject)<input v-model="note" :class="inputCls"></label>
            <div v-for="r in pending" :key="r.request_id" class="flex flex-col gap-2 border-l-[5px] border-(--ab-amber) bg-surface p-3">
              <div class="flex flex-col gap-0.5">
                <strong class="text-sm">{{ r.name }} <span class="font-mono text-xs font-normal text-text3">{{ r.agent_id }}</span></strong>
                <span class="break-all text-xs text-text3">{{ r.webhook_url }} · classes: {{ r.classes.join(', ') }}</span>
              </div>
              <div class="flex gap-2">
                <button type="button" class="rg-btn rg-btn-ink" @click="decide(r, 'approve')">Approve and make a token</button>
                <button type="button" class="rg-btn rg-btn-line" @click="decide(r, 'reject')">Reject</button>
              </div>
            </div>
          </template>
        </section>

        <section v-if="decided.length" class="flex flex-col gap-2">
          <h2 class="rg-h3 rg-head">Decided</h2>
          <p v-for="r in decided" :key="r.request_id" class="m-0 text-[13px] text-text2">{{ r.agent_id }}: {{ r.status }}{{ r.note ? `, ${r.note}` : '' }}</p>
        </section>
      </template>
    </main>
  </RegistryShell>
</template>
