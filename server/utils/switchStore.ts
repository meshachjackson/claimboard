// Where the owner's agent switches live, per host.
// Gateway mode with set_switch live (NUXT_BOARD_LIVE_OPS): n8n holds them (gov_config board.switch). The owner op
// set_switch writes it, gw.gov-board-read returns it as `switch` on each registry row, and Plan Board refuses a switched-off
// agent. Everything else (fixtures, the local file board, a gateway without the op yet) keeps the file in agentSwitches.ts.
import type { RegistryAgent } from '~~/app/types/board'
import { boardOwner } from '~~/app/types/board'
import type { SwitchMode } from '~~/app/utils/availability'
import { readSwitches, writeSwitch } from './agentSwitches'

/** True when n8n owns the switches on this host. */
export function switchesInN8n(): boolean {
  const store = boardStore()
  return store.name === 'n8n-gateway' && store.source() === 'gateway' && store.capabilities().liveOps.includes('set_switch')
}

/** Registry rows with the switches on them. In n8n mode the rows already carry `switch`; otherwise the file is laid over them. */
export function withSwitches<T extends Pick<RegistryAgent, 'agent_id'>>(registry: T[]): T[] {
  if (switchesInN8n()) return registry
  const switches = readSwitches(String(useRuntimeConfig().agentSwitchesFile))
  return registry.map(a => (switches[a.agent_id] ? { ...a, switch: switches[a.agent_id] } : a))
}

/** Saves one switch. Returns '' on success, else the reason, in words for the Settings toast. */
export async function saveSwitch(agentId: string, mode: SwitchMode): Promise<string> {
  if (switchesInN8n()) {
    const result = await boardStore().write('set_switch', { agent_id: agentId, mode }, { person: boardOwner() })
    if (!result.ok) return `n8n refused the switch: ${result.reason}`
    await boardStore().read(true) // registry rows come from the read; re-read so every tab and the agent gate see it now
    return ''
  }
  try {
    writeSwitch(String(useRuntimeConfig().agentSwitchesFile), agentId, mode)
    return ''
  } catch {
    // Vercel's file system is read-only.
    return 'This host cannot save switches until the n8n gateway has set_switch. Add it to NUXT_BOARD_LIVE_OPS once it is published, or use the local board.'
  }
}

/** True when the owner switched this agent off. Reads the cached board in n8n mode, the file otherwise. */
export async function agentSwitchedOff(agentId: string): Promise<boolean> {
  if (!agentId) return false
  if (switchesInN8n()) {
    const board = await boardStore().read()
    return board.registry.find(a => a.agent_id === agentId)?.switch === 'off'
  }
  const file = String(useRuntimeConfig().agentSwitchesFile)
  return readSwitches(file)[agentId] === 'off'
}

/** True when any agent is switched off, so the agent gate can skip the token lookup on a board with no switches. */
export async function anySwitchedOff(): Promise<boolean> {
  if (switchesInN8n()) return (await boardStore().read()).registry.some(a => a.switch === 'off')
  return Object.values(readSwitches(String(useRuntimeConfig().agentSwitchesFile))).includes('off')
}
