// The changelog shown at /changelog: every merged pull request that changes what the board does, with steps the owner can
// follow to see it work. Newest first (date, then PR number). A PR that touches app/, server/ or shared/ and is in neither
// list below fails test/changelog.test.ts, so add the entry in the same PR.
//
// Step format: start with Click, Open, Type, Drag, Press or Run, and say what to expect: "Click X. Expect Y."
// Keep each step to one action and one result.

export interface ChangelogEntry {
  pr: number
  /** The day the PR merged, ISO (2026-11-07). */
  date: string
  title: string
  /** One line: what is different now. */
  summary: string
  /** Where to look (a page or menu), shown above the steps. */
  where: string
  /** 1 to 4 steps, each "Click X. Expect Y." */
  steps: string[]
}

/** PRs before this one are not in the changelog; the completeness test starts here. */
export const BASELINE_PR = 133

export const CHANGELOG: ChangelogEntry[] = [
  {
    pr: 217,
    date: '2026-11-17',
    title: 'The orchestrator page moves to /orchestrator and its name comes from settings',
    summary: 'The orchestrator history page is now at /orchestrator (the old path no longer works). Its name in the rail, tabs, panel and buttons comes from NUXT_PUBLIC_ORCHESTRATOR_NAME.',
    where: 'Agents, the orchestrator tab',
    steps: [
      'Open Agents and click the orchestrator tab. Expect the history page at /orchestrator, titled with the name from settings.',
      'Click the orchestrator button in the rail. Expect the panel header to show that same name.'
    ]
  },
  {
    pr: 172,
    date: '2026-11-07',
    title: 'The board reads n8n every 30 minutes, not 5 (fewer n8n runs)',
    summary: 'With the Postgres step store on, cards edited inside n8n can take up to 30 minutes to show. Moves made on the board still show at once.',
    where: 'Board',
    steps: [
      'Drag a card to another column on the Board. Expect it to change column at once.',
      'Click Refresh. Expect cards edited inside n8n to show now, without the 30 minute wait.'
    ]
  },
  {
    pr: 162,
    date: '2026-11-07',
    title: 'Clearer navigation, one word for each thing, and easier to read and tap',
    summary: 'The board says "Loading..." instead of 0, a Needs you card shows its question first, one name for each thing, a quieter Board bar, and larger targets with better contrast.',
    where: 'Floor, Board, card panel, rail',
    steps: [
      'Open the Floor on a fresh page load. Expect dashes and "Loading..." in the zones, then the real counts, with the left zone titled "Needs you".',
      'Click a Needs you card. Expect the question and a reply box at the top, and the button "New card" in the bar.',
      'Open the Board at desktop width and click Filters. Expect View options and Saved views inside, and Backlog showing 15 cards with "Show all".',
      'Click Ask the orchestrator in the rail. Expect "The orchestrator: answers and routes" under the header, and one "Plan" and one "Help" link in the rail.'
    ]
  },
  {
    pr: 153,
    date: '2026-11-07',
    title: 'Link to the taxonomy and usability map in Help',
    summary: 'Help has a Reference section that opens the taxonomy and usability map on GitHub.',
    where: 'Help, Reference',
    steps: [
      'Open Help and click Reference in the section list. Expect a "Taxonomy and usability map" entry.',
      'Click "Taxonomy and usability map". Expect the map to open on GitHub in a new tab (sign-in to GitHub required).'
    ]
  },
  {
    pr: 150,
    date: '2026-11-07',
    title: 'The orchestrator board threads stay apart from Telegram',
    summary: 'Chats with the orchestrator from the board have their own threads, a New thread button, and /new and /clear. Threads show in the full history.',
    where: 'Ask the board manager, and /orchestrator',
    steps: [
      'Click Ask the board manager and send the orchestrator a message. Expect the reply in the panel and no new message in your Telegram chat.',
      'Click New thread, or type /new and press Enter. Expect an empty thread, with the old one still listed in full history.',
      'Open /orchestrator. Expect the board threads listed in the history.'
    ]
  },
  {
    pr: 148,
    date: '2026-11-07',
    title: 'Rail, app and the orchestrator drawer are separate frames',
    summary: 'Opening the orchestrator drawer narrows the whole app instead of covering it. Each frame scrolls on its own. On the phone, the orchestrator replaces the app.',
    where: 'Ask the board manager (any page)',
    steps: [
      'Click Ask the board manager on desktop. Expect the whole board, not only the header, to shift left, with the board and the drawer scrolling separately.',
      'Open Settings and scroll. Expect the section list on the left to follow where you are.',
      'Open the manager on a phone. Expect it to replace the page, with one scrollbar.'
    ]
  },
  {
    pr: 147,
    date: '2026-11-07',
    title: 'Changelog page with steps to try each change',
    summary: 'A page lists every board change with click-and-expect steps, and a test keeps it complete.',
    where: 'Changelog page',
    steps: [
      'Open the changelog page. Expect the newest changes first, each with steps that say what to click and what to expect.'
    ]
  },
  {
    pr: 146,
    date: '2026-11-07',
    title: 'The board makes room when the manager chat opens',
    summary: 'On desktop the chat drawer is a column beside the page, so its scrollbar no longer sits on the board\'s.',
    where: 'Ask the board manager (desktop)',
    steps: [
      'Click Ask the board manager in the left rail. Expect the board to shrink and the chat to sit beside it, with two separate scrollbars.'
    ]
  },
  {
    pr: 145,
    date: '2026-11-07',
    title: 'Ask the board manager from the sidebar',
    summary: 'The board manager chat opens from the left rail on any page, not only from the board bar.',
    where: 'Left rail, any page (desktop)',
    steps: [
      'Open any page, such as Settings, and click Ask the board manager at the top of the left rail. Expect the manager panel to open.',
      'Click Ask the board manager again. Expect the panel to close.'
    ]
  },
  {
    pr: 144,
    date: '2026-11-07',
    title: 'API page: search, one-line rows, expand all, first call',
    summary: 'The API reference is faster to scan and has a first-call example with this board\'s address.',
    where: 'Board menu > API reference',
    steps: [
      'Open the API reference and type claim in the search box. Expect only matching routes and a count such as "3 of 30 routes match".',
      'Click Expand all. Expect every route to open, and the button to read Collapse all.',
      'Click Copy under "Try your first call". Expect the curl command on your clipboard.'
    ]
  },
  {
    pr: 142,
    date: '2026-11-07',
    title: 'API reference page',
    summary: 'A page lists every route the board serves, who may call it and what it returns.',
    where: 'Board menu > API reference, or /api',
    steps: [
      'Click the ... board menu, then API reference. Expect routes grouped in sections, with who may call each.',
      'Click one route row. Expect what to send and an example response.'
    ]
  },
  {
    pr: 141,
    date: '2026-11-07',
    title: 'Board errors where the orchestrator can read them',
    summary: 'Server faults are logged, scrubbed of credentials, and the orchestrator and the board manager can list them.',
    where: 'Board manager chat (needs the Postgres step store for a saved log)',
    steps: [
      'Open the board manager and type: what errors happened recently? Expect the faults grouped by cause, or a note that there are none.'
    ]
  },
  {
    pr: 140,
    date: '2026-11-07',
    title: 'Agent switch responds at the click',
    summary: 'The On / Auto / Off switch moves at once, shows a toast, and goes back if the save fails.',
    where: 'Settings > Agents',
    steps: [
      'Open Settings > Agents and click Off on one agent. Expect the switch to move at once and a toast that ends "is now Off".',
      'Click On on the same agent. Expect the switch to move at once and a toast that ends "is now On".'
    ]
  },
  {
    pr: 138,
    date: '2026-11-07',
    title: 'Reassigning a card cancels the old agent\'s waiting steps',
    summary: 'Changing a card\'s assignee cancels steps still waiting for the previous agent, in any column.',
    where: 'Any card with a waiting step',
    steps: [
      'Open a card with a waiting step and change its assignee. Expect the old agent\'s waiting step to be cancelled and the new agent to hold the card.'
    ]
  },
  {
    pr: 134,
    date: '2026-11-06',
    title: 'Stages view no longer goes blank for a card with no project',
    summary: 'Cards without a project sit in a "No project" lane instead of blanking the desktop board.',
    where: 'Board, Stages view',
    steps: [
      'Open the board in Stages view when a card has no project. Expect the board to draw, with that card in a "No project" lane.'
    ]
  },
  {
    pr: 133,
    date: '2026-11-06',
    title: 'Run it: one action to create, assign and start a card',
    summary: 'Run it creates, assigns and starts a card at once; Plan first sends it to Architecture; one dispatcher starts agent work.',
    where: 'New ticket editor',
    steps: [
      'Open a new ticket, write a title and press Cmd+Enter (or click Run it). Expect the card in Build with an agent on it.',
      'Open a new ticket, click Plan first, then Run it. Expect the card in Architecture, not Build.'
    ]
  }
]

/** Merged PRs that touch app/, server/ or shared/ but change nothing the owner can see yet. Say why. */
export const INTERNAL_PRS: { pr: number, reason: string }[] = [
  { pr: 220, reason: 'Open-source export prep: SQLite becomes the core default and the orchestrator features sit behind NUXT_PUBLIC_FEATURE_ORCHESTRATOR. With the instance env set nothing visible changes.' },
  { pr: 213, reason: 'Open-source config seam: instance values move from code to env . With the env set nothing visible changes.' },
  { pr: 212, reason: 'The consent page links to the form path; only the link target changed.' },
  { pr: 200, reason: 'Board retirement step 1 (PR number is a placeholder, fix on merge): shared runner code moved to scripts/lib; no change to what the board does.' },
  { pr: 135, reason: 'Postgres step store cutover steps; behind NUXT_STEP_STORE, which is off.' },
  { pr: 136, reason: 'Event retention and the split verb for agents; behind NUXT_STEP_STORE, which is off.' },
  { pr: 137, reason: 'Class rule ported to the Postgres step store; behind NUXT_STEP_STORE, which is off.' },
  { pr: 151, reason: 'Added changelog entries for earlier PRs; no change to what the board does.' },
  { pr: 163, reason: 'The dispatcher poll reads only open steps from Postgres; same answer, less Neon data transfer.' },
  { pr: 164, reason: 'Postgres step and note rows are cached for 30 seconds; same board, less Neon data transfer.' },
  { pr: 165, reason: 'The dispatcher polls every 15 seconds instead of 5 while no step is open; fewer database reads, same board.' },
  { pr: 166, reason: 'The step store can reach a plain Postgres through a WebSocket proxy when NUXT_STEP_STORE_WS_URL is set; unset, nothing changes.' },
  { pr: 167, reason: 'Docs and shell scripts for moving the step store to the droplet; no change to the board.' },
  { pr: 168, reason: 'Docs only: the load SQL and runbook for moving the Neon export to the droplet; no change to the board.' },
  { pr: 170, reason: 'Board reads lay only the last 30 days of steps and notes, and the agent_handoff token gate is gone; same board, less database transfer.' }
]

/** Which of these PR numbers have neither an entry nor an internal row. */
export function missingFromChangelog(prs: number[]): number[] {
  const known = new Set([...CHANGELOG.map(e => e.pr), ...INTERNAL_PRS.map(i => i.pr)])
  return prs.filter(pr => !known.has(pr))
}
