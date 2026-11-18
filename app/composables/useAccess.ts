// The signed-in person's access (GET /api/access, shared/access.ts): their groups, the boards they can see, and,
// for admins, the whole policy. `policy` is null until onboarding has run.
import type { Policy } from '~~/shared/access'

interface AccessState { policy: Policy | null, you: string, groups: string[], admin: boolean, boards: string[], loaded: boolean }

export function useAccess() {
  const state = useState<AccessState>('access', () => ({ policy: null, you: '', groups: [], admin: false, boards: ['main'], loaded: false }))

  async function load() {
    try {
      Object.assign(state.value, await $fetch<AccessState>('/api/access'), { loaded: true })
    } catch {
      // Signed out or the server is down: keep the defaults, the board page shows its own error.
    }
  }

  /** Replaces the whole policy. Returns the server's reason when it refuses, else ''. */
  async function save(policy: Policy): Promise<string> {
    try {
      await $fetch('/api/access', { method: 'PUT', body: policy })
      await load()
      return ''
    } catch (e) {
      return (e as { statusMessage?: string }).statusMessage ?? 'Could not save'
    }
  }

  /** Onboarding's last step: creates the policy from the group names. */
  async function onboard(groups: { name: string, members: string[] }[]): Promise<string> {
    try {
      await $fetch('/api/access/onboard', { method: 'POST', body: { groups } })
      await load()
      return ''
    } catch (e) {
      return (e as { statusMessage?: string }).statusMessage ?? 'Could not save'
    }
  }

  return {
    state,
    boards: computed(() => state.value.boards),
    load,
    save,
    onboard
  }
}
