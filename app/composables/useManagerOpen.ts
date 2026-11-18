// Whether the orchestrator panel (ManagerChat.vue) is open. Shared by the app bar button and the panel.
export const useManagerOpen = () => useState('ab-manager-open', () => false)
