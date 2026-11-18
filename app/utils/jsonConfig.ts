// Instance values that are lists or maps arrive from env as JSON text (Nuxt may already have parsed it into an object).
// Blank means "not set". Bad JSON throws, so a typo in Vercel fails at startup instead of silently showing nothing.
export function jsonConfig(name: string, value: unknown): unknown {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    throw new Error(`${name} must be valid JSON`)
  }
}

/** A plain object (not an array), else undefined for blank and a throw for any other shape. */
export function jsonObject(name: string, value: unknown): Record<string, unknown> | undefined {
  const v = jsonConfig(name, value)
  if (v === undefined) return undefined
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(`${name} must be a JSON object`)
  return v as Record<string, unknown>
}

/** A list of strings: JSON array, or comma-separated text. Blank is []. */
export function stringList(name: string, value: unknown): string[] {
  if (value === undefined || value === null || value === '') return []
  let v: unknown = value
  if (typeof value === 'string' && !value.trim().startsWith('[')) v = value.split(',').map(s => s.trim()).filter(Boolean)
  else v = jsonConfig(name, value)
  if (!Array.isArray(v) || v.some(x => typeof x !== 'string')) throw new Error(`${name} must be a list of strings`)
  return v as string[]
}
