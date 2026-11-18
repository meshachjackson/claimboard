// POST /api/board/nudge-dispatcher: the owner's "Nudge dispatcher" button. Wakes board-run at once instead of on its next poll.
// Locally the push stream also fires, so a runner on the same machine wakes without waiting for the 5 second stamp poll.
import { announceBoardChange } from '../../utils/boardEvents.ts'
import { nudgeDispatcher } from '../../utils/dispatcher.ts'

export default defineEventHandler(async (event) => {
  await requireAllowedUser(event)
  const stamp = await nudgeDispatcher()
  announceBoardChange()
  return { ok: true, stamp }
})
