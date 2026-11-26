# Whiteaxe — agent instructions

## Mission and scope

Whiteaxe is an incremental extension of Saxi for AxiDraw. Preserve existing working behavior, especially serial communication, motion planning, pause/resume, pen controls, optimization, and original layer selection. Verify the actual upstream feature inventory in Phase 1 rather than assuming undocumented features.

- Node.js >=22 + TypeScript; preserve upstream React/build tooling. No Python, Inkscape, or cloud dependency for normal operation.
- Ubuntu first; macOS second. Prefer minimal dependencies and reuse upstream utilities.
- Local-first, offline operation; no telemetry or accounts. Preserve upstream Node serial, WebSerial and CLI modes. Do not publish to the upstream npm package or deploy to upstream infrastructure.
- Preserve upstream history, AGPL-3.0-only license, attribution and notices. Never overwrite upstream files wholesale without justification.

## Workflow

1. Read README.md, ROADMAP.md, ARCHITECTURE.md and docs/whiteaxe-architecture.md before starting.
2. Work on one phase at a time, using a feature branch and a reviewable PR; do not merge or begin the next phase until the user approves the phase GATE.
3. Inspect the actual implementation before changing it; update docs if assumptions are wrong.
4. Add focused regression tests with every behavior change. Run upstream test/build/typecheck commands discovered from package.json and CI; report exact outcomes and failures. Never claim hardware tests without physical evidence.
5. Keep commits small; no unrelated refactors, dependency upgrades or driver rewrites.
6. At each GATE report changed files, feature demos, test evidence, known issues, and the next proposed step. Stop for approval.

## Non-negotiable invariants

- Preview and actual motion plan use the same geometry transform and coordinate convention.
- Layer filtering must never recenter or rescale an artwork. Preserve stable layer identity and path provenance through clipping/optimization where necessary.
- Plot only validated coordinates within the configured machine travel area; never silently clip in manual mode. Reject non-finite/invalid transforms. Lock placement and relevant settings during an active job.
- Keep original fit/original placement modes available and regression-tested.
- Never send commands to physical hardware during automated tests; use mocks/dry runs. Real plotting requires explicit operator action.
- Keep technical motion preview distinct from artwork preview. Do not imply fill regions or simulated stroke widths will be physically plotted if unsupported.
- Do not implement optional features before core acceptance criteria are met.

## Current gate

Phases 0–4 approved and merged (44 tests, 19 browser checks). Phase 5 release preparation and hardware validation are in progress. Do not claim release readiness or merge the candidate before operator approval.
