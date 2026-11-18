// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ['@nuxt/ui', '@pinia/nuxt', 'nuxt-auth-utils'],

  // Client-only rendering, kept on purpose since Phase 1:
  // the layout depends on the viewport, fixtures mode keeps edits in localStorage, and the
  // rows come from /api/board, which checks the session on every call.
  ssr: false,

  // ask_vera holds /mcp while the orchestrator answers: the gateway waits up to 100 s by default (140 s at most), and
  // agent-board's own call to it times out at 145 s (server/utils/gateway.ts). Every function may run up to 160 s; the others
  // finish in seconds. Needs Vercel Fluid compute (Hobby without it stops at 60 s; then set gov_config ask.wait_sec under 50).
  // Functions run in sfo1, next to the droplet that hosts n8n and the step store Postgres (SFO3): fewer miles on every database and gateway call.
  nitro: { vercel: { regions: ['sfo1'], functions: { maxDuration: 160 } } },

  // Private values only, filled from NUXT_* env vars (.env.example lists them).
  // nuxt-auth-utils reads NUXT_SESSION_PASSWORD and NUXT_OAUTH_GITHUB_* on its own.
  runtimeConfig: {
    // The board owner, readable by the browser too. Set NUXT_PUBLIC_BOARD_OWNER (person:<name>) and NUXT_PUBLIC_BOARD_OWNER_NAME;
    // the defaults below are placeholders, so a deployment that forgets them writes as person:owner.
    public: {
      boardOwner: 'person:owner',
      boardOwnerName: 'Owner',
      defaultRunner: '',
      repoSlug: '', // NUXT_PUBLIC_REPO_SLUG: owner/name of this board's GitHub repo; empty hides the PR links and the PR count
      orchestratorName: '', // NUXT_PUBLIC_ORCHESTRATOR_NAME: what the UI calls the orchestrator; empty keeps "Orchestrator"
      orchestratorInboxTag: '', // NUXT_PUBLIC_ORCHESTRATOR_INBOX_TAG: tag of the inbox card; empty keeps orchestrator-inbox
      orchestratorBoardTag: '', // NUXT_PUBLIC_ORCHESTRATOR_BOARD_TAG: tag of board thread cards; empty keeps orchestrator-board
      registrarAgentId: '', // NUXT_PUBLIC_REGISTRAR_AGENT_ID: the agent the Registry pages ask; empty keeps agt-registrar
      registrarName: '', // NUXT_PUBLIC_REGISTRAR_NAME: what the UI calls it; empty keeps "Registrar"
      appName: 'claimboard', // NUXT_PUBLIC_APP_NAME: the name in the header and the browser tab
      featureOrchestrator: false, // NUXT_PUBLIC_FEATURE_ORCHESTRATOR=true: the /orchestrator page, the Claude connector (OAuth) and the ask tools (shared/features.ts)
      orchestratorAgentId: 'agt-orchestrator', // NUXT_PUBLIC_ORCHESTRATOR_AGENT_ID: the agent that answers when no other can
      agentTargets: '', // NUXT_PUBLIC_AGENT_TARGETS: JSON {"agt-id": "laptop" | "cloud" | "actions"}; read by the dispatcher too
      agentAvatars: '', // NUXT_PUBLIC_AGENT_AVATARS: JSON {"agt-id": {"mono": "AB", "color": "#7C3AED"}}
      projectColors: '', // NUXT_PUBLIC_PROJECT_COLORS: JSON list of project ids, in color-slot order
      vaultPersonalFolders: '', // NUXT_PUBLIC_VAULT_PERSONAL_FOLDERS: JSON list of vault subfolders note bodies may never name
      vaultFolder: '' // NUXT_PUBLIC_VAULT_FOLDER: a notes folder whose personal paths note bodies may not name; empty turns the check off
    }, // defaultRunner: agt-<name> that Start gives unassigned cards to; '' = the pool
    boardSource: '',
    boardFile: '', // fixtures mode saves its rows here when set (server/utils/fixtures.ts)
    boardTokenFormUrl: '', // NUXT_BOARD_TOKEN_FORM_URL: where the owner files a connector token's hash; empty hides the link
    boardReadUrl: '',
    boardHeaderName: '',
    boardHeaderValue: '',
    boardWriteUrl: '',
    boardWriteHeaderName: '',
    boardWriteHeaderValue: '',
    boardBackend: '', // NUXT_BOARD_BACKEND: empty or 'reference' keeps the board in SQLite (server/utils/sqliteStore.ts); 'n8n-gateway' uses the n8n gateways
    boardDb: '.data/board.sqlite',
    boardAccess: '.data/access.json', // agent tokens (SHA-256) and the ops each may call, for the reference backend
    accessPolicyFile: '.data/access-policy.json', // groups and per-board, project and card rules (server/utils/policy.ts); missing means no limits
    agentSwitchesFile: '.data/agent-switches.json', // the owner's on/off/auto switch per agent (server/utils/agentSwitches.ts)
    boardLiveOps: '', // proposed ops gw.gov-board-write has gained, comma-separated (types/board.ts PROPOSED_OPS)
    unscopedAgents: '', // agents with no board:class row: only these read from the cache (server/utils/classScope.ts)
    stepStore: '', // NUXT_STEP_STORE=postgres turns on the Postgres step store (server/utils/stepStore.ts); empty keeps n8n
    stepStoreUrl: '', // NUXT_STEP_STORE_URL: the Postgres connection string. Env only, never in the repo
    stepStoreWsUrl: '', // NUXT_STEP_STORE_WS_URL: wss:// URL of a WebSocket-to-Postgres proxy (secret path included). Empty keeps Neon
    registrySource: '',
    registryFile: '.data/registry.json', // NUXT_REGISTRY_SOURCE=file reads this copy (scripts/registry-pull.mjs writes it)
    registryReadUrl: '',
    registryHeaderName: '',
    registryHeaderValue: '',
    connectorSealKey: '', // seals the orchestrator connector's OAuth values (server/utils/seal.ts); at least 32 characters
    vercelToken: '', // header status: read-only, server-side only
    vercelProjectId: '',
    vercelTeamId: '',
    githubToken: '', // fine-grained, read-only, pull requests on this repo
    anthropicApiKey: '', // NUXT_ANTHROPIC_API_KEY: the board manager chat (server/utils/boardManager.ts) calls the Messages API with it
    managerModel: 'claude-sonnet-5-5',
    allowedGithubLogin: '',
    allowedLogins: '', // more allowed logins, comma-separated (server/utils/logins.ts)
    devLogin: ''
  },

  devtools: { enabled: false },

  css: ['~/assets/css/main.css'],

  // Light, Dark or System, chosen on the Settings page. The choice is kept per browser.
  colorMode: { preference: 'system', fallback: 'light', storageKey: 'agent-board:theme' },

  app: {
    head: {
      // Read at build time, so the tab shows the instance's name before the app loads (useAppName() takes over after).
      // The repo has no @types/node, so TypeScript can't type process here; the config runs in Node.
      // @ts-ignore
      title: process.env.NUXT_PUBLIC_APP_NAME || 'claimboard',
      htmlAttrs: { lang: 'en' },
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' }]
    }
  },

  vite: {
    optimizeDeps: { include: ['vue-draggable-plus'] }
  },

  compatibilityDate: '2026-06-30'
})
