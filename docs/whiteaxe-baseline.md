# Phase 1 — Saxi baseline

Status: **Upstream automated tests passed; full build and runtime checks pending. GATE 1 not passed.**

Pinned upstream starting point: `f0810b10c3c52b2671457684dc5e52f8edd6cd1d` (Saxi 0.17.1). Official fork of alexrudd2/saxi, originating from nornagon/saxi. License AGPL-3.0-only; upstream license and source are unchanged.

## Verified source inventory

- Node >=22, npm package-lock.json, React 19, TypeScript, esbuild, Express, WebSocket, SerialPort and WebSerial; CLI and static web build retained.
- Import SVG via drag/drop or file selection, flatten paths, select layers by stroke color or SVG group ID.
- Standard/custom paper sizes, margins, fit/center or original coordinates, rotation, clipping, configurable pen home.
- Technical preview, stroke preview width, plot-order colorization, motion statistics and progress.
- Path sorting, joining, point deduplication, minimum path length; adjustable pen up/down heights, acceleration, speed, cornering and lift/drop timing.
- Hardware selection, connection, pen up/down, motor release, start/pause/resume/cancel. Preserve existing model support, including AxiDraw V3/Brushless, NextDraw 2234 and iDraw H SE where available.
- CLI plot and pen commands actually connect to hardware: never invoke them in automated baseline tests. Node server and browser WebSerial modes are distinct.

## Existing tests (executed in upstream CI)

| Suite | Cases | Scope |
| --- | ---: | --- |
| ebb.test.ts | 2 | Firmware version and motor enabling with mock serial |
| planning.test.ts | 5 active + 1 skipped | Motion planning, velocity and remaining duration |
| server.test.ts | 7 | Mock serial plot endpoints, malformed requests, cancellation, pause/resume, status |
| util.test.ts | 6 | Crop-to-margins, splitting, boundary paths |
| Total | 20 active + 1 skipped | 20 passed, 1 skipped on Ubuntu/Node 24 |

The skipped empty-input planner test is inherited. Record existing behavior instead of silently enabling or rewriting it.

## Existing CI

.github/workflows/lint.yml triggers on PRs and pushes to main; matrix includes Ubuntu/macOS with Node 22/24/26 and Windows with Node 26. It installs with --ignore-scripts and runs npm test. It does not explicitly run the production build or UI typecheck. publish.yml is manual deployment only; do not run it for baseline testing.

On 2026-11-25 both [run 45589852372](https://github.com/whitekross/whiteaxe/actions/runs/45589852372) and [run 45589942653](https://github.com/whitekross/whiteaxe/actions/runs/45589942653) completed successfully on commit 8a4695cf8429e571ae611f0c45ebe222be09724f. All seven jobs in the latter run succeeded; Ubuntu/Node 24 log explicitly shows 4 test files passed, 20 tests passed and 1 inherited skip. These runs did not build the application. The PR now extends lint.yml with build, UI typecheck and CLI help checks, plus workflow_dispatch; these additions await execution.

## Reproduce on a clean Ubuntu checkout (no hardware attached)

```sh
git clone https://github.com/whitekross/whiteaxe.git
cd whiteaxe
git switch --detach f0810b10c3c52b2671457684dc5e52f8edd6cd1d
node --version
npm --version
npm ci --no-audit --no-fund
npm test
npm run build
npx --no-install tsc --project tsconfig.ui.json --noEmit
IS_WEB=1 npm run build:ui
node cli.mjs --help
```

Run each command separately and retain exit codes and output. npm ci may already invoke prepare/build; record any failure. If dependency install or runtime compatibility fails, diagnose without upgrading upstream dependencies as part of the baseline. Node 26 is also present in upstream CI; record actual runtime version. Do not run a physical plot. Server integration tests use serial mocks; a manual browser startup check with hardware disconnected is separate from automated checks.

## Regression fixtures (not yet automated)

See [whiteaxe-fixtures](whiteaxe-fixtures/README.md). These are synthetic SVGs for future tests, not evidence of passing tests.

## Known risks and decisions

- Confirmed static risk: massager.ts calls cropToMargins before index-based layer filtering in non-fit mode. Cropping can split/remove paths (existing util tests demonstrate this), invalidating original indices. Reproduce with fixture before changing code; do not classify as a runtime-confirmed regression yet.
- The existing planner uses 96 SVG units/inch, rotates then scales or converts to mm, and converts mm to device steps. Verify SVG viewBox and physical units end to end.
- Baseline automated tests passed in CI; production build and disconnected application startup have not yet been verified. In the assistant environment Node v22.16.0 and npm 10.9.2 were available on Debian, but GitHub and npm registry DNS/network access failed, so dependencies/source could not be cloned and installed. This is an environment limitation, not a Saxi build failure.
- No driver, motion planner or package metadata changes. The CI workflow is extended only for baseline verification; deployment workflow unchanged.

## GATE 1 checklist

- [x] Official fork, pinned starting revision, attribution and license
- [x] Source feature inventory and existing test/CI inventory
- [x] Initial synthetic regression fixtures
- [ ] Successful dependency install and build on Ubuntu (or documented failures)
- [x] Actual upstream test execution (20 passed, 1 skipped on Ubuntu/Node 24)
- [ ] UI typecheck
- [x] Mock integration (included in successful upstream suite)
- [ ] Disconnected browser startup check
- [ ] User approval before Phase 2

Do not start Phase 2 or report the full baseline passing until build/runtime evidence and approval are available.
