// Writes the status colors in app/types/board.ts (PALETTE) as CSS variables: light on :root, dark under .dark,
// the class Nuxt UI's color mode sets on <html>. Components use them as var(--ab-<name>).
import { PALETTE } from '~/types/board'

export default defineNuxtPlugin(() => {
  const vars = (i: 0 | 1) => Object.entries(PALETTE).map(([name, pair]) => `--ab-${name}:${pair[i]}`).join(';')
  useHead({ style: [{ key: 'ab-palette', innerHTML: `:root{${vars(0)}}.dark{${vars(1)}}` }] })
})
