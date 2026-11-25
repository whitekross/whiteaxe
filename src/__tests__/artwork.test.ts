import type { Path } from "flatten-svg";
import { describe, expect, it } from "vitest";
import { layerStrokes, placeArtwork, previewInk } from "../artwork.js";
import { replan } from "../massager.js";
import { PaperSize } from "../paper-size.js";
import { defaultPlanOptions, type PlanOptions } from "../planning.js";

const makePath = (stroke: string, groupId: string, coordinates: [number, number][]): Path => ({
  stroke,
  groupId,
  points: coordinates.map(([x, y]) => ({ x, y })),
});
const options: PlanOptions = {
  ...defaultPlanOptions,
  paperSize: new PaperSize({ x: 100, y: 100 }),
  marginMm: 5,
  fitPage: false,
  cropToMargins: true,
  layerMode: "all",
  sortPaths: false,
  pathJoinRadius: 0,
};
const red = makePath("#ff0000", "mixed", [[50, 50], [500, 60], [50, 100]]);
const blue = makePath("#0000ff", "mixed", [[80, 160], [180, 160]]);
const white = makePath("#ffffff", "other", [[80, 200], [180, 200]]);
const outside = makePath("#00ff00", "outside", [[500, 500], [600, 600]]);

describe("artwork paper geometry", () => {
  it("retains source identity when clipping splits and removes paths", () => {
    const result = placeArtwork([red, blue, outside, white], options);
    expect(result.map((p) => [p.sourceIndex, p.fragmentIndex, p.stroke])).toEqual([
      [0, 0, red.stroke],
      [0, 1, red.stroke],
      [1, 0, blue.stroke],
      [3, 0, white.stroke],
    ]);
  });

  it("selects the correct stroke after clipping and uses it in the actual plan", () => {
    const selected: PlanOptions = { ...options, layerMode: "stroke", selectedStrokeLayers: new Set([blue.stroke]) };
    expect(placeArtwork([red, blue, outside, white], selected).map((p) => p.stroke)).toEqual([blue.stroke]);
    expect(replan([red, blue, outside, white], selected).toTransferable()).toEqual(
      replan([blue], { ...options, layerMode: "all" }).toTransferable(),
    );
  });

  it("keeps the same fit coordinates when a layer is hidden", () => {
    const paths = [red, blue, white];
    const all = placeArtwork(paths, { ...options, fitPage: true });
    const selected = placeArtwork(paths, {
      ...options,
      fitPage: true,
      layerMode: "stroke",
      selectedStrokeLayers: new Set([white.stroke]),
    });
    expect(selected).toEqual(all.filter((p) => p.stroke === white.stroke));
  });

  it("retains both colors for a selected group and excludes other groups", () => {
    const selected = placeArtwork([red, blue, white], {
      ...options,
      layerMode: "group",
      selectedGroupLayers: new Set(["mixed"]),
    });
    expect([...new Set(selected.map((p) => p.stroke))]).toEqual([red.stroke, blue.stroke]);
    expect(layerStrokes([red, blue, white, red], "group", "mixed")).toEqual([red.stroke, blue.stroke]);
  });

  it("converts original CSS pixels into millimetres", () => {
    const source = makePath("black", "", [[0, 0], [96, 96]]);
    const [path] = placeArtwork([source], { ...options, cropToMargins: false });
    expect(path.points[1].x).toBeCloseTo(25.4);
    expect(path.points[1].y).toBeCloseTo(25.4);
  });

  it("handles empty artwork and layer selection", () => {
    expect(placeArtwork([], options)).toEqual([]);
    expect(placeArtwork([red], { ...options, layerMode: "stroke", selectedStrokeLayers: new Set() })).toEqual([]);
  });
});

describe("preview ink", () => {
  const supports = (value: string) => ["#ffffff", "red", "rgb(1, 2, 3)"].includes(value);
  it("preserves white and supported CSS colors", () => {
    expect(previewInk("#ffffff", supports)).toBe("#ffffff");
    expect(previewInk(" red ", supports)).toBe("red");
    expect(previewInk("rgb(1, 2, 3)", supports)).toBe("rgb(1, 2, 3)");
  });
  it("returns an unknown paint for missing or unsupported strokes", () => {
    for (const value of [undefined, "", "none", "currentColor", "url(#gradient)", "var(--ink)", "nonsense"]) {
      expect(previewInk(value, supports)).toBeNull();
    }
  });
});
