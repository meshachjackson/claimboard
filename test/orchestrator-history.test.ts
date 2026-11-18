// The orchestrator screen's pure helpers: card-id links, search, day filter and day grouping. `pnpm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dayKey, filterHistory, groupByDay, linkCardIds, type HistoryEntry } from '../app/utils/orchestratorThread.ts'

// Noon local time, so the local day is the same in every time zone.
const at = (day: string) => new Date(`${day}T12:00:00`).toISOString()
const entry = (id: string, day: string, text: string, mine = true): HistoryEntry =>
  ({ id, mine, system: false, surface: '', text, at: at(day) })

test('card ids become links and the rest stays text', () => {
  assert.deepEqual(linkCardIds('See TSK-930219, then TSK-930220.'), [
    { text: 'See ' }, { card: 'TSK-930219' }, { text: ', then ' }, { card: 'TSK-930220' }, { text: '.' }
  ])
  assert.deepEqual(linkCardIds('no ids here'), [{ text: 'no ids here' }])
  assert.deepEqual(linkCardIds(''), [])
})

test('only full card ids link', () => {
  assert.deepEqual(linkCardIds('TSK-12 and XTSK-930219 and TSK-9302199'), [{ text: 'TSK-12 and XTSK-930219 and TSK-9302199' }])
})

test('linked parts join back to the original text', () => {
  const text = 'a TSK-930001 b\nTSK-930002'
  const back = linkCardIds(text).map(p => 'card' in p ? p.card : p.text).join('')
  assert.equal(back, text)
})

test('search needs every word, in any case', () => {
  const list = [entry('1', '2026-11-01', 'What is next on TSK-930219?'), entry('2', '2026-11-01', 'Telegram test')]
  assert.deepEqual(filterHistory(list, 'next tsk-930219', '', '').map(e => e.id), ['1'])
  const tg: HistoryEntry = { ...entry('3', '2026-11-01', 'hello'), surface: 'telegram' }
  assert.deepEqual(filterHistory([...list, tg], 'telegram', '', '').map(e => e.id), ['2', '3'])
  assert.deepEqual(filterHistory(list, '  ', '', '').map(e => e.id), ['1', '2'])
  assert.deepEqual(filterHistory(list, 'missing', '', '').map(e => e.id), [])
})

test('the day filter includes both ends and takes either one alone', () => {
  const list = [entry('a', '2026-10-30', 'x'), entry('b', '2026-11-01', 'x'), entry('c', '2026-11-02', 'x')]
  assert.deepEqual(filterHistory(list, '', '2026-11-01', '2026-11-01').map(e => e.id), ['b'])
  assert.deepEqual(filterHistory(list, '', '2026-11-01', '').map(e => e.id), ['b', 'c'])
  assert.deepEqual(filterHistory(list, '', '', '2026-10-30').map(e => e.id), ['a'])
})

test('entries group by local day in order', () => {
  const list = [entry('a', '2026-10-30', 'x'), entry('b', '2026-10-30', 'y'), entry('c', '2026-11-02', 'z')]
  const g = groupByDay(list)
  assert.deepEqual(g.map(x => [x.day, x.entries.map(e => e.id)]), [['2026-10-30', ['a', 'b']], ['2026-11-02', ['c']]])
  assert.equal(dayKey(at('2026-11-02')), '2026-11-02')
  assert.deepEqual(groupByDay([]), [])
})
