import type { Path } from "flatten-svg";
import { placeArtwork, manualPlacementError } from "./artwork.js";
import type { PlanOptions } from "./planning.js";

export type InkMode = "dry-run" | "live";
export type InkStage = "ready" | "running" | "review" | "complete" | "interrupted";
export interface InkJob {
  inks: string[];
  index: number;
  mode: InkMode;
  stage: InkStage;
  originalSelection: Set<string>;
}
export type InkEvent = "start" | "simulate" | "finished" | "confirm" | "interrupt";

/** Only drawable, selected source strokes; never reinterpret mixed groups as one ink. */
export function availableInks(paths: Path[], options: PlanOptions): string[] {
  if (options.layerMode !== "stroke") return [];
  return [...new Set(placeArtwork(paths, options)
    .filter((p) => p.points.length > 1)
    .map((p) => p.stroke))].sort();
}

export function moveInk(inks: string[], index: number, delta: -1 | 1): string[] {
  const target = index + delta;
  if (index < 0 || index >= inks.length || target < 0 || target >= inks.length) return inks;
  const next = [...inks];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function createInkJob(paths: Path[], options: PlanOptions, inks: string[], mode: InkMode): InkJob {
  const available = availableInks(paths, options);
  if (inks.length < 2 || inks.length !== available.length || new Set(inks).size !== inks.length ||
      inks.some((ink) => !available.includes(ink))) throw new Error("Select at least two drawable strokes.");
  // Physical multicolor is intentionally limited to the explicitly validated placement mode.
  if (mode === "live" && (!options.manualPlacement || manualPlacementError(paths, options))) {
    throw new Error("Live multicolor requires valid Manual placement and confirmed machine travel.");
  }
  return { inks: [...inks], index: 0, mode, stage: "ready", originalSelection: new Set(options.selectedStrokeLayers) };
}

/** No event starts the next physical layer. Confirmation merely prepares it. */
export function advanceInkJob(job: InkJob, event: InkEvent): InkJob {
  if (event === "interrupt" && job.stage !== "complete") return { ...job, stage: "interrupted" };
  if (event === "start" && job.mode === "live" && job.stage === "ready") return { ...job, stage: "running" };
  if (event === "simulate" && job.mode === "dry-run" && job.stage === "ready") return { ...job, stage: "review" };
  if (event === "finished" && job.stage === "running") return { ...job, stage: "review" };
  if (event === "confirm" && job.stage === "review") {
    return job.index + 1 === job.inks.length
      ? { ...job, stage: "complete" }
      : { ...job, index: job.index + 1, stage: "ready" };
  }
  return job;
}

export function inkSelection(job: InkJob): Set<string> {
  return new Set([job.inks[job.index]]);
}
