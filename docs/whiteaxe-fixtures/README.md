# Whiteaxe SVG fixtures

Synthetic, original SVG examples for regression tests. Not yet executed. Coordinates are deliberately simple; fixtures should be parsed using the actual upstream parser in future tests.

- colors-groups.svg: separate and mixed stroke-color groups, an ungrouped path and a white stroke. Verify stable group and stroke selection and that white remains distinguishable.
- clip-layer-identity.svg: first red path leaves and re-enters the sheet, blue path follows, then a green path lies outside. Verify clipping splits/removes geometry without losing source layer identity. Use A4 portrait, original mode, clipping on, margin 10 mm, no rotation; disable sorting/joining when inspecting individual paths. SVG units are CSS px through equivalent viewport dimensions.
- physical-units.svg: 100 × 60 mm viewport and matching viewBox, nonzero viewBox origin and nested transform. Verify actual dimensions with the upstream parser before defining expected placement transforms.

No hardware execution required. These fixtures are not test results.
