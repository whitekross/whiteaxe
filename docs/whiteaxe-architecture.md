# Whiteaxe architecture

Proposed design, not yet implemented. The upstream architecture is preserved in [ARCHITECTURE.md](../ARCHITECTURE.md). Source references below remain proposals to verify against the pinned starting revision.

## Upstream

Verified stack: Node.js >=22/TypeScript, React UI, Express/WebSocket backend, SerialPort/EBB driver, SVG flattening and path optimization. Preserve upstream dependencies and npm lockfile initially. Preserve both Node serial and browser WebSerial implementations, as well as the standalone CLI.

Likely touchpoints: ui.tsx (preview and LayerSelector), massager.ts and util.ts (geometry transforms); planning.ts (motion planner), server.ts, drivers.ts and ebb.ts (transport/USB). Confirm paths, functions and contracts on import.

## Data flow

SVG -> upstream parser/flattening -> canonical artwork paths with stable source/layer metadata -> shared placement transform -> selected geometry -> upstream path optimization/motion planner -> existing server and USB driver.

Artwork preview consumes the same transformed geometry before motion optimization. Technical Plot preview consumes the motion plan as in upstream. Both share paper dimensions, orientation, coordinate conversion and selected layers. The Artwork view is a stroke preview, not a promise of exact ink coverage.

## Proposed models

Names are illustrative, not mandatory APIs:

- ArtworkPath: stable id, source/layer id, points, resolved stroke metadata.
- Placement: mode (fit/original/manual), position in mm, positive scale; coordinate anchor defined in Phase 1.
- Sheet: physical paper dimensions and orientation; separate machine travel envelope.
- PlotSnapshot: immutable geometry, selected layers, placement and relevant machine settings at planning time.

Maintain stable source path identity through any splitting/clipping, or apply selection before operations that change path count, while calculating placement bounds from the entire artwork. Test the suspected upstream issue where clipping can change path indices before layer filtering; do not assume it is a confirmed bug.

## Placement

Fit and Original retain upstream semantics. Manual applies an explicit user transform. Define how SVG document units/viewBox and source bounds map to mm; avoid assumptions that all SVG units are pixels. Center buttons operate on full transformed artwork bounds. Drag converts viewport coordinates to physical mm using the inverse viewport transform; zoom/pan only affects display. Recalculate motion plan on placement commit, mark stale plans, prevent plotting stale or invalid snapshots.

Physical plotting must validate actual configured machine travel bounds (not merely paper bounds). Warn separately for art outside the paper; do not permit out-of-machine travel. Preserve original clipping semantics for original modes unless changed in a dedicated approved regression fix.

## Layers and color

Preserve upstream grouping, selection and plotting logic. Resolve stroke colors using parser metadata; use a neutral/unknown indicator for unresolved values and multiple swatches for mixed-color layers. Preserve white strokes and use a distinct indicator border. Do not add unsupported fill plotting.

Artwork view and Plot view have independent rendering concerns; simulated pen width or sheet color are display-only. Optimization may reorder/reverse paths; do not infer layer identity from optimized indices.

## Tests

Unit: coordinate conversion, transforms, centering, bounds, stable layer filtering, color normalization.
Integration: same transformed points used for artwork and planner; stale plan prevention, original mode regression, selected layer tests, malformed SVG behavior.
UI: manual drag, numeric fields, color swatches, view switching and original controls.
Hardware: separately operator-confirmed; never send serial commands in automated tests.

## Out of scope

New motion planner, new USB driver, SVG editor, cloud service, Python runtime, mandatory external tools.
