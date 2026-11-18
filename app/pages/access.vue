<script setup lang="ts">
// Access: admins edit groups, members, and the board, project and card rules. One draft, saved with one button;
// the server checks it (checkPolicy) before it reaches the file. Levels: none hides it, view, edit, manage.
// Direction B layout (11/1/2026): the page header holds Save, so it stays in reach; Groups and Rules are Settings-style sections.
import { ADMINS, EVERYONE, LEVELS, SCOPES } from '~~/shared/access'
import type { Level, Policy, Rule, Scope } from '~~/shared/access'

const access = useAccess()
const toast = useToast()
const draft = ref<Policy | null>(null)
const error = ref('')
const saved = ref('')

onMounted(async () => {
  await access.load()
  draft.value = JSON.parse(JSON.stringify(access.state.value.policy ?? null))
  saved.value = JSON.stringify(draft.value)
})
const dirty = computed(() => !!draft.value && JSON.stringify(draft.value) !== saved.value)

const locked = (id: string) => id === ADMINS || id === EVERYONE
const members = (id: string) => draft.value!.groups.find(g => g.id === id)!.members.join(', ')
function setMembers(id: string, text: string) {
  draft.value!.groups.find(g => g.id === id)!.members = text.split(',').map(m => m.trim()).filter(Boolean)
}
const groupName = (id: string) => draft.value?.groups.find(g => g.id === id)?.name ?? id

const newGroup = ref('')
function addGroup() {
  const id = newGroup.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  if (!id || draft.value!.groups.some(g => g.id === id)) return
  draft.value!.groups.push({ id, name: newGroup.value.trim(), members: [] })
  newGroup.value = ''
}
function removeGroup(id: string) {
  draft.value!.groups = draft.value!.groups.filter(g => g.id !== id)
  draft.value!.rules = draft.value!.rules.filter(r => r.group !== id) // a rule must name a group that exists
}

const blank = (): Rule => ({ scope: 'board', target: 'main', group: EVERYONE, level: 'view' })
const rule = ref<Rule>(blank())
const targetHelp: Record<Scope, string> = { board: 'Board id, such as main', project: 'Project id', card: 'Card id, such as TSK-NNNNNN' }
function addRule() {
  if (!rule.value.target.trim()) return
  draft.value!.rules.push({ ...rule.value, target: rule.value.target.trim() })
  rule.value = blank()
}

async function save() {
  error.value = await access.save(draft.value!)
  if (error.value) return
  saved.value = JSON.stringify(draft.value)
  toast.add({ title: 'Access saved', color: 'success' })
}

const levels = LEVELS.map(id => ({ id, label: id.charAt(0).toUpperCase() + id.slice(1) }))
const field = 'h-10 rounded border border-input bg-surface px-2.5 text-sm text-ink'
const outline = 'inline-flex h-10 cursor-pointer items-center rounded border-2 border-ink px-3.5 text-sm font-semibold text-ink whitespace-nowrap hover:bg-(--ab-row-hover) disabled:cursor-not-allowed disabled:opacity-50'
const primary = 'inline-flex h-10 cursor-pointer items-center rounded bg-ink px-4 text-sm font-semibold text-surface whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50'
</script>

<template>
  <div class="flex min-h-dvh flex-col">
    <header class="sticky top-0 z-20 flex min-h-14 items-center gap-4 border-b-2 border-rule bg-ground px-5">
      <PageTitle />
      <p class="m-0 truncate text-sm text-text3 max-[699px]:hidden">Who can see and change each board, project and card.</p>
      <span class="flex-1" />
      <template v-if="draft">
        <span v-if="dirty" class="text-sm font-semibold text-text2 max-[499px]:hidden">Unsaved changes</span>
        <button type="button" :class="primary" :disabled="!dirty" @click="save">Save access</button>
      </template>
    </header>

    <div class="@container mx-auto flex w-full max-w-[880px] flex-col gap-10 px-6 pt-7 pb-24 max-[699px]:px-4">
      <p v-if="error" role="alert" class="m-0 border-l-[5px] border-(--ab-red) bg-surface px-4 py-3 text-sm font-semibold text-(--ab-red-text)">{{ error }}</p>

      <p v-if="!access.state.value.loaded" class="m-0 text-sm text-text2">Loading</p>
      <SettingsSection v-else-if="!access.state.value.policy && !draft" id="setup" title="No groups yet">
        <SettingsRow
          :label="access.state.value.admin ? 'Everyone sees everything' : 'Only admins can change access'"
          :help="access.state.value.admin ? 'Until you set up your team, every person and agent can see and change every card.' : 'Ask an admin if you need to see a board you can not open.'"
        >
          <NuxtLink v-if="access.state.value.admin" to="/onboarding" :class="primary">Start onboarding</NuxtLink>
        </SettingsRow>
      </SettingsSection>

      <template v-else-if="draft">
        <SettingsSection id="groups" title="Groups" note="People and agents belong to groups; rules give a group a level. Admins and Everyone can't be deleted.">
          <div v-for="g in draft.groups" :key="g.id" class="flex flex-col gap-2 py-4">
            <div class="flex items-center gap-2">
              <h3 :id="`grp-${g.id}`" class="m-0 text-[15px] font-semibold">{{ g.name }}</h3>
              <span class="font-mono text-xs text-text3">{{ g.id }}</span>
              <span v-if="g.id === ADMINS" class="text-sm text-text3">· always has manage</span>
              <button
                v-if="!locked(g.id)"
                type="button"
                class="ml-auto inline-flex h-10 cursor-pointer items-center gap-1.5 rounded px-2.5 text-sm font-semibold text-text2 hover:bg-(--ab-row-hover) hover:text-(--ab-red-text)"
                :aria-label="`Delete ${g.name}`"
                @click="removeGroup(g.id)"
              >
                <UIcon name="i-lucide-trash-2" class="size-4" />Delete
              </button>
            </div>
            <input
              :value="members(g.id)"
              :disabled="g.id === EVERYONE"
              :placeholder="g.id === EVERYONE ? 'Everyone is in this group' : 'person:octocat, agt-builder'"
              :aria-labelledby="`grp-${g.id}`"
              :class="[field, 'w-full disabled:bg-ground disabled:text-text3']"
              @change="setMembers(g.id, ($event.target as HTMLInputElement).value)"
            >
          </div>
          <form class="flex flex-wrap gap-2 py-4" @submit.prevent="addGroup">
            <input v-model="newGroup" placeholder="New group, such as Contractors" aria-label="New group name" :class="[field, 'min-w-48 flex-1']">
            <button type="submit" :class="outline" :disabled="!newGroup.trim()">Add group</button>
          </form>
        </SettingsSection>

        <SettingsSection
          id="rules"
          title="Rules"
          note="The most specific rule wins: card, then project, then board. A none for any group you are in beats a grant at the same level. Admins always have manage."
        >
          <SettingsRow label="With no rule" help="What a board, project or card with no matching rule gives to everyone." label-id="acc-default">
            <SegChoice :options="levels" :model-value="draft.default" labelledby="acc-default" @update:model-value="draft.default = $event as Level" />
          </SettingsRow>
          <ul class="m-0 flex list-none flex-col divide-y divide-line p-0">
            <li v-for="(r, i) in draft.rules" :key="i" class="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
              <span class="w-16 text-sm text-text3 capitalize">{{ r.scope }}</span>
              <span class="min-w-0 flex-1 text-[15px]">
                <span class="font-mono text-sm font-medium">{{ r.target }}</span>:
                {{ groupName(r.group) }} gets <strong class="font-semibold capitalize">{{ r.level }}</strong>
              </span>
              <button type="button" class="inline-flex h-10 cursor-pointer items-center rounded px-2.5 text-sm font-semibold text-text2 hover:bg-(--ab-row-hover) hover:text-ink" :aria-label="`Remove rule ${i + 1}`" @click="draft.rules.splice(i, 1)">Remove</button>
            </li>
            <li v-if="!draft.rules.length" class="py-4 text-sm text-text3">No rules yet. Every board, project and card gives {{ draft.default }}.</li>
          </ul>
          <form class="flex flex-col gap-3 py-4" aria-labelledby="acc-new-rule" @submit.prevent="addRule">
            <h3 id="acc-new-rule" class="m-0 text-[15px] font-semibold">New rule</h3>
            <div class="grid grid-cols-[repeat(4,minmax(0,1fr))_auto] items-end gap-2 @max-[720px]:grid-cols-2">
              <label class="flex flex-col gap-1.5 text-xs font-semibold text-text2">On
                <select v-model="rule.scope" :class="field"><option v-for="s in SCOPES" :key="s" :value="s">{{ s }}</option></select>
              </label>
              <label class="flex flex-col gap-1.5 text-xs font-semibold text-text2">Which one
                <input v-model="rule.target" :placeholder="targetHelp[rule.scope]" :class="field">
              </label>
              <label class="flex flex-col gap-1.5 text-xs font-semibold text-text2">Group
                <select v-model="rule.group" :class="field"><option v-for="g in draft.groups" :key="g.id" :value="g.id">{{ g.name }}</option></select>
              </label>
              <label class="flex flex-col gap-1.5 text-xs font-semibold text-text2">Gets
                <select v-model="rule.level" :class="field"><option v-for="l in LEVELS" :key="l" :value="(l as Level)">{{ l }}</option></select>
              </label>
              <button type="submit" :class="[outline, '@max-[720px]:col-span-2 @max-[720px]:justify-self-start']" :disabled="!rule.target.trim()">Add rule</button>
            </div>
            <p class="m-0 text-sm text-text3">To keep a board to executives, give none to the groups that must not see it (such as Developers), not to Everyone.</p>
          </form>
        </SettingsSection>

        <div class="flex flex-wrap items-center gap-3">
          <button type="button" :class="primary" :disabled="!dirty" @click="save">Save access</button>
          <span class="text-sm text-text3">{{ dirty ? 'Nothing changes until you save. The server checks the rules first.' : 'Everything is saved.' }}</span>
        </div>
      </template>
    </div>
  </div>
</template>
