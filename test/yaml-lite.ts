// A small YAML reader for the workflow files, so the static test needs no dependency.
// It reads only the style those files use: block maps, block lists, `|` scripts, plain or quoted scalars, `{}` and `[]`.
// Anything else (anchors, flow maps with content, tabs) throws, which fails the test loudly instead of misreading.
type Line = { indent: number; text: string }

export function parseYaml(source: string): any {
  if (source.includes('\t')) throw new Error('tabs are not allowed')
  const lines: Line[] = source.split('\n').map(raw => ({ indent: raw.length - raw.trimStart().length, text: raw.trimStart() }))
  let i = 0
  const raw = lines.map(l => ' '.repeat(l.indent) + l.text)
  const blank = () => { while (i < lines.length && (lines[i].text === '' || lines[i].text.startsWith('#'))) i++ }

  function scalar(v: string): any {
    v = v.replace(/\s+#.*$/, '').trim()
    if (v === '{}') return {}
    if (v === '[]') return []
    if (/^[[{]/.test(v)) throw new Error(`flow collection not supported: ${v}`)
    if (/^"[^"]*"$|^'[^']*'$/.test(v)) return v.slice(1, -1)
    if (v === 'true') return true
    if (v === 'false') return false
    if (/^-?\d+$/.test(v)) return Number(v)
    return v
  }

  function blockScalar(parent: number, header: string): string {
    const out: string[] = []
    let base = -1
    while (i < lines.length && (lines[i].text === '' || lines[i].indent > parent)) {
      if (lines[i].text !== '' && base < 0) base = lines[i].indent
      out.push(lines[i].text === '' ? '' : raw[i].slice(base))
      i++
    }
    while (out.length && out[out.length - 1] === '') out.pop()
    return out.join('\n') + (header.endsWith('-') ? '' : '\n')
  }

  function value(parent: number): any {
    blank()
    if (i >= lines.length || lines[i].indent <= parent) return null
    return lines[i].text.startsWith('- ') ? list(lines[i].indent) : map(lines[i].indent)
  }

  function list(indent: number): any[] {
    const out: any[] = []
    for (blank(); i < lines.length && lines[i].indent === indent && lines[i].text.startsWith('- '); blank()) {
      const rest = lines[i].text.slice(2)
      // Treat the text after "- " as a line of its own, two columns further in.
      lines[i] = { indent: indent + 2, text: rest }
      raw[i] = ' '.repeat(indent + 2) + rest
      if (/^("[^"]*"|'[^']*'|[^\s:'"][^:]*?):(\s|$)/.test(rest)) out.push(map(indent + 2))
      else { out.push(scalar(rest)); i++ }
    }
    return out
  }

  function map(indent: number): Record<string, any> {
    const out: Record<string, any> = {}
    for (blank(); i < lines.length && lines[i].indent === indent; blank()) {
      const m = lines[i].text.match(/^("[^"]*"|'[^']*'|[^\s:'"][^:]*?):(?:\s+(.*))?$/)
      if (!m) throw new Error(`cannot read line ${i + 1}: ${lines[i].text}`)
      const key = m[1].replace(/^["']|["']$/g, '')
      const rest = (m[2] ?? '').replace(/\s+#.*$/, '').trim()
      i++
      if (/^[|>][-+]?$/.test(rest)) out[key] = blockScalar(indent, rest)
      else if (rest === '' || rest.startsWith('#')) out[key] = value(indent)
      else out[key] = scalar(rest)
    }
    return out
  }

  blank()
  const result = lines[i].text.startsWith('- ') ? list(lines[i].indent) : map(lines[i].indent)
  blank()
  if (i < lines.length) throw new Error(`unread content at line ${i + 1}: ${lines[i].text}`)
  return result
}
