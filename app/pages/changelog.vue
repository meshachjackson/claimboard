<script setup lang="ts">
// What changed on the board and how to try it. The entries are plain data in utils/changelog.ts; test/changelog.test.ts
// fails when a merged PR that changes the board has no entry there.
import { CHANGELOG } from '~/utils/changelog'
import { formatDate } from '~/utils/format'
import { repoLink } from '~/utils/links'

// Empty NUXT_PUBLIC_REPO_SLUG hides the PR links.
const repo = useRuntimeConfig().public.repoSlug
const prUrl = (pr: number) => repoLink(repo, `pull/${pr}`)
</script>

<template>
  <div class="flex min-h-dvh flex-col">
    <header class="sticky top-0 z-20 flex min-h-14 items-center gap-4 border-b-2 border-rule bg-ground px-5">
      <PageTitle label="Changelog" />
      <p class="m-0 truncate text-sm text-text3 max-[699px]:hidden">{{ CHANGELOG.length }} changes, newest first. Each one says how to try it.</p>
    </header>

    <main class="mx-auto flex w-full max-w-[860px] flex-col gap-5 px-6 pt-7 pb-24 max-[699px]:px-4">
      <article v-for="e in CHANGELOG" :key="e.pr" :aria-labelledby="`pr-${e.pr}`" class="bg-surface p-5">
        <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-text3">
          <time :datetime="e.date">{{ formatDate(e.date) }}</time>
          <a v-if="prUrl(e.pr)" :href="prUrl(e.pr)" target="_blank" rel="noopener" class="inline-flex min-h-6 items-center text-text3 underline-offset-2 hover:text-ink hover:underline">PR {{ e.pr }}</a>
          <span v-else>PR {{ e.pr }}</span>
          <span class="ml-auto">{{ e.where }}</span>
        </div>
        <h2 :id="`pr-${e.pr}`" class="m-0 mt-1.5 font-display text-[22px] leading-tight font-bold">{{ e.title }}</h2>
        <p class="m-0 mt-1.5 max-w-[68ch] text-[15px] leading-normal text-text2">{{ e.summary }}</p>
        <h3 class="m-0 mt-4 mb-1.5 text-[13px] font-semibold text-text2">Try it</h3>
        <ol class="m-0 flex list-decimal flex-col gap-1.5 pl-5 text-[15px] leading-normal text-ink marker:text-text3">
          <li v-for="(s, i) in e.steps" :key="i" class="max-w-[68ch]">{{ s }}</li>
        </ol>
      </article>
    </main>
  </div>
</template>
