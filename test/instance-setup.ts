// The owner's deployment values, set the way the plugins set them from NUXT_PUBLIC_* env. Importing this file first makes a test run
// with the same orchestrator, dispatch targets and vault folder the board had before they moved into config (the parity check).
process.env.NUXT_PUBLIC_AGENT_TARGETS = JSON.stringify({ 'agt-claude-code-macbook': 'laptop', 'agt-claude-code-cloud': 'cloud', 'agt-actions-runner': 'actions' })
const board = await import('../app/types/board.ts')
board.setOrchestrator('agt-orchestrator')
board.setVaultFolder('Notes')
board.setVaultPersonalFolders(['Private-Notes'])
export {}
