// Links built from instance config. Each returns '' when its setting is empty, and the page then leaves the link out.

/** A GitHub link on this board's repo (NUXT_PUBLIC_REPO_SLUG, owner/name). '' when no slug is set. */
export function repoLink(slug: unknown, path: string): string {
  const s = String(slug ?? '').trim()
  return s ? `https://github.com/${s}/${path}` : ''
}

/** A configured URL (NUXT_BOARD_TOKEN_FORM_URL), trimmed. '' when unset. */
export function configuredUrl(value: unknown): string {
  return String(value ?? '').trim()
}
