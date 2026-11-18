<script setup lang="ts">
// Header chips: the latest production build, linked to the deployment, and the open PR count,
// linked to the repo. Polls /api/status once a minute while the tab is visible. Shows nothing until the
// server has a value, so a board without the env set looks as it did before.
import type { BoardStatus, BuildState } from '~~/shared/status'
import { formatTime } from '~/utils/format'

const status = ref<BoardStatus | null>(null)

async function load() {
  try {
    status.value = await $fetch<BoardStatus>('/api/status')
  } catch {
    // Keep the last value; the next poll tries again.
  }
}

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  load()
  timer = setInterval(() => { if (document.visibilityState === 'visible') load() }, 60_000)
})
onUnmounted(() => clearInterval(timer))

const LABELS: Record<BuildState, string> = { building: 'Building', ready: 'Build ready', error: 'Build failed', canceled: 'Build canceled' }
const DOTS: Record<BuildState, string> = {
  building: 'bg-amber-500 animate-pulse motion-reduce:animate-none',
  ready: 'bg-(--ab-green-dot)',
  error: 'bg-red-500',
  canceled: 'bg-text3'
}

const deploy = computed(() => status.value?.deploy ?? null)
const deployTitle = computed(() => {
  const d = deploy.value
  if (!d) return ''
  return [LABELS[d.state], formatTime(d.createdAt), d.branch, d.sha].filter(Boolean).join(' · ')
})
</script>

<template>
  <span v-if="deploy || status?.prs" class="inline-flex h-8 items-center gap-2 text-xs text-text2">
    <a
      v-if="deploy"
      :href="deploy.url"
      target="_blank"
      rel="noopener"
      :title="deployTitle"
      :aria-label="deployTitle"
      class="inline-flex items-center gap-1.5 hover:text-ink"
    >
      <span aria-hidden="true" class="size-[7px] rounded-full" :class="DOTS[deploy.state]" />
      <span class="ab-narrow-hide">{{ LABELS[deploy.state] }}</span>
    </a>
    <a
      v-if="status?.prs"
      :href="status.prs.url"
      target="_blank"
      rel="noopener"
      :title="`${status.prs.open} open pull requests`"
      class="hover:text-ink"
    >{{ status.prs.open }} {{ status.prs.open === 1 ? 'PR' : 'PRs' }}</a>
  </span>
</template>
