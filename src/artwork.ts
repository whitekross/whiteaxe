import type { Path } from "flatten-svg";
import type { PlanOptions } from "./planning.js";
import { cropToMargins, scaleToPaper } from "./util.js";
import { vmul, vrot } from "./vec.js";

// CSS absolute lengths: 96 SVG px per inch, 25.4 mm per inch.
const mmPerSvgUnit = 25.4 / 96;

export interface PlacedPath extends Path {
  sourceIndex: number;
  fragmentIndex: number;
}

/** Shared paper-space geometry, in mm, before path optimization. */
export function placeArtwork(inPaths: Path[], options: PlanOptions): PlacedPath[] {
  if (inPaths.length === 0) return [];
  let points = inPaths.map((path) => path.points);
  if (options.rotateDrawing !== 0) {
    const center = vmul({ x: options.paperSize.size.x / 2, y: options.paperSize.size.y / 2 }, 1 / mmPerSvgUnit);
    points = points.map((path) => path.map((point) => vrot(point, center, options.rotateDrawing)));
  }

  // Fit the complete artwork, not only the selected layers.
  points = options.fitPage
    ? scaleToPaper(points, options.paperSize, options.marginMm)
    : points.map((path) => path.map((point) => vmul(point, mmPerSvgUnit)));

  return inPaths.flatMap((path, sourceIndex) => {
    if (options.layerMode === "group" && !options.selectedGroupLayers.has(path.groupId)) return [];
    if (options.layerMode === "stroke" && !options.selectedStrokeLayers.has(path.stroke)) return [];
    // Clip each source path separately so splits and removals never shift layer identity.
    const fragments =
      !options.fitPage && options.cropToMargins
        ? cropToMargins([points[sourceIndex]], options.paperSize, options.marginMm)
        : [points[sourceIndex]];
    return fragments.map((fragment, fragmentIndex) => ({ ...path, points: fragment, sourceIndex, fragmentIndex }));
  });
}

/** Distinct source strokes for a layer, including mixed-color groups. */
export function layerStrokes(paths: Path[], mode: PlanOptions["layerMode"], layer: string): string[] {
  return [...new Set(paths.filter((p) => (mode === "group" ? p.groupId : p.stroke) === layer).map((p) => p.stroke))];
}

/** Unsupported paints are represented as neutral ink, not silently omitted from the physical plot. */
export function previewInk(stroke: string | undefined, supportsColor: (value: string) => boolean): string | null {
  const value = stroke?.trim();
  if (!value || /^(none|transparent|currentcolor|inherit|initial|unset|revert(?:-layer)?)$/i.test(value)) return null;
  if (/^(url|var)\s*\(/i.test(value)) return null;
  return supportsColor(value) ? value : null;
}
