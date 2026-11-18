// Baseline sandbox check: proves run-checks.mjs runs. A throwaway card adds its own *.check.mjs next to its work.
import assert from 'node:assert/strict'
assert.equal(1 + 1, 2)
