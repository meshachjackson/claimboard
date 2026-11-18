// Checks for an agent request on the reference install. Pure functions, no Nitro auto-imports, so tests need no server.
import type { AgentRequestInput } from '~~/app/types/registry'

/** A URL query or userinfo that looks like it carries a credential. The token belongs in the agent, not in the URL. */
const URL_SECRET_RE = /(token|key|secret|password|passwd|auth)/i

/** The checked input, or a short reason it was refused. `taken` are the agent ids already in use. */
export function checkRequest(input: unknown, taken: string[]): AgentRequestInput | string {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'the request must be an object'
  const a = input as Record<string, unknown>
  const text = (k: string) => (typeof a[k] === 'string' ? (a[k] as string).trim() : '')

  const agent_id = text('agent_id')
  if (!/^agt-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(agent_id) || agent_id.length > 60) return 'agent_id must look like agt-my-agent (lowercase letters, digits, hyphens)'
  if (taken.includes(agent_id)) return `${agent_id} is already registered or requested`

  const name = text('name')
  if (!name || name.length > 80) return 'name is required, up to 80 characters'

  const webhook_url = text('webhook_url')
  let url: URL
  try { url = new URL(webhook_url) } catch { return 'webhook_url is not a URL' }
  // http is for an agent on the same machine; anything else must be https.
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && local))) return 'webhook_url must be https (http only for localhost)'
  if (url.username || url.password || URL_SECRET_RE.test(url.search)) return 'webhook_url must not carry a credential; keep it in the agent'

  const rawClasses = Array.isArray(a.classes) ? a.classes : text('classes').split(',')
  const classes = [...new Set(rawClasses.map(c => String(c).trim().toLowerCase()).filter(Boolean))]
  if (!classes.length) classes.push('general')
  if (classes.some(c => !/^[a-z0-9_-]{1,40}$/.test(c))) return 'classes are lowercase slugs, such as general'

  return { agent_id, name, webhook_url, classes }
}
