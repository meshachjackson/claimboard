// American dates: 10/25/2026 and 10/25/2026, 9:05 AM (CLAUDE.md).

const dateFmt = new Intl.DateTimeFormat('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
const timeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })

/** A bare day (2026-10-30, as due_at is saved) is local midnight, not UTC; otherwise it shows the day before. */
export function parseDate(iso: string): Date {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return day ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])) : new Date(iso)
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  return dateFmt.format(parseDate(iso))
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${dateFmt.format(d)}, ${timeFmt.format(d)}`
}

/** 9:05 AM */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return ''
  return timeFmt.format(new Date(iso))
}

/** "a,b, c" → ["a", "b", "c"] */
export function splitList(value: string | null | undefined): string[] {
  return (value ?? '').split(',').map(s => s.trim()).filter(Boolean)
}

/** acceptance_requirements uses " | " between checkable lines. */
export function splitRequirements(value: string): string[] {
  return value.split('|').map(s => s.trim()).filter(Boolean)
}
