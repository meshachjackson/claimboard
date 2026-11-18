<script setup lang="ts">
// Shown before or outside the board: no rail, no tabs.
definePageMeta({ layout: false })
// Sign in with GitHub. The OAuth route (server/routes/auth/github.get.ts) decides who gets in.
const route = useRoute()
const failed = computed(() => route.query.error === 'github')
const devLogin = import.meta.dev
</script>

<template>
  <main class="flex min-h-dvh flex-col items-center justify-center gap-5 bg-ground px-4">
    <BoardLogo />
    <p v-if="failed" class="m-0 text-[13px] text-(--ab-red-text)">GitHub sign-in didn't finish. Try again.</p>
    <a
      href="/auth/github"
      class="inline-flex h-11 items-center gap-2 rounded-lg bg-ink px-5 text-[15px] font-semibold text-surface no-underline"
    >
      Sign in with GitHub
    </a>
    <a v-if="devLogin" href="/auth/dev" class="text-xs text-text3">Dev sign-in (needs NUXT_DEV_LOGIN=1)</a>
  </main>
</template>
