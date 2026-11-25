# Phase 1 — Saxi baseline

Status: **Upstream tests and production build passed on all seven CI combinations. Strict UI typecheck exposes inherited errors; CLI help and WebSerial build passed; disconnected browser startup and GATE 1 approval pending.**

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

.github/workflows/lint.yml triggers on PRs and pushes to main; matrix includes Ubuntu/macOS with Node 22/24/26 and Windows with Node 26. It installs with --ignore-scripts and runs npm test. The original workflow did not explicitly run the production build or UI typecheck. publish.yml is manual deployment only; do not run it for baseline testing.

On 2026-11-25 both [run 45589852372](https://github.com/whitekross/whiteaxe/actions/runs/45589852372) and [run 45589942653](https://github.com/whitekross/whiteaxe/actions/runs/45589942653) completed successfully on commit 8a4695cf8429e571ae611f0c45ebe222be09724f. All seven jobs in the latter run succeeded; Ubuntu/Node 24 log explicitly shows 4 test files passed, 20 tests passed and 1 inherited skip. These runs did not build the application. The PR extends lint.yml with build, UI typecheck and CLI help checks, plus workflow_dispatch.

[Extended CI run 45594157279](https://github.com/whitekross/whiteaxe/actions/runs/45594157279) on d1390abc5ee3e35c3ac4458fdc89a63be56f2d30: all seven jobs passed npm test and npm run build, then failed the additional strict UI typecheck. CLI help was skipped. The source is identical to the pinned upstream, so these errors are inherited, not Whiteaxe regressions. Ubuntu/Node 24 log shows 10 diagnostics: TS1203 in color-interpolate declaration; TS2882 for CSS import; TS18046 for unknown catch variable; TS2345 for nullable ref and SVG elements (3 occurrences); TS2322 for nullable driver (3 occurrences); TS18047 for nullable file input.

Decision: keep strict UI typecheck visible as an advisory CI step during baseline, rather than altering upstream application code. It must become blocking once inherited diagnostics are resolved in a separate scoped change. CLI help and WebSerial build run independently before it. [Run 45594577313](https://github.com/whitekross/whiteaxe/actions/runs/45594577313) on 7106960b891d373ec3210160ae002a2dc57f5f4c passed the build, test, CLI help and WebSerial build steps across all seven jobs. The Ubuntu/Node 24 log still reports the same 10 inherited type diagnostics; the green overall status reflects the advisory policy, not a clean typecheck.

CI policy for Whiteaxe: routine PR and main push checks use only Ubuntu with Node 24.x. The original seven-job compatibility matrix is available through manual workflow_dispatch with full_matrix enabled. Superseded runs for the same event/ref are cancelled. All existing test/build/smoke checks are retained. The lean workflow itself awaits its first run.

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
- Baseline automated tests and production build passed in CI; disconnected application startup has not yet been verified. In the assistant environment Node v22.16.0 and npm 10.9.2 were available on Debian, but GitHub and npm registry DNS/network access failed, so dependencies/source could not be cloned and installed. This is an environment limitation, not a Saxi build failure.
- No driver, motion planner or package metadata changes. The CI workflow is extended only for baseline verification; deployment workflow unchanged.

## GATE 1 checklist

- [x] Official fork, pinned starting revision, attribution and license
- [x] Source feature inventory and existing test/CI inventory
- [x] Initial synthetic regression fixtures
- [x] Dependency installation with upstream CI flags and production build on Ubuntu, macOS and Windows
- [x] Actual upstream test execution (20 passed, 1 skipped on Ubuntu/Node 24)
- [x] UI typecheck executed; 10 inherited diagnostics documented, not resolved
- [x] CLI help and WebSerial build verification (all seven combinations)
- [x] Mock integration (included in successful upstream suite)
- [ ] Disconnected browser startup check
- [ ] User approval before Phase 2

Do not start Phase 2 until disconnected browser startup and user approval are available. Acknowledge inherited typecheck debt explicitly at GATE 1; do not report strict typecheck passing.
