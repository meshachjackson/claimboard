<script setup lang="ts">
// Shown before or outside the board: no rail, no tabs.
definePageMeta({ layout: false })
// Shown to any GitHub account other than an allowed login. No session was created.
</script>

<template>
  <main class="flex min-h-dvh flex-col items-center justify-center gap-4 bg-ground px-4 text-center">
    <BoardLogo />
    <h1 class="m-0 text-xl font-semibold">Not allowed</h1>
    <p class="m-0 max-w-[340px] text-sm text-text2">This board is private. The GitHub account you used doesn't have access.</p>
    <a href="/login" class="text-sm font-semibold text-approve">Back to sign in</a>
  </main>
</template>
