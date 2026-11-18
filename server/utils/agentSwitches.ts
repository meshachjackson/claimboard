// The owner's on/off switch per agent, kept in one small JSON file (default .data/agent-switches.json), never in the
// n8n tables: the board does not write gov_registry. { "agt-codex": "off", "agt-orchestrator": "auto" }. A missing agent means "on".
// This needs a writable folder, so it is for the local board; on Vercel the file cannot be written and Settings says so.
// The repo has no @types/node, so TypeScript can't type these Node imports; Nitro runs on Node, so they resolve at run time.
// @ts-ignore
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
// @ts-ignore
import { dirname } from 'node:path'
import { isSwitchMode } from '../../app/utils/availability.ts'
import type { SwitchMode } from '../../app/utils/availability.ts'

export type Switches = Record<string, SwitchMode>

/** The switches in a file's text. Unreadable text, other ids' junk and unknown modes are dropped; "on" is the default so it is not kept. */
export function parseSwitches(text: string): Switches {
  try {
    const raw = JSON.parse(text)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    return Object.fromEntries(Object.entries(raw).filter(([id, mode]) => /^agt-[a-z0-9-]+$/.test(id) && isSwitchMode(mode) && mode !== 'on')) as Switches
  } catch {
    return {}
  }
}

export function readSwitches(file: string): Switches {
  return existsSync(file) ? parseSwitches(readFileSync(file, 'utf8')) : {}
}

/** Sets one agent's mode and returns the new switches. Throws if the file cannot be written. */
export function writeSwitch(file: string, agentId: string, mode: SwitchMode): Switches {
  const next = { ...readSwitches(file) }
  if (mode === 'on') delete next[agentId]
  else next[agentId] = mode
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`)
  return next
}

/** True when the agent is switched off. Reads the file each time, so an edit by hand applies without a restart. */
export function isSwitchedOff(file: string, agentId: string): boolean {
  return !!agentId && readSwitches(file)[agentId] === 'off'
}
