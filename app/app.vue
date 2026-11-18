<script setup lang="ts">
// The tab title until a page sets its own.
useHead({ title: useAppName() })
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
