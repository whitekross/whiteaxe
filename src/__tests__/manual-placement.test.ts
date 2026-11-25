import type { Path } from "flatten-svg";
import { describe, expect, it } from "vitest";
import { centerManual, manualDimensions, manualPlacementError, placeArtwork, startManual } from "../artwork.js";
import { replan } from "../massager.js";
import { PaperSize } from "../paper-size.js";
import { defaultPlanOptions, Device, type PlanOptions, XYMotion } from "../planning.js";

const paths: Path[] = [
  { stroke: "red", groupId: "a", points: [{ x: 96, y: 96 }, { x: 192, y: 96 }] },
  { stroke: "blue", groupId: "b", points: [{ x: 96, y: 192 }, { x: 192, y: 192 }] },
];
const options: PlanOptions = {
  ...defaultPlanOptions,
  paperSize: new PaperSize({ x: 210, y: 297 }),
  machineTravel: { x: 220, y: 310 },
  manualPlacement: { x: 20, y: 30, scale: 2 },
  layerMode: "all",
  sortPaths: false,
  pathJoinRadius: 0,
};

describe("manual placement", () => {
  it("anchors the source bounds in millimetres and scales from original physical size", () => {
    const placed = placeArtwork(paths, options);
    expect(placed[0].points[0]).toEqual({ x: 20, y: 30 });
    expect(placed[0].points[1].x).toBeCloseTo(70.8);
    expect(placed[1].points[0].y).toBeCloseTo(80.8);
  });
  it("preserves layer coordinates and full artwork dimensions", () => {
    const selected = placeArtwork(paths, { ...options, layerMode: "group", selectedGroupLayers: new Set(["b"]) });
    expect(selected).toEqual(placeArtwork(paths, options).slice(1));
    expect(manualDimensions(paths, options)?.x).toBeCloseTo(50.8);
  });
  it("centers independently on each axis", () => {
    const centered = centerManual(paths, options, "x");
    expect(centered.x).toBeCloseTo(79.6);
    expect(centered.y).toBe(30);
    expect(centerManual(paths, options, "both").y).toBeCloseTo(123.1);
  });
  it("preserves fitted coordinates on entry to Manual", () => {
    const fit = { ...options, manualPlacement: undefined, fitPage: true };
    const before = placeArtwork(paths, fit);
    const after = placeArtwork(paths, { ...fit, manualPlacement: startManual(paths, fit) });
    for (let i = 0; i < before.length; i++) {
      for (let j = 0; j < before[i].points.length; j++) {
        expect(after[i].points[j].x).toBeCloseTo(before[i].points[j].x);
        expect(after[i].points[j].y).toBeCloseTo(before[i].points[j].y);
      }
    }
  });
  it("handles rotation with the same top-left anchor", () => {
    const p = placeArtwork(paths, { ...options, rotateDrawing: 90 });
    expect(Math.min(...p.flatMap((line) => line.points.map((point) => point.x)))).toBeCloseTo(20);
    expect(Math.min(...p.flatMap((line) => line.points.map((point) => point.y)))).toBeCloseTo(30);
  });
  it("does not clip manual geometry and rejects off-paper plans", () => {
    const bad = { ...options, manualPlacement: { x: -5, y: 30, scale: 2 } };
    expect(placeArtwork(paths, bad)[0].points[0].x).toBe(-5);
    expect(manualPlacementError(paths, bad)).toContain("outside the paper");
    expect(() => replan(paths, bad)).toThrow("outside the paper");
  });
  it("requires confirmed travel and checks the artwork and home", () => {
    expect(manualPlacementError(paths, { ...options, machineTravel: undefined })).toContain("Confirm");
    expect(manualPlacementError(paths, { ...options, machineTravel: { x: 50, y: 50 } })).toContain("machine travel");
    expect(manualPlacementError(paths, { ...options, penHome: { x: 500, y: 0 } })).toContain("machine travel");
    expect(manualPlacementError(paths, options)).toBeNull();
  });
  it("rejects invalid scale and non-finite offsets", () => {
    for (const placement of [{ x: 0, y: 0, scale: 0 }, { x: Infinity, y: 0, scale: 1 }, { x: 0, y: 0, scale: NaN }]) {
      expect(() => replan(paths, { ...options, manualPlacement: placement })).toThrow();
    }
  });
  it("feeds the exact placed path endpoints into the real motion plan", () => {
    const plan = replan(paths, options);
    const xy = plan.motions.filter((m): m is XYMotion => m instanceof XYMotion);
    const steps = Device(options.hardware).stepsPerMm;
    const placed = placeArtwork(paths, options);
    expect(xy[1].p1.x / steps).toBeCloseTo(placed[0].points[0].x);
    expect(xy[1].p2.x / steps).toBeCloseTo(placed[0].points[1].x);
    expect(xy[3].p1.y / steps).toBeCloseTo(placed[1].points[0].y);
  });
});
