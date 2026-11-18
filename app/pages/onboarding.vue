<script setup lang="ts">
// Shown before or outside the board: no rail, no tabs.
definePageMeta({ layout: false })
// Onboarding for a new team: welcome, name the groups and who is in them, then review. Runs once; after it,
// the Access page (/access) edits the groups and the board, project and card rules. Members are person:<github login> or an agent id.
const access = useAccess()
const toast = useToast()
onMounted(() => access.load())

const step = ref(1)
const SUGGESTED = ['Executives', 'Developers']
const rows = ref<{ name: string, members: string }[]>(SUGGESTED.map(name => ({ name, members: '' })))
const error = ref('')
const saving = ref(false)

const groups = computed(() => rows.value
  .filter(r => r.name.trim())
  .map(r => ({ name: r.name.trim(), members: r.members.split(',').map(m => m.trim()).filter(Boolean) })))

async function finish() {
  saving.value = true
  error.value = await access.onboard(groups.value)
  saving.value = false
  if (error.value) return
  toast.add({ title: 'Your groups are set up', color: 'success' })
  await navigateTo('/access')
}

const inputCls = 'h-11 rounded-lg border border-input bg-surface px-2.5 text-sm text-ink'
const btnCls = 'h-11 cursor-pointer rounded-lg border border-input bg-surface px-4 text-sm font-semibold'
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-xl flex-col gap-5 bg-ground px-4 py-10">
    <BoardLogo />
    <p class="m-0 text-xs font-semibold text-text2">Step {{ step }} of 3</p>

    <section v-if="access.state.value.loaded && access.state.value.policy" class="flex flex-col gap-3">
      <h1 class="m-0 text-xl font-semibold">Already set up</h1>
      <p class="m-0 text-sm text-text2">Onboarding ran before. Change groups and rules on the Access page.</p>
      <NuxtLink to="/access" class="text-sm font-semibold text-approve">Open Access</NuxtLink>
    </section>

    <section v-else-if="step === 1" class="flex flex-col gap-3">
      <h1 class="m-0 text-xl font-semibold">Set up your team</h1>
      <p class="m-0 text-sm text-text2">
        You become the admin. Next you name your groups, for example executives and developers. Later you decide which
        group sees and edits each board, project and card. Until you add a rule, everyone sees everything.
      </p>
      <button type="button" :class="btnCls" @click="step = 2">Start</button>
    </section>

    <section v-else-if="step === 2" class="flex flex-col gap-3">
      <h1 class="m-0 text-xl font-semibold">Groups</h1>
      <p class="m-0 text-sm text-text2">
        List who is in each group by GitHub login (<code>person:octocat</code>) or agent id (<code>agt-builder</code>), separated by commas.
        Everyone is added automatically.
      </p>
      <div v-for="(r, i) in rows" :key="i" class="flex flex-col gap-2 rounded-lg border border-input p-3">
        <input v-model="r.name" placeholder="Group name" aria-label="Group name" :class="inputCls">
        <input v-model="r.members" placeholder="person:octocat, agt-builder" aria-label="Members" :class="inputCls">
        <button type="button" class="self-start text-xs font-semibold text-text2" @click="rows.splice(i, 1)">Remove group</button>
      </div>
      <button type="button" :class="btnCls" @click="rows.push({ name: '', members: '' })">Add a group</button>
      <div class="flex gap-2">
        <button type="button" :class="btnCls" @click="step = 1">Back</button>
        <button type="button" :class="btnCls" :disabled="!groups.length" @click="step = 3">Review</button>
      </div>
    </section>

    <section v-else class="flex flex-col gap-3">
      <h1 class="m-0 text-xl font-semibold">Review</h1>
      <ul class="m-0 flex list-none flex-col gap-1 p-0 text-sm">
        <li>Admins and Everyone (always created)</li>
        <li v-for="g in groups" :key="g.name">{{ g.name }}: {{ g.members.length ? g.members.join(', ') : 'no members yet' }}</li>
      </ul>
      <p v-if="error" role="alert" class="m-0 text-sm font-semibold text-(--ab-red-text)">{{ error }}</p>
      <div class="flex gap-2">
        <button type="button" :class="btnCls" @click="step = 2">Back</button>
        <button type="button" :class="btnCls" :disabled="saving" @click="finish">Create groups</button>
      </div>
    </section>
  </main>
</template>
