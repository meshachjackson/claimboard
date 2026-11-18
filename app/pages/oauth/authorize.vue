<script setup lang="ts">
// Shown before or outside the board: no rail, no tabs.
definePageMeta({ layout: false })
// Consent for the orchestrator connector. A Claude account lands here from
// "Add custom connector". The owner picks the identity it signs in as, files the token's hash through
// form.gov-board-token, and presses Continue. The server (server/api/oauth/consent.post.ts) checks every step.
// A door is "the owner, through this account": the orchestrator answers him, and the board records him.
import { boardOwnerName } from '~/types/board'
type Identity = { agent_id: string, name: string, classes: string[], kind: 'door' | 'agent' }
type Chosen = Identity & { token_sha256: string, form_url: string, fixtures: boolean }
type Answer = { ok: boolean, reason?: string, redirect?: string, redirect_host?: string, identities?: Identity[] } & Partial<Chosen>

const route = useRoute()
const ownerName = boardOwnerName()
// The board's own address, so the connector help names whatever host this deployment runs on.
const origin = useRequestURL().origin
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const redirectHost = ref('')
const identities = ref<Identity[]>([])
const chosen = ref<Chosen | null>(null)
const copied = ref(false)
const doors = computed(() => identities.value.filter(i => i.kind === 'door'))
const agents = computed(() => identities.value.filter(i => i.kind !== 'door'))

async function send(step: string, extra: Record<string, unknown> = {}): Promise<Answer | null> {
  busy.value = true
  error.value = ''
  try {
    const answer = await $fetch<Answer>('/api/oauth/consent', { method: 'POST', body: { step, query: route.query, ...extra } })
    if (!answer.ok) error.value = answer.reason ?? 'Refused'
    return answer.ok ? answer : null
  } catch (err) {
    error.value = (err as { statusMessage?: string }).statusMessage ?? 'The board server didn\'t answer.'
    return null
  } finally {
    busy.value = false
  }
}

/** Sends the browser back to Claude with a code (or access_denied). */
function leave(answer: Answer | null) {
  if (answer?.redirect) window.location.assign(answer.redirect)
}

onMounted(async () => {
  const answer = await send('start')
  if (answer) {
    identities.value = answer.identities ?? []
    redirectHost.value = answer.redirect_host ?? ''
  }
  loading.value = false
})

async function choose(id: Identity) {
  const answer = await send('choose', { agent_id: id.agent_id })
  if (answer) chosen.value = answer as Chosen
}

async function copyHash() {
  if (!chosen.value) return
  await navigator.clipboard.writeText(chosen.value.token_sha256)
  copied.value = true
  setTimeout(() => { copied.value = false }, 1500)
}
</script>

<template>
  <main class="flex min-h-dvh flex-col items-center justify-center gap-5 bg-ground px-4 py-8">
    <BoardLogo />
    <section class="flex w-full max-w-[480px] flex-col gap-4 rounded-[10px] border border-line bg-surface p-4 sm:p-5">
      <h1 class="m-0 text-lg font-bold">Connect a Claude account to the orchestrator</h1>

      <p v-if="loading" class="m-0 text-sm text-text3">Checking the request…</p>

      <template v-else-if="!chosen && identities.length">
        <p class="m-0 text-sm text-text2">
          <strong>{{ redirectHost }}</strong> asks to sign in to the board. Choose the identity it acts as.
          Its cards are limited to that identity's classes.
        </p>
        <template v-if="doors.length">
          <h2 class="m-0 text-sm font-bold">{{ ownerName }}, through this account</h2>
          <p class="m-0 text-xs text-text3">You talk to the orchestrator itself; what it writes on the board is yours, with this account named. It can ask, read and message, nothing else.</p>
          <ul class="m-0 flex list-none flex-col gap-2 p-0">
            <li v-for="id in doors" :key="id.agent_id">
              <button
                type="button"
                class="flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-lg border border-line bg-surface px-3 py-2.5 text-left hover:bg-(--ab-neutral-bg) disabled:cursor-default disabled:opacity-60"
                :disabled="busy"
                @click="choose(id)"
              >
                <span class="text-sm font-semibold">{{ id.name || id.agent_id }}</span>
                <span class="text-xs text-text3">{{ id.agent_id }} · class {{ id.classes.join(', ') }}</span>
              </button>
            </li>
          </ul>
        </template>
        <template v-if="agents.length">
          <h2 v-if="doors.length" class="m-0 text-sm font-bold">An agent identity</h2>
          <ul class="m-0 flex list-none flex-col gap-2 p-0">
            <li v-for="id in agents" :key="id.agent_id">
              <button
                type="button"
                class="flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-lg border border-line bg-surface px-3 py-2.5 text-left hover:bg-(--ab-neutral-bg) disabled:cursor-default disabled:opacity-60"
                :disabled="busy"
                @click="choose(id)"
              >
                <span class="text-sm font-semibold">{{ id.name || id.agent_id }}</span>
                <span class="text-xs text-text3">{{ id.agent_id }} · class {{ id.classes.join(', ') }}</span>
              </button>
            </li>
          </ul>
        </template>
        <button type="button" class="w-fit cursor-pointer text-[13px] font-semibold text-text2" :disabled="busy" @click="send('deny').then(leave)">
          Cancel
        </button>
      </template>

      <template v-else-if="chosen">
        <p class="m-0 text-sm text-text2">
          The board made a new token for <strong>{{ chosen.agent_id }}</strong> (class {{ chosen.classes.join(', ') }}){{ chosen.kind === 'door' ? `, ${ownerName} through this account` : '' }}.
          The token stays on the server. File its hash, then press Continue.
        </p>
        <ol class="m-0 flex flex-col gap-2 pl-5 text-sm">
          <li>
            Open <a v-if="chosen.form_url" :href="chosen.form_url" target="_blank" rel="noopener" class="font-semibold text-approve">form.gov-board-token</a><template v-else>form.gov-board-token</template>:
            issue, agent <code>{{ chosen.agent_id }}</code>, Write it.
          </li>
          <li class="flex flex-col gap-1">
            <span>Paste this SHA-256:</span>
            <code class="break-all rounded-md bg-(--ab-neutral-bg) px-2 py-1.5 text-xs">{{ chosen.token_sha256 }}</code>
            <button type="button" class="w-fit cursor-pointer text-[13px] font-semibold text-approve" @click="copyHash">
              {{ copied ? 'Copied' : 'Copy hash' }}
            </button>
          </li>
        </ol>
        <p v-if="chosen.fixtures" class="m-0 text-xs text-text3">Fixtures mode: the stand-in gateway already knows this token, so there's nothing to file.</p>
        <div class="flex items-center gap-3">
          <button
            type="button"
            class="inline-flex h-10 cursor-pointer items-center rounded-lg bg-ink px-4 text-sm font-semibold text-surface disabled:cursor-default disabled:opacity-60"
            :disabled="busy"
            @click="send('continue').then(leave)"
          >
            {{ busy ? 'Checking…' : 'Continue' }}
          </button>
          <button type="button" class="cursor-pointer text-[13px] font-semibold text-text2" :disabled="busy" @click="send('deny').then(leave)">
            Cancel
          </button>
        </div>
      </template>

      <template v-else-if="!error">
        <p class="m-0 text-sm text-text2">
          No identity can connect yet. An identity must be active and have a <code>board:class:*</code> access row. In order:
        </p>
        <ol class="m-0 flex flex-col gap-1.5 pl-5 text-sm text-text2">
          <li>Register it with form.gov-register-agent, then approve the review.</li>
          <li>Add its <code>board:class:*</code> access row with form.gov-change-access, then approve that.</li>
          <li>Verify the access row and the deployment with form.gov-verify-access (two passes; only {{ ownerName }} grades).</li>
          <li>
            Activate it. {{ ownerName }} does this by hand today, as a recorded write to the registry.
            An activation form is planned but doesn't exist yet.
          </li>
        </ol>
        <p class="m-0 text-sm text-text2">
          Then try again from Claude. Add the connector at <code>{{ origin }}/mcp</code>.
          GitHub sign-in only works from the address the board's OAuth app is set up for; any other alias fails with a redirect_uri error.
        </p>
      </template>

      <p v-if="error" role="alert" class="m-0 text-[13px] text-(--ab-red-text)">{{ error }}</p>
    </section>
  </main>
</template>
