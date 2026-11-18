// Applies the instance values from runtime config (NUXT_PUBLIC_* env) to the module-level tables that code reads through
// functions (owner, orchestrator, agent targets, avatars, project colors). Called once at startup by the two owner plugins.
import { setAgentAvatars, setBoardOwner, setDefaultRunner, setOrchestrator, setOrchestratorName, setRegistrar, setProjectColorOrder, setVaultFolder, setVaultPersonalFolders } from '~/types/board'
import { setAgentTargets } from '~/utils/dispatch'
import { setThreadTags } from '~/utils/orchestratorThread'
import { jsonObject, stringList } from '~/utils/jsonConfig'

export function applyInstanceConfig(c: Record<string, unknown>): void {
  setBoardOwner(String(c.boardOwner), String(c.boardOwnerName))
  setDefaultRunner(String(c.defaultRunner ?? ''))
  if (c.orchestratorAgentId) setOrchestrator(String(c.orchestratorAgentId))
  setOrchestratorName(String(c.orchestratorName ?? ''))
  setThreadTags(String(c.orchestratorInboxTag ?? ''), String(c.orchestratorBoardTag ?? ''))
  setRegistrar(String(c.registrarAgentId ?? ''), String(c.registrarName ?? ''))
  setVaultFolder(String(c.vaultFolder ?? ''))
  setVaultPersonalFolders(stringList('NUXT_PUBLIC_VAULT_PERSONAL_FOLDERS', c.vaultPersonalFolders))
  setAgentTargets(jsonObject('NUXT_PUBLIC_AGENT_TARGETS', c.agentTargets) ?? {})
  setAgentAvatars(jsonObject('NUXT_PUBLIC_AGENT_AVATARS', c.agentAvatars) ?? {})
  setProjectColorOrder(stringList('NUXT_PUBLIC_PROJECT_COLORS', c.projectColors))
}
