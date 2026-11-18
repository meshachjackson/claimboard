// CSV reading and typing, shared by scripts/board-from-csv.mjs (the hosted-table converter) and the board's CSV import.
// One copy of the rules, so the script and the import never disagree. No dependencies.

/** Reads CSV text into rows of cells: quoted commas, doubled quotes, line breaks inside quotes, CRLF and a leading BOM. */
export function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += c
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows.filter(r => r.length > 1 || r[0] !== '') // skip blank lines
}

/** Writes rows of cells as CSV text: a cell with a comma, quote or line break is quoted, quotes are doubled, lines end in CRLF. */
export function toCsv(rows: string[][]): string {
  const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  return rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n'
}

/**
 * One cell as the schema's type. Empty numbers and dates become null, an empty boolean false, an empty string stays "".
 * Throws an Error whose message is the reason when the cell does not fit the type.
 */
export function coerce(value: string, type: string): string | number | boolean | null {
  if (type === 'number') {
    if (value === '') return null
    if (!/^-?\d+(\.\d+)?$/.test(value)) throw new Error('not a number')
    return Number(value)
  }
  if (type === 'boolean') {
    if (value === '') return false
    if (value !== 'true' && value !== 'false') throw new Error('not true or false')
    return value === 'true'
  }
  if (type === 'date') return value === '' ? null : value
  return value
}
