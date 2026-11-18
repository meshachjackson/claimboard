// Board threads with the orchestrator: isolated from Telegram, resettable, listed newest first in full history. `pnpm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { historyThreads, isBoardThread, newestBoardThread, parseSurface, threadTitle, withSurface, type HistoryEntry } from '../app/utils/orchestratorThread.ts'

test('a new thread is titled with an American date and time', () => {
  assert.equal(threadTitle(new Date(2026, 10, 7, 9, 5)), 'Board chat 11/7/2026 9:05 AM')
  assert.equal(threadTitle(new Date(2026, 10, 7, 0, 30)), 'Board chat 11/7/2026 12:30 AM')
  assert.equal(threadTitle(new Date(2026, 10, 7, 15, 0)), 'Board chat 11/7/2026 3:00 PM')
})

const inbox = { task_id: 'TSK-1', tags: 'orchestrator-inbox', created_at: '2026-11-07T20:00:00Z' }
const old = { task_id: 'TSK-2', tags: 'orchestrator-board', created_at: '2026-11-05T10:00:00Z' }
const fresh = { task_id: 'TSK-3', tags: 'orchestrator-board', created_at: '2026-11-06T10:00:00Z' }

test('telegram stays out: the panel thread is never the inbox card, even when it is newest', () => {
  assert.equal(newestBoardThread([inbox, old, fresh])?.task_id, 'TSK-3')
  assert.equal(newestBoardThread([inbox]), null)
  assert.equal(newestBoardThread([{ ...fresh, archived_at: '2026-11-07T00:00:00Z' }, old])?.task_id, 'TSK-2')
})

const e = (id: string, day: string, text: string): HistoryEntry => ({ id, mine: true, system: false, surface: '', text, at: new Date(`${day}T12:00:00`).toISOString() })

test('history threads: newest first, filters apply inside each, empty ones drop only while filtering', () => {
  const byCard = { 'TSK-2': [e('a', '2026-11-05', 'budget')], 'TSK-3': [e('b', '2026-11-06', 'runner'), e('c', '2026-11-06', 'budget')] }
  const cards = [old, fresh]
  assert.deepEqual(historyThreads(cards, byCard, '', '', '').map(t => [t.id, t.entries.length]), [['TSK-3', 2], ['TSK-2', 1]])
  assert.deepEqual(historyThreads(cards, byCard, 'runner', '', '').map(t => [t.id, t.entries.length]), [['TSK-3', 1]])
  assert.deepEqual(historyThreads(cards, {}, '', '', '').map(t => t.entries.length), [0, 0])
})

test('a telegram note on the inbox card never reaches history threads built from board cards', () => {
  const notes = [{ card: 'TSK-1', body: withSurface('telegram', 'hi') }, { card: 'TSK-3', body: withSurface('board', 'hello') }]
  const boardCards = [inbox, fresh].filter(c => isBoardThread(c.tags))
  const byCard: Record<string, HistoryEntry[]> = {}
  for (const n of notes) {
    const { surface, text } = parseSurface(n.body)
    ;(byCard[n.card] ??= []).push({ id: n.card + text, mine: true, system: false, surface, text, at: fresh.created_at })
  }
  const threads = historyThreads(boardCards, byCard, '', '', '')
  assert.deepEqual(threads.flatMap(t => t.entries.map(x => x.surface)), ['board'])
})
