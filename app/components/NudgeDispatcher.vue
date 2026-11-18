<script setup lang="ts">
// "Nudge dispatcher": wakes board-run now instead of on its next poll. It only sends a stamp; board-run
// decides what to start, so nudging with nothing waiting is harmless.
const sending = ref(false)
const done = ref(false)
const failed = ref(false)

async function nudge() {
  sending.value = true
  failed.value = false
  try {
    await $fetch('/api/board/nudge-dispatcher', { method: 'POST' })
    done.value = true
    setTimeout(() => { done.value = false }, 4000)
  } catch {
    failed.value = true
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <button
    type="button"
    class="ab-ghost inline-flex h-8 max-md:h-11 cursor-pointer items-center self-center rounded-lg border border-line px-2.5 text-[13px] font-medium disabled:cursor-not-allowed disabled:opacity-50"
    :disabled="sending"
    title="Wake the runner now instead of waiting for its next check"
    @click="nudge"
  >
    {{ sending ? 'Nudging…' : failed ? 'Nudge failed, try again' : done ? 'Nudged' : 'Nudge dispatcher' }}
  </button>
</template>
