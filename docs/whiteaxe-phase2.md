# Phase 2 — artwork colors and layer indicators

Implemented on the feature branch; CI and browser review pending.

- Artwork is the default preview; the original Plot motion view remains selectable next to the layers. During plotting the technical view is shown automatically.
- The Artwork view draws source strokes on paper-space geometry before sorting, deduplication, short-path removal and path joining. It is not an exact simulation of ink deposition or a replacement for the motion preview.
- Both planner and Artwork preview use placeArtwork, including rotation, fit/original units and margin clipping. Fit always considers all paths. Clipping is performed per source path so layer identity survives fragments and removals; this fixes the inherited index-based filtering defect.
- Layer checkboxes preserve stroke/group modes, offer all/none controls, and show up to four distinct colors plus a count for mixed groups. Unknown paint uses neutral gray; white swatches have a visible border. The actual plotted geometry is not dropped based on unsupported paint.
- New regression tests cover clipping identity, the actual planner, selection without recentering, group colors, units, empty selection and color fallback.

No transport, motion algorithm, package dependencies or upstream license changes. Manual positioning is deferred to Phase 3. Browser and hardware verification are not claimed.
