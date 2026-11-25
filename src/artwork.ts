import type { Path } from "flatten-svg";
import type { ManualPlacement, PlanOptions } from "./planning.js";
import { cropToMargins, scaleToPaper } from "./util.js";
import { type Vec2, vmul, vrot } from "./vec.js";

// CSS absolute lengths: 96 SVG px per inch, 25.4 mm per inch.
const mmPerSvgUnit = 25.4 / 96;

export interface PlacedPath extends Path {
  sourceIndex: number;
  fragmentIndex: number;
}

export function artworkBounds(points: Vec2[][]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const line of points) {
    for (const p of line) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

function sourceMm(paths: Path[], rotation: number): Vec2[][] {
  return paths.map((path) => path.points.map((p) => vrot(vmul(p, mmPerSvgUnit), { x: 0, y: 0 }, rotation)));
}

function validPlacement(p: ManualPlacement): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.scale) && p.scale > 0;
}

/** X/Y anchor the rotated artwork bounding box, not the SVG document origin. */
export function manualDimensions(paths: Path[], options: PlanOptions) {
  const bounds = artworkBounds(sourceMm(paths, options.rotateDrawing));
  const scale = options.manualPlacement?.scale ?? 1;
  if (!bounds || !Number.isFinite(scale) || scale <= 0) return null;
  return { x: (bounds.maxX - bounds.minX) * scale, y: (bounds.maxY - bounds.minY) * scale };
}

export function centerManual(paths: Path[], options: PlanOptions, axis: "x" | "y" | "both"): ManualPlacement {
  const current = options.manualPlacement ?? { x: 0, y: 0, scale: 1 };
  const size = manualDimensions(paths, options);
  if (!size) return current;
  return {
    ...current,
    x: axis === "y" ? current.x : (options.paperSize.size.x - size.x) / 2,
    y: axis === "x" ? current.y : (options.paperSize.size.y - size.y) / 2,
  };
}

/** Preserve the fitted artwork's position and scale when entering Manual. */
export function startManual(paths: Path[], options: PlanOptions): ManualPlacement {
  const source = artworkBounds(sourceMm(paths, options.rotateDrawing));
  const fitted = artworkBounds(placeArtwork(paths, { ...options, manualPlacement: undefined, layerMode: "all" }).map((p) => p.points));
  if (!source || !fitted) return { x: 0, y: 0, scale: 1 };
  const width = source.maxX - source.minX;
  const height = source.maxY - source.minY;
  const scale = options.fitPage
    ? width > 0 ? (fitted.maxX - fitted.minX) / width : height > 0 ? (fitted.maxY - fitted.minY) / height : 1
    : 1;
  return { x: fitted.minX, y: fitted.minY, scale: Number.isFinite(scale) && scale > 0 ? scale : 1 };
}

function inside(p: Vec2, area: Vec2): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.y >= 0 && p.x <= area.x && p.y <= area.y;
}

function validArea(area: Vec2 | undefined): area is Vec2 {
  return !!area && Number.isFinite(area.x) && Number.isFinite(area.y) && area.x > 0 && area.y > 0;
}

export function manualPlacementError(paths: Path[], options: PlanOptions): string | null {
  if (!options.manualPlacement) return null;
  if (!validPlacement(options.manualPlacement)) return "Enter finite X/Y and a positive scale.";
  if (!validArea(options.paperSize.size)) return "Invalid paper dimensions.";
  const all = placeArtwork(paths, { ...options, layerMode: "all" });
  const bounds = artworkBounds(all.map((p) => p.points));
  if (!bounds) return "No valid artwork geometry.";
  const min = { x: bounds.minX, y: bounds.minY };
  const max = { x: bounds.maxX, y: bounds.maxY };
  if (!inside(min, options.paperSize.size) || !inside(max, options.paperSize.size)) return "Artwork is outside the paper. Nothing will be clipped.";
  const travel = options.machineTravel;
  if (!validArea(travel)) return "Confirm machine travel X/Y (mm) before plotting.";
  if (!inside(min, travel) || !inside(max, travel) || !inside(options.penHome, travel)) return "Artwork or pen home is outside machine travel.";
  return null;
}

/** Shared paper-space geometry, in mm, before path optimization. */
export function placeArtwork(inPaths: Path[], options: PlanOptions): PlacedPath[] {
  if (inPaths.length === 0) return [];
  let points = inPaths.map((path) => path.points);
  if (options.manualPlacement) {
    const p = options.manualPlacement;
    const source = sourceMm(inPaths, options.rotateDrawing);
    const bounds = artworkBounds(source);
    if (!bounds || !validPlacement(p)) return [];
    points = source.map((line) => line.map((point) => ({
      x: p.x + (point.x - bounds.minX) * p.scale,
      y: p.y + (point.y - bounds.minY) * p.scale,
    })));
  } else if (options.rotateDrawing !== 0) {
    const center = vmul({ x: options.paperSize.size.x / 2, y: options.paperSize.size.y / 2 }, 1 / mmPerSvgUnit);
    points = points.map((path) => path.map((point) => vrot(point, center, options.rotateDrawing)));
  }

  // Fit the complete artwork, not only the selected layers.
  if (!options.manualPlacement) {
    points = options.fitPage
      ? scaleToPaper(points, options.paperSize, options.marginMm)
      : points.map((path) => path.map((point) => vmul(point, mmPerSvgUnit)));
  }

  return inPaths.flatMap((path, sourceIndex) => {
    if (options.layerMode === "group" && !options.selectedGroupLayers.has(path.groupId)) return [];
    if (options.layerMode === "stroke" && !options.selectedStrokeLayers.has(path.stroke)) return [];
    // Clip each source path separately so splits and removals never shift layer identity.
    const fragments =
      !options.manualPlacement && !options.fitPage && options.cropToMargins
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
