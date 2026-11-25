import type { Path } from "flatten-svg";
import { elideShorterThan, merge as joinNearbyPaths, reorder as sortPaths } from "optimize-paths";
import { Device, type Plan, type PlanOptions, plan } from "./planning.js";
import { manualPlacementError, placeArtwork } from "./artwork.js";
import { dedupPoints } from "./util.js";
import { vmul } from "./vec.js";

/**
 * Create a plan based on new vectors and plan options
 * @param inPaths
 * @param planOptions
 * @returns
 */
export function replan(inPaths: Path[], planOptions: PlanOptions): Plan {
  const placementError = manualPlacementError(inPaths, planOptions);
  if (placementError) throw new Error(placementError);
  let paths = placeArtwork(inPaths, planOptions).map((path) => path.points);
  const device = Device(planOptions.hardware);

  if (planOptions.pointJoinRadius > 0) {
    paths = paths.map((p) => dedupPoints(p, planOptions.pointJoinRadius));
  }

  if (planOptions.sortPaths) {
    console.time("sorting paths");
    paths = sortPaths(paths);
    console.timeEnd("sorting paths");
  }

  if (planOptions.minimumPathLength > 0) {
    console.time("eliding short paths");
    paths = elideShorterThan(paths, planOptions.minimumPathLength);
    console.timeEnd("eliding short paths");
  }

  if (planOptions.pathJoinRadius > 0) {
    console.time("joining nearby paths");
    paths = joinNearbyPaths(paths, planOptions.pathJoinRadius);
    console.timeEnd("joining nearby paths");
  }

  // Convert the paths to units of "steps".
  paths = paths.map((ps) => ps.map((p) => vmul(p, device.stepsPerMm)));

  // And finally, motion planning.
  console.time("planning pen motions");
  const theplan = plan(
    paths,
    {
      penUpPos: device.penPctToPos(planOptions.penUpHeight),
      penDownPos: device.penPctToPos(planOptions.penDownHeight),
      penDownProfile: {
        acceleration: planOptions.penDownAcceleration * device.stepsPerMm,
        maximumVelocity: planOptions.penDownMaxVelocity * device.stepsPerMm,
        corneringFactor: planOptions.penDownCorneringFactor * device.stepsPerMm,
      },
      penUpProfile: {
        acceleration: planOptions.penUpAcceleration * device.stepsPerMm,
        maximumVelocity: planOptions.penUpMaxVelocity * device.stepsPerMm,
        corneringFactor: 0,
      },
      penDropDuration: planOptions.penDropDuration,
      penLiftDuration: planOptions.penLiftDuration,
    },
    vmul(planOptions.penHome, device.stepsPerMm),
  );
  console.timeEnd("planning pen motions");

  return theplan;
}
