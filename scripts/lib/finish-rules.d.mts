// Types for finish-rules.mjs, so app/utils/dispatch.ts (TypeScript) can import it.
export declare const MAX_NUDGES: number
export declare const MAX_TRANSIENT: number
export declare const BLOCK_KINDS: readonly ['needs_input', 'dependency', 'transient', 'capability']
export type BlockKind = typeof BLOCK_KINDS[number]
/** What a turn's reply said about how it ended. `body` is the reply without the finishing line. */
export type End =
  | { kind: 'complete' | 'review', summary: string, body: string }
  | { kind: 'block', block: BlockKind, reason: string, body: string }
  | { kind: 'none', body: string }
export declare function parseEnd(reply: string): End
export declare const FINISH_RULES: string[]
export declare function nudgeText(n: number): string
export declare function isTransient(text: string): boolean
