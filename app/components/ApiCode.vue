<script setup lang="ts">
// A code sample for the /api page: wraps long lines instead of hiding them, and copies in one click.
const props = defineProps<{ text: string, label?: string }>()

const copied = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined
async function copy() {
  try {
    await navigator.clipboard.writeText(props.text)
    copied.value = true
    clearTimeout(timer)
    timer = setTimeout(() => { copied.value = false }, 1600)
  } catch { /* clipboard blocked: the text stays selectable */ }
}
onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <div class="group/code relative">
    <pre class="m-0 rounded bg-ground py-2.5 pr-20 pl-3 font-mono text-[13px] leading-relaxed break-words whitespace-pre-wrap text-ink">{{ text }}</pre>
    <button
      type="button"
      class="absolute top-1.5 right-1.5 flex h-8 cursor-pointer items-center gap-1 rounded border border-line bg-surface px-2 text-[12px] font-medium text-text2 hover:text-ink"
      :aria-label="`Copy ${label ?? 'example'}`"
      @click="copy"
    >
      <UIcon :name="copied ? 'i-lucide-check' : 'i-lucide-copy'" class="size-3.5" />
      <span aria-live="polite">{{ copied ? 'Copied' : 'Copy' }}</span>
    </button>
  </div>
</template>
