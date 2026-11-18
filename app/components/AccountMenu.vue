<script setup lang="ts">
// The signed-in GitHub user's avatar, with Settings and Sign out.
import { boardOwner } from '~/types/board'

const { user, clear } = useUserSession()
const access = useAccess()
onMounted(() => access.load())

async function signOut() {
  await clear()
  await navigateTo('/login')
}

const items = computed(() => [
  [{ label: user.value?.login ?? 'Signed in', type: 'label' as const }],
  [
    { label: 'Settings', icon: 'i-lucide-settings', to: '/settings' },
    // Before onboarding the policy is null and the owner is sent to set up groups; after it, admins edit rules.
    ...(access.state.value.admin
      ? [{ label: access.state.value.policy ? 'Access and groups' : 'Set up your team', icon: 'i-lucide-users', to: access.state.value.policy ? '/access' : '/onboarding' }]
      : [])
  ],
  [{ label: 'Sign out', icon: 'i-lucide-log-out', onSelect: signOut }]
])
</script>

<template>
  <UDropdownMenu :items="items" :content="{ align: 'end' }">
    <button type="button" aria-label="Account menu" class="inline-flex size-10 max-md:size-11 cursor-pointer items-center justify-center rounded-full hover:bg-chip">
      <img v-if="user?.avatarUrl" :src="user.avatarUrl" alt="" class="size-8 rounded-full">
      <AgentAvatar v-else :id="boardOwner()" :size="32" />
    </button>
  </UDropdownMenu>
</template>
