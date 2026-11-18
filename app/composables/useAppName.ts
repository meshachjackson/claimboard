// The name shown in the header and the browser tab: NUXT_PUBLIC_APP_NAME, else "claimboard".
export function useAppName(): string {
  return String(useRuntimeConfig().public.appName || 'claimboard')
}
