# sandbox/

The runner's sandbox (go-live Part F of the runner plan). `gov_config` `board.runner` sets `allowed_paths` to `sandbox/`
only, so a runner job may change files here and nowhere else in this repo. Throwaway cards build here. Nothing in the app,
the server or the tests reads this folder.

- `run-checks.mjs` is the runner's `test_cmd` (`node sandbox/run-checks.mjs`). It runs every `sandbox/**/*.check.mjs` and
  fails if any of them throws or exits non-zero.
- `hello.check.mjs` is the baseline check, so the command passes on an empty sandbox.

Safe to clean out at any time: delete everything here except these three files.
