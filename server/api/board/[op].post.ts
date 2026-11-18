// POST /api/board/:op: The owner's board writes, behind his GitHub login.
// The server has checked the login, so the gateway gets as_person = the board owner and no token.
import { boardOwner, OWNER_OPS } from '~~/app/types/board'
import { personRefusal } from '~~/shared/access'
import { resolveOp } from '~~/shared/verbs'

export default defineEventHandler(async (event) => {
  const user = await requireAllowedUser(event)
  const name = getRouterParam(event, 'op') ?? ''
  const body = await readBody(event).catch(() => null)
  // A verb (comment, request_changes, approve...) becomes the wire op it runs; a wire op name passes through unchanged.
  const resolved = resolveOp(name, body && typeof body === 'object' && !Array.isArray(body) ? body : {}, 'owner')
  if (!resolved.ok) throw createError({ statusCode: 403, statusMessage: resolved.reason })
  const op = resolved.op
  if (!(OWNER_OPS as readonly string[]).includes(op)) {
    throw createError({ statusCode: 404, statusMessage: 'Unknown op' })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createError({ statusCode: 400, statusMessage: 'The body must be a JSON object of op args' })
  }
  const args = resolved.args
  // Group rules (shared/access.ts): editing a card needs edit on it, whether the op names the card or one of its steps
  // (cancel_step names only a step; the steps come from boardRows, so Postgres steps count). A new card needs edit on the board and project it lands in.
  const policy = readPolicy()
  if (policy) {
    const refusal = personRefusal(policy, personId(user.login), op, args as Record<string, unknown>, await boardRows())
    if (refusal) throw createError({ statusCode: 403, statusMessage: refusal })
  }
  // Path B: with the step store on, card ops that touch steps run in boardOps.ts against Postgres, not in n8n.
  if (stepStoreOn() && stepStoreHandlesCard(op)) return runCardViaStepStore(op, args as Record<string, unknown>)
  return boardStore().write(op, args as Record<string, unknown>, { person: boardOwner() })
})
