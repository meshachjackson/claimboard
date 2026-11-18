// A small Linear GraphQL client for scripts/linear-run.mjs. Node built-ins only (fetch).
// The token is read from the environment in one place below and is never printed, logged or put in an error.
// Field and mutation names were checked on 11/12/2026 against Linear's public schema file and developer pages;
// docs/linear-runner.md lists what has not been tried against the live API.

export const LINEAR_URL = 'https://api.linear.app/graphql'

// Every write starts with the word "mutation", so a test can count writes by looking at the request body.
const Q = {
  viewer: 'query Me { viewer { id name } }',
  delegated: `query Delegated($me: ID!) {
    issues(first: 50, filter: { delegate: { id: { eq: $me } }, state: { type: { nin: ["completed", "canceled", "duplicate"] } } }) {
      nodes { id identifier title description priority createdAt url team { id } state { id name type } labels { nodes { name parent { name } } } comments(last: 10) { nodes { body createdAt } } }
    }
  }`,
  // One issue as it is now, for the cloud worker (scripts/linear-job.mjs): who it is delegated to, its status and labels, and up to
  // 50 comments, so a count of "Verifier: FAIL" comments is not cut short by design and handoff comments.
  issue: `query OneIssue($id: String!) {
    issue(id: $id) { id identifier title description priority createdAt url team { id } state { id name type } delegate { id name } labels { nodes { name parent { name } } } comments(last: 50) { nodes { body createdAt } } }
  }`,
  issueState: 'query IssueState($id: String!) { issue(id: $id) { identifier state { type } } }',
  sessions: 'query Sessions { agentSessions(first: 50) { nodes { id status issue { id } appUser { id } } } }',
  states: 'query TeamStates($teamId: String!) { team(id: $teamId) { states { nodes { id name type position } } } }',
  user: `query FindUser($name: String!) {
    users(first: 5, filter: { or: [{ name: { eqIgnoreCase: $name } }, { displayName: { eqIgnoreCase: $name } }] }) { nodes { id name } }
  }`,
  createSession: 'mutation AgentSessionCreateOnIssue($input: AgentSessionCreateOnIssue!) { agentSessionCreateOnIssue(input: $input) { success agentSession { id } } }',
  comment: 'mutation CommentCreate($input: CommentCreateInput!) { commentCreate(input: $input) { success } }',
  activity: 'mutation AgentActivityCreate($input: AgentActivityCreateInput!) { agentActivityCreate(input: $input) { success } }',
  updateIssue: 'mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }'
}

/** Labels as a plain list of names (a child of the `agent` group as `agent:<name>`), comment bodies as `notes`, oldest first. */
const shape = i => ({ ...i, labels: (i.labels?.nodes ?? []).map(l => l.parent?.name === 'agent' ? `agent:${l.name}` : l.name), notes: (i.comments?.nodes ?? []).map(c => c.body) })

/**
 * The calls the runner makes. `fetch` can be swapped for a fake in tests. Throws when no token is set, when Linear answers
 * with an HTTP error, or when the answer carries GraphQL errors. The thrown text holds the status and Linear's message only.
 */
export function makeLinear({ token = process.env.LINEAR_RUN_TOKEN, fetch: send = globalThis.fetch, url = LINEAR_URL } = {}) {
  if (!token) throw new Error('No Linear token is set for the runner (docs/linear-runner.md names the env value).')

  async function gql(query, variables = {}) {
    const res = await send(url, { method: 'POST', headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }) })
    const data = await res.json().catch(() => null)
    if (!res.ok || !data || data.errors?.length) throw new Error(`Linear answered ${res.status}: ${String(data?.errors?.[0]?.message ?? 'no readable answer').slice(0, 200)}`)
    return data.data
  }
  const updateIssue = (id, input) => gql(Q.updateIssue, { id, input })

  return {
    /** The app user this token acts as: { id, name }. */
    viewer: async () => (await gql(Q.viewer)).viewer,

    /** Open issues whose delegate is this app user. Labels come back as a plain list of names, and the last 10 comments as `notes`. */
    delegatedIssues: async (me) => (await gql(Q.delegated, { me })).issues.nodes.map(shape),

    /** One issue by identifier (ENG-12) or id, shaped like delegatedIssues plus `delegate` ({ id, name } or null), with up to 50 comments. */
    issue: async (id) => { const i = (await gql(Q.issue, { id })).issue; return i ? shape(i) : null },

    /** The state type ('completed', 'started', ...) of the issue with this identifier, or null when there is none. */
    issueState: async (identifier) => (await gql(Q.issueState, { id: identifier }).catch(err => { if (/not found|entity/i.test(err.message)) return { issue: null }; throw err })).issue?.state?.type ?? null,

    /** This runner's live session on an issue (the one Linear opened when the issue was delegated), or a new one. Returns the session id. */
    sessionFor: async (issueId, me) => {
      const open = (await gql(Q.sessions)).agentSessions.nodes.find(s => s.issue?.id === issueId && s.appUser?.id === me && !['complete', 'error'].includes(s.status))
      return open?.id ?? (await gql(Q.createSession, { input: { issueId } })).agentSessionCreateOnIssue.agentSession.id
    },

    /** Posts one agent activity. `content` is { type: 'thought' | 'elicitation' | 'response' | 'error', body } or { type: 'action', action, parameter, result }. */
    activity: (agentSessionId, content) => gql(Q.activity, { input: { agentSessionId, content } }),

    /** Adds a comment to the issue. Agents use comments to pass a block reason or a decision to the next agent, where Meshach can read it too. */
    note: (issueId, body) => gql(Q.comment, { input: { issueId, body } }),

    /** Sets the delegate. null takes the issue off every agent's queue. */
    setDelegate: (issueId, userId) => updateIssue(issueId, { delegateId: userId }),

    /**
     * Moves an issue to the team status that matches: the status with that name when `name` is given and exists, otherwise
     * the first status (lowest position) of that type. `extra` rides along in the same write. Returns the status name, or '' when none matched.
     */
    moveIssue: async (issue, { type, name }, extra = {}) => {
      const states = (await gql(Q.states, { teamId: issue.team.id })).team.states.nodes
      const to = states.find(s => name && s.name.toLowerCase() === name.toLowerCase()) ?? states.filter(s => s.type === type).sort((a, b) => a.position - b.position)[0]
      if (to || Object.keys(extra).length) await updateIssue(issue.id, { ...(to && { stateId: to.id }), ...extra })
      return to?.name ?? ''
    },

    /** A user (person or agent app) by name or display name: { id, name } or null. */
    findUser: async (name) => (await gql(Q.user, { name })).users.nodes[0] ?? null
  }
}
