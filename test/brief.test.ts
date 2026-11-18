// The brief that read_brief answers: its shape check. The fixture stand-in is checked through /mcp (see the handoff). Run with `pnpm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanBrief } from '../server/utils/brief.ts'

const loop = { loop_id: 'LOOP-930001', bucket: 'work', loop: 'Ship it', owner: 'Meshach', rank: 1, watch: false, stale: true, opened: '2026-08-18' }
const good = () => ({
  as_of: '2026-10-27T17:00:00.000Z',
  scope: { kind: 'all', buckets: ['work', 'side-hustle'] },
  focus: { now_id: 'NOW-000003', focus: 'Memory is live', session_date: '2026-10-27', stale: false },
  next_up: [{ ...loop }], watch: [{ ...loop, watch: true }],
  counts: { open: 12, stale_open: 10, by_bucket: { work: 7, 'side-hustle': 5 } },
  notes: ['Rows marked stale came from the import.']
})

test('a good brief passes through unchanged', () => {
  assert.deepEqual(cleanBrief(good()), good())
})

test('a class-scoped brief keeps its classes and a null focus', () => {
  const raw = { ...good(), focus: null, scope: { kind: 'class', classes: ['catalyst'], buckets: ['work'] } }
  const brief = cleanBrief(raw)
  assert.equal(brief?.focus, null)
  assert.deepEqual(brief?.scope, { kind: 'class', classes: ['catalyst'], buckets: ['work'] })
})

test('unknown keys are dropped at every level', () => {
  const raw = good() as Record<string, any>
  raw.body = 'vera_now body'
  raw.focus.banner = 'banner'
  raw.next_up[0].secret = 'x'
  raw.scope.extra = 1
  raw.counts.extra = 1
  const brief = cleanBrief(raw) as Record<string, any>
  assert.deepEqual(brief, good())
  assert.equal('body' in brief, false)
})

test('long strings are capped', () => {
  const raw = good()
  raw.focus.focus = 'x'.repeat(5000)
  raw.next_up[0].loop = 'y'.repeat(5000)
  raw.notes = ['n'.repeat(5000)]
  const brief = cleanBrief(raw)
  assert.equal(brief?.focus?.focus.length, 500)
  assert.equal(brief?.next_up[0]?.loop.length, 500)
  assert.equal(brief?.notes[0]?.length, 300)
})

test('lists are bounded', () => {
  const raw = good()
  raw.watch = Array.from({ length: 200 }, () => ({ ...loop }))
  raw.notes = Array.from({ length: 50 }, () => 'n')
  const brief = cleanBrief(raw)
  assert.equal(brief?.watch.length, 50)
  assert.equal(brief?.notes.length, 10)
})

test('a missing or off-shape brief is null', () => {
  assert.equal(cleanBrief(undefined), null)
  assert.equal(cleanBrief('brief'), null)
  assert.equal(cleanBrief([]), null)
  for (const mutate of [
    (b: any) => { delete b.counts },
    (b: any) => { b.scope.kind = 'everything' },
    (b: any) => { b.next_up = 'none' },
    (b: any) => { b.next_up = [{ ...loop, rank: 'high' }] },
    (b: any) => { b.next_up = [null] },
    (b: any) => { b.focus = 'text' },
    (b: any) => { b.counts.open = -1 },
    (b: any) => { b.counts.by_bucket = { work: 'many' } },
    (b: any) => { b.notes = [1] }
  ]) {
    const raw = good()
    mutate(raw)
    assert.equal(cleanBrief(raw), null)
  }
})

test('a null rank is kept (an unranked loop)', () => {
  const raw = good()
  raw.next_up = [{ ...loop, rank: null }]
  assert.equal(cleanBrief(raw)?.next_up[0]?.rank, null)
})

// The github block (step 4): present, absent, stale, never synced, withheld.
const github = () => ({
  withheld: false,
  age_line: 'GitHub digest: built 11/2/2026 4:10 PM, 1 hour old.',
  never_synced: false,
  stale: false,
  source_ok: true,
  built_at: '2026-11-02T22:10:00.000Z',
  row_count: 45,
  notes: [],
  text: 'GitHub: 2 repos, 5 open, 40 merged\nNo card: 2'
})

test('a brief with a fresh github block passes it through, age line first', () => {
  const brief = cleanBrief({ ...good(), github: github() })
  assert.deepEqual(brief?.github, github())
  assert.match(brief!.github!.age_line, /^GitHub digest: built /)
})

test('a brief without a github block has no github key', () => {
  const brief = cleanBrief(good())
  assert.deepEqual(brief, good())
  assert.equal('github' in brief!, false)
})

test('a stale github block keeps its stale flag and note', () => {
  const raw = { ...github(), stale: true, age_line: 'GitHub digest: built 11/2/2026 1:10 PM, 5 hours old.', notes: ['This digest is stale (more than 3 hours old), so GitHub may have moved.'] }
  const brief = cleanBrief({ ...good(), github: raw })
  assert.equal(brief?.github?.stale, true)
  assert.deepEqual(brief?.github?.notes, raw.notes)
})

test('a never-synced github block keeps its wording and null flags', () => {
  const raw = { withheld: false, age_line: 'GitHub digest: never built, so I have no GitHub report yet.', never_synced: true, stale: null, source_ok: null, built_at: '', row_count: 0, notes: ['The digest has not synced yet. GitHub may have moved and I cannot say how.'], text: '' }
  assert.deepEqual(cleanBrief({ ...good(), github: raw })?.github, raw)
})

test('a withheld github block keeps only its note', () => {
  const raw = { withheld: true, age_line: '', notes: ['GitHub is not shown to a class-scoped account without the personal class.'], text: '' }
  assert.deepEqual(cleanBrief({ ...good(), github: raw })?.github, raw)
})

test('github: unknown keys dropped, text and lines capped, notes bounded', () => {
  const raw = { ...github(), token: 'x', text: 't'.repeat(5000), age_line: 'a'.repeat(5000), notes: Array.from({ length: 50 }, () => 'n'.repeat(5000)) }
  const g = cleanBrief({ ...good(), github: raw })?.github as Record<string, any>
  assert.equal('token' in g, false)
  assert.equal(g.text.length, 1200)
  assert.equal(g.age_line.length, 200)
  assert.equal(g.notes.length, 10)
  assert.equal(g.notes[0].length, 300)
})

test('an off-shape github block fails the whole brief', () => {
  for (const bad of [
    'text', null, [],
    { ...github(), withheld: 'no' },
    { ...github(), age_line: 5 },
    { ...github(), text: undefined },
    { ...github(), notes: 'none' },
    { ...github(), stale: 'yes' },
    { ...github(), never_synced: 1 },
    { ...github(), row_count: -1 },
    { ...github(), built_at: 7 }
  ]) {
    assert.equal(cleanBrief({ ...good(), github: bad }), null)
  }
})

// The linear block (step 4): present, absent, stale, needs_input.
const linear = () => ({ text: 'Linear digest: built 11/2/2026 4:00 PM, 1 hour old.\nIn progress: 2 projects', stale: false, needs_input: false })

test('a brief with a linear block passes it through, age line first', () => {
  const brief = cleanBrief({ ...good(), linear: linear() })
  assert.deepEqual(brief?.linear, linear())
  assert.match(brief!.linear!.text, /^Linear digest: built /)
})

test('a brief without a linear block has no linear key', () => {
  assert.equal('linear' in cleanBrief(good())!, false)
})

test('a stale linear block and a needs_input one keep their flags', () => {
  assert.equal(cleanBrief({ ...good(), linear: { ...linear(), stale: true } })?.linear?.stale, true)
  assert.equal(cleanBrief({ ...good(), linear: { ...linear(), needs_input: true } })?.linear?.needs_input, true)
})

test('linear: unknown keys dropped and text capped', () => {
  const l = cleanBrief({ ...good(), linear: { ...linear(), token: 'x', text: 't'.repeat(9000) } })?.linear as Record<string, any>
  assert.equal('token' in l, false)
  assert.equal(l.text.length, 4000)
})

test('github and linear together; an off-shape linear block fails the brief', () => {
  const both = cleanBrief({ ...good(), github: github(), linear: linear() })
  assert.ok(both?.github && both?.linear)
  for (const bad of ['text', null, { ...linear(), text: 5 }, { ...linear(), stale: 'no' }, { text: 'x' }]) {
    assert.equal(cleanBrief({ ...good(), linear: bad }), null)
  }
})

test('a headline passes through, capped, and comes first', () => {
  const brief = cleanBrief({ ...good(), headline: 'Two open items are current. Want the details?' })
  assert.equal(brief?.headline, 'Two open items are current. Want the details?')
  assert.equal(Object.keys(brief as object)[0], 'headline')
  assert.equal(cleanBrief({ ...good(), headline: 'x'.repeat(900) })?.headline?.length, 500)
})

test('a missing, blank or non-string headline is left out and the brief still passes', () => {
  for (const headline of [undefined, '', '   ', 5, null, { a: 1 }]) {
    const brief = cleanBrief({ ...good(), headline }) as Record<string, any>
    assert.deepEqual(brief, good())
    assert.equal('headline' in brief, false)
  }
})
