import type { Path } from "flatten-svg";
import { describe, expect, it } from "vitest";
import { placeArtwork } from "../artwork.js";
import { advanceInkJob, availableInks, createInkJob, inkSelection, moveInk } from "../ink-workflow.js";
import { PaperSize } from "../paper-size.js";
import { defaultPlanOptions, type PlanOptions } from "../planning.js";

const paths: Path[] = [
  { stroke: "red", groupId: "mixed", points: [{ x: 10, y: 10 }, { x: 50, y: 20 }] },
  { stroke: "blue", groupId: "mixed", points: [{ x: 60, y: 40 }, { x: 90, y: 60 }] },
  { stroke: "white", groupId: "other", points: [{ x: 20, y: 70 }, { x: 30, y: 80 }] },
];
const options: PlanOptions = {
  ...defaultPlanOptions,
  layerMode: "stroke",
  selectedStrokeLayers: new Set(["red", "blue"]),
  paperSize: new PaperSize({ x: 100, y: 100 }),
  marginMm: 5,
};
describe("guided ink sequence", () => {
  it("uses selected source strokes, never mixed group names", () => {
    expect(availableInks(paths, options)).toEqual(["blue", "red"]);
    expect(availableInks(paths, { ...options, layerMode: "group" })).toEqual([]);
  });
  it("reorders without mutating the original", () => {
    const inks = ["blue", "red"];
    expect(moveInk(inks, 0, 1)).toEqual(["red", "blue"]);
    expect(inks).toEqual(["blue", "red"]);
    expect(moveInk(inks, 0, -1)).toBe(inks);
  });
  it("rejects duplicate and unselected ink sequences", () => {
    expect(() => createInkJob(paths, options, ["red", "red"], "dry-run")).toThrow();
    expect(() => createInkJob(paths, options, ["red", "white"], "dry-run")).toThrow();
  });
  it("requires manual placement and travel for live mode", () => {
    expect(() => createInkJob(paths, options, ["red", "blue"], "live")).toThrow();
    expect(() => createInkJob(paths, { ...options, manualPlacement: { x: 1, y: 1, scale: 1 }, machineTravel: { x: 100, y: 100 } }, ["red", "blue"], "live")).not.toThrow();
  });
  it("dry run never enters a physical running state", () => {
    const job = createInkJob(paths, options, ["red", "blue"], "dry-run");
    expect(advanceInkJob(job, "start")).toBe(job);
    expect(advanceInkJob(job, "confirm")).toBe(job);
    const review = advanceInkJob(job, "simulate");
    expect(review.stage).toBe("review");
    const next = advanceInkJob(review, "confirm");
    expect(next.stage).toBe("ready");
    expect(next.index).toBe(1);
    expect(advanceInkJob(advanceInkJob(next, "simulate"), "confirm").stage).toBe("complete");
  });
  it("requires separate live start and completion; interruption never advances", () => {
    const job = createInkJob(paths, { ...options, manualPlacement: { x: 1, y: 1, scale: 1 }, machineTravel: { x: 100, y: 100 } }, ["red", "blue"], "live");
    expect(advanceInkJob(job, "simulate")).toBe(job);
    const running = advanceInkJob(job, "start");
    expect(advanceInkJob(running, "confirm")).toBe(running);
    const review = advanceInkJob(running, "finished");
    expect(advanceInkJob(review, "confirm").stage).toBe("ready");
    const interrupted = advanceInkJob(running, "interrupt");
    expect(advanceInkJob(interrupted, "finished")).toBe(interrupted);
    expect(advanceInkJob(interrupted, "confirm")).toBe(interrupted);
  });
  it("keeps full-artwork placement and restores original selection", () => {
    const job = createInkJob(paths, options, ["red", "blue"], "dry-run");
    const before = placeArtwork(paths, options);
    const first = placeArtwork(paths, { ...options, selectedStrokeLayers: inkSelection(job) });
    expect(first).toEqual(before.filter((p) => p.stroke === "red"));
    const next = advanceInkJob(advanceInkJob(job, "simulate"), "confirm");
    expect(placeArtwork(paths, { ...options, selectedStrokeLayers: inkSelection(next) })).toEqual(before.filter((p) => p.stroke === "blue"));
    expect(job.originalSelection).toEqual(options.selectedStrokeLayers);
  });
});
