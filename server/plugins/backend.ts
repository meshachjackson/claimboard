// Checks NUXT_BOARD_BACKEND when the server starts (server/utils/backend.ts), so a typo stops it at once
// instead of failing every board request later.
import { pickBackend } from '../utils/backend.ts'

export default defineNitroPlugin(() => {
  pickBackend(useRuntimeConfig().boardBackend)
})
