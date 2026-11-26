# Whiteaxe roadmap

Status: Phases 0–4 approved and merged. Phase 5 release candidate preparation and physical validation in progress.

## Phase 0 — Feasibility and scope

- [x] Select Saxi as upstream instead of a new driver.
- [x] Define Node.js/TypeScript-only runtime and core user requirements.
- [x] Outline architectural risks and regression strategy.

GATE 0: user approves direction (repository created). No implementation in this phase.

## Phase 1 — Upstream baseline

- [x] Create an official fork of alexrudd2/saxi, preserving commit history and license notices. Record the starting revision in README.md.
- Keep upstream as a remote; document how future upstream updates are integrated.
- Inventory current plotting/UI features and package scripts; minimum Node version >=22 verified in package.json; use npm and the upstream package-lock.json. Verify CI runtime separately.
- Install, build, run tests and type checks on Ubuntu; document existing failures separately. Verify startup and mock/dry-run workflow without hardware.
- Establish feature-branch/PR process and representative SVG regression fixtures (multiple colors, grouped and ungrouped paths, transforms, clipping, units, white strokes).

GATE 1: reproducible baseline and feature inventory; no functional changes, no regressions introduced.

## Phase 2 — Color artwork preview and layer indicators

- Retain source stroke colors and path/layer provenance; distinguish missing, none and unsupported colors.
- Add Artwork preview alongside the original technical Plot preview.
- Show a color swatch per layer; use a multi-color indicator when necessary. Preserve layer selection and existing grouping semantics.
- Use canonical transformed geometry for preview; do not display unsupported fills as plottable strokes.
- Test color mapping, layer visibility, grouped/mixed-color files, white strokes and alignment when toggling layers.

GATE 2: approved and merged. CI run 45598286011: 28 tests and eight Chrome checks passed; original Plot view preserved.

## Phase 3 — Manual placement

- Preserve existing Fit and Original modes; add Manual with drag-and-drop, X/Y in mm, scale, horizontal/vertical/both centering.
- Establish exact coordinate origin, orientation, physical paper and machine bounds from upstream.
- Use shared transforms for preview and planning. Placement remains stable while toggling layers.
- Zoom/pan does not alter physical placement. Avoid replanning on every drag event; recompute on commit and disable Plot while stale.
- Validate finite values and full machine bounds. Show out-of-bounds warning; do not silently clip manual placement.
- Test unit conversion, SVG origins, centering, scaling, clipping provenance and preview/plan equivalence.

GATE 3: approved and merged; 37 automated tests and 14 browser checks passed (run 45666865071).

## Phase 3B — Whiteaxe Studio UI

- Modern neutral desktop workspace, canvas left and inspector right, accessible controls and collapsible settings.
- Header SVG opening and connection status, light/dark themes, paper rulers, zoom/pan and selection outline.
- Preserve all prior functionality and verify with existing and expanded real browser tests.

GATE 3B: approved and merged. 37 tests and 18 Chrome checks passed (run 45693782623).

## Phase 4 — Optional multicolor workflow

Approved increment: reorder selected stroke colors, guided pen changes, explicit per-layer confirmation and dry-run sequence. Per-layer simulated width/ink color, sheet color and session persistence remain deferred. Preserve explicit control over physical pen changes; no automatic motion without operator initiation.

GATE 4: approved and merged. CI run 45696276956: 44 automated tests and 19 browser checks passed.

## Phase 5 — Hardware and release validation

- Make UI typecheck blocking; fix malformed import handling and prepare physical calibration fixtures. See [Ubuntu installation and calibration guide](docs/whiteaxe-installation.md).

- On Ubuntu with the actual AxiDraw: connection, pen-up/down, small safe test plot, alignment across colors, manual offsets and boundaries, pause/resume and cancellation behavior.
- Check macOS compatibility separately if hardware/platform available.
- Compare baseline behavior and verify original features; document calibration and known limits.
- Provide local install and run instructions, license and attribution.

GATE 5: operator confirms real-world plotting accuracy and release readiness.

## Deferred ideas

Multiple copies on one sheet, rulers, richer job persistence, advanced pen profiles. Not part of the core requirements.
