// Shared Registry overlays: the lifecycle gate sheet and the change request composer.
// The open agent drawer and its tab live in the URL (?agent=, ?tab=) so links and Back work.
import type { Lifecycle } from '~/types/registry'

export interface GateTarget {
  agentId: string
  to: Lifecycle
}

export interface ComposerTarget {
  agentId: string
  /** What the pencil was on: a registry field, an access row, "access" for a new row, or a behavior field. */
  field?: string
  accessId?: string
  mode: 'field' | 'access_new' | 'access_correct' | 'access_verify' | 'behavior'
}

export function useRegistryUi() {
  const gate = useState<GateTarget | null>('registry-gate', () => null)
  const composer = useState<ComposerTarget | null>('registry-composer', () => null)
  const route = useRoute()
  const router = useRouter()

  function openAgent(agentId: string, tab = 'overview') {
    router.push({ query: { ...route.query, agent: agentId, tab } })
  }
  function closeAgent() {
    const { agent: _a, tab: _t, ...rest } = route.query
    router.push({ query: rest })
  }
  function setTab(tab: string) {
    router.replace({ query: { ...route.query, tab } })
  }

  return { gate, composer, openAgent, closeAgent, setTab }
}
