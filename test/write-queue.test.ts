// Optimistic writes (app/utils/writeQueue.ts): a click shows at once, goes to the server in turn, and rolls back on a failure.
// The fake server below runs the real rules (applyOp) on its own copy of the rows, so a wrong updated_at is refused "stale"
// exactly as the gateway would. Each send waits until the test lets it through. Run with `pnpm test`.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'

register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('~/')) spec = new URL('./app/' + spec.slice(2) + '.ts', ${JSON.stringify(new URL('../', import.meta.url).href)}).href
  return next(spec, ctx)
}`))
;(await import('../app/types/board.ts')).setBoardOwner('person:meshach', 'Meshach')

const ME = { person: 'person:meshach' }
const mock = (file: string) => JSON.parse(readFileSync(new URL(`../mock/${file}`, import.meta.url), 'utf8'))
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x))

let applyOp: typeof import('../app/utils/boardOps.ts').applyOp
let createWriteQueue: typeof import('../app/utils/writeQueue.ts').createWriteQueue
before(async () => {
  ({ applyOp } = await import('../app/utils/boardOps.ts'))
  ;({ createWriteQueue } = await import('../app/utils/writeQueue.ts'))
})

const rows = () => ({ tasks: mock('gov_tasks.synthetic.json'), steps: mock('gov_task_steps.synthetic.json'), notes: mock('gov_task_notes.json') })
const context = () => ({ columns: mock('board_columns.json'), registry: mock('gov_registry.json') })

// A server that answers only when told to. `fail` makes the next answer a refusal instead.
function setup() {
  const server = { ...clone(rows()), ...context() }
  const sent: { op: string, args: Record<string, unknown>, answer: () => void }[] = []
  const failures: { op: string, reason: string, dropped: number }[] = []
  let failNext = ''
  const queue = createWriteQueue({
    send: (op, args, caller) => new Promise((resolve) => {
      const answer = () => resolve(failNext ? { ok: false as const, op, reason: failNext } : applyOp(server, op, args, caller))
      sent.push({ op, args, answer })
    }),
    context,
    onChange: () => {},
    onFailure: (failed, result, dropped) => { failures.push({ op: failed.op, reason: result.reason, dropped: dropped.length }) }
  })
  queue.setConfirmed(clone(rows()))
  return { queue, server, sent, failures, failWith: (reason: string) => { failNext = reason } }
}

const task = (q: ReturnType<typeof setup>['queue'], id: string) => q.rows().tasks.find(t => t.task_id === id)!
const settle = () => new Promise(r => setTimeout(r, 0))

test('a click changes the rows at once, before the server answers', async () => {
  const { queue, sent } = setup()
  assert.equal(task(queue, 'TSK-900006').approval_state, 'pending')
  const done = queue.enqueue('approve_task', { task_id: 'TSK-900006', updated_at: task(queue, 'TSK-900006').updated_at }, ME)
  assert.equal(task(queue, 'TSK-900006').approval_state, 'approved')
  assert.deepEqual([...queue.busyLanes()], ['TSK-900006'])
  assert.equal(sent.length, 1)
  sent[0]!.answer()
  const result = await done
  assert.equal(result.ok, true)
  assert.equal(queue.pending().length, 0)
  assert.equal(task(queue, 'TSK-900006').approval_state, 'approved') // now the server's row
})

test('two clicks on one card go out in order, each with the server\'s own updated_at', async () => {
  const { queue, sent } = setup()
  const first = queue.enqueue('approve_task', { task_id: 'TSK-900006', updated_at: task(queue, 'TSK-900006').updated_at }, ME)
  // The second click is made on the guessed row, whose updated_at the server has never seen.
  const second = queue.enqueue('update_task', { task_id: 'TSK-900006', title: 'Renamed', updated_at: task(queue, 'TSK-900006').updated_at }, ME)
  assert.equal(task(queue, 'TSK-900006').title, 'Renamed')
  assert.equal(sent.length, 1, 'the second waits for the first')
  sent[0]!.answer()
  assert.equal((await first).ok, true)
  await settle()
  assert.equal(sent.length, 2)
  sent[1]!.answer()
  const result = await second
  assert.equal(result.ok, true, result.ok ? '' : result.reason) // not "stale"
  assert.equal(task(queue, 'TSK-900006').title, 'Renamed')
})

test('clicks on different cards go out together', () => {
  const { queue, sent } = setup()
  void queue.enqueue('approve_task', { task_id: 'TSK-900006', updated_at: task(queue, 'TSK-900006').updated_at }, ME)
  void queue.enqueue('approve_task', { task_id: 'TSK-900010', updated_at: task(queue, 'TSK-900010').updated_at }, ME)
  assert.equal(sent.length, 2)
})

test('a failure puts the card back and takes the later clicks on it along', async () => {
  const { queue, sent, failures, failWith } = setup()
  const before = clone(task(queue, 'TSK-900006'))
  const first = queue.enqueue('approve_task', { task_id: 'TSK-900006', updated_at: before.updated_at }, ME)
  const second = queue.enqueue('update_task', { task_id: 'TSK-900006', title: 'Renamed', updated_at: before.updated_at }, ME)
  const other = queue.enqueue('approve_task', { task_id: 'TSK-900010', updated_at: task(queue, 'TSK-900010').updated_at }, ME)
  failWith('HTTP 502')
  sent[0]!.answer()
  const [r1, r2] = await Promise.all([first, second])
  assert.deepEqual([r1.ok, r2.ok], [false, false])
  assert.deepEqual(task(queue, 'TSK-900006'), before)
  assert.deepEqual(failures, [{ op: 'approve_task', reason: 'HTTP 502', dropped: 1 }])
  // The other card was not touched.
  assert.equal(task(queue, 'TSK-900010').approval_state, 'approved')
  assert.deepEqual([...queue.busyLanes()], ['TSK-900010'])
  failWith('')
  sent[1]!.answer()
  assert.equal((await other).ok, true)
})

test('a read that arrives while a click is unanswered keeps the click on screen', () => {
  const { queue } = setup()
  void queue.enqueue('approve_task', { task_id: 'TSK-900006', updated_at: task(queue, 'TSK-900006').updated_at }, ME)
  queue.setConfirmed(clone(rows())) // the server has not seen the click yet
  assert.equal(task(queue, 'TSK-900006').approval_state, 'approved')
})

test('a message appears at once, marked as made up, and the server\'s note replaces it', async () => {
  const { queue, sent } = setup()
  const before = queue.rows().notes.length
  const done = queue.enqueue('add_note', { task_id: 'TSK-900006', kind: 'comment', body: 'hello there' }, ME)
  assert.equal(queue.rows().notes.length, before + 1)
  const guess = queue.rows().notes.find(n => n.body === 'hello there')!
  assert.ok(queue.guessedNotes().has(guess.note_id))
  sent[0]!.answer()
  await done
  assert.equal(queue.rows().notes.length, before + 1)
  assert.equal(queue.guessedNotes().size, 0)
})

test('a click the browser rules refuse still goes to the server, which decides', async () => {
  const { queue, sent } = setup()
  // needs no approval, so the rules refuse approve_task. Nothing changes on screen, but it is sent.
  const done = queue.enqueue('approve_task', { task_id: 'TSK-900001', updated_at: task(queue, 'TSK-900001').updated_at }, ME)
  assert.equal(sent.length, 1)
  sent[0]!.answer()
  assert.equal((await done).ok, false)
})

test('a new card is not guessed: its id comes from the server', () => {
  const { queue, sent } = setup()
  const before = queue.rows().tasks.length
  void queue.enqueue('create_task', { title: 'New thing' }, ME)
  assert.equal(queue.rows().tasks.length, before)
  assert.equal(sent.length, 1)
})
