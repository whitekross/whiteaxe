/**
 * Front-end for plotter app.
 */

import interpolator from "color-interpolate";
import colormap from "colormap";
import { flattenSVG, type Path } from "flatten-svg";
import React, {
  type ChangeEvent,
  Fragment,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { artworkBounds, centerManual, layerStrokes, manualDimensions, manualPlacementError, placeArtwork, previewInk, startManual } from "./artwork.js";
import { advanceInkJob, availableInks, createInkJob, type InkEvent, type InkJob, type InkMode, inkSelection, moveInk } from "./ink-workflow.js";
import { PaperSize } from "./paper-size.js";
import { Device, defaultPlanOptions, Plan, type ManualPlacement, type PlanOptions, type TransferredMotion, XYMotion } from "./planning.js";
import useComponentSize from "./useComponentSize.js";

import { formatDuration } from "./util.js";

import "./style.css";
import { type BaseDriver, type DeviceInfo, SaxiDriver, WebSerialDriver } from "./drivers.js";
import type { Hardware } from "./ebb.js";

const defaultVisualizationOptions = {
  penStrokeWidth: 0.5,
  colorPathsByStrokeOrder: false,
  previewMode: "artwork" as "artwork" | "plot",
};

const initialState = {
  connected: true,

  paused: false,
  inkJob: null as InkJob | null,

  deviceInfo: null as DeviceInfo | null,

  // UI state
  planOptions: defaultPlanOptions,
  visualizationOptions: defaultVisualizationOptions,

  // Options used to produce the current value of |plan|.
  plannedOptions: null as PlanOptions | null,

  // Info about the currently-loaded SVG.
  paths: null as Path[] | null,
  groupLayers: [] as string[],
  strokeLayers: [] as string[],

  // While a plot is in progress, this will be the index of the current motion.
  progress: null as number | null,
};

// Update the initial state with previously persisted settings (if present)

const persistedPlanOptions = JSON.parse(window.localStorage.getItem("planOptions") ?? "{}");
initialState.planOptions = { ...initialState.planOptions, ...persistedPlanOptions };
initialState.planOptions.paperSize = new PaperSize(initialState.planOptions.paperSize.size);
// Machine travel must be reconfirmed per session; layer Sets are rebuilt on SVG import.
initialState.planOptions.machineTravel = undefined;
initialState.planOptions.selectedStrokeLayers = new Set();
initialState.planOptions.selectedGroupLayers = new Set();

type State = typeof initialState;

type Action =
  | { type: "START_INK_JOB"; inks: string[]; mode: InkMode }
  | { type: "INK_EVENT"; event: InkEvent }
  | { type: "END_INK_JOB" }
  | { type: "SET_PLAN_OPTION"; value: Partial<State["planOptions"]> }
  | { type: "SET_VISUALIZATION_OPTION"; value: Partial<State["visualizationOptions"]> }
  | { type: "SET_DEVICE_INFO"; value: State["deviceInfo"] }
  | { type: "SET_PAUSED"; value: boolean }
  | { type: "SET_PROGRESS"; motionIdx: number | null }
  | { type: "SET_CONNECTED"; connected: boolean }
  | {
      type: "SET_PATHS";
      paths: State["paths"];
      strokeLayers: State["strokeLayers"];
      selectedStrokeLayers: State["planOptions"]["selectedStrokeLayers"];
      groupLayers: State["groupLayers"];
      selectedGroupLayers: State["planOptions"]["selectedGroupLayers"];
      layerMode: State["planOptions"]["layerMode"];
    };

type Dispatcher = React.Dispatch<Action>;
const nullDispatch: Dispatcher = () => null;
const DispatchContext = React.createContext<Dispatcher>(nullDispatch);

/**
 * State machine reducer. Handle actions that update the state.
 * @param state Previous state
 * @param action Message
 * @returns New state
 */
function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "START_INK_JOB": {
      if (!state.paths || state.inkJob || state.progress !== null) return state;
      const inkJob = createInkJob(state.paths, state.planOptions, action.inks, action.mode);
      return { ...state, inkJob, planOptions: { ...state.planOptions, selectedStrokeLayers: inkSelection(inkJob) } };
    }
    case "INK_EVENT": {
      if (!state.inkJob) return state;
      const inkJob = advanceInkJob(state.inkJob, action.event);
      if (inkJob === state.inkJob) return state;
      return {
        ...state,
        inkJob,
        planOptions: inkJob.index === state.inkJob.index ? state.planOptions : { ...state.planOptions, selectedStrokeLayers: inkSelection(inkJob) },
      };
    }
    case "END_INK_JOB":
      if (!state.inkJob || state.inkJob.stage === "running" || state.progress !== null) return state;
      return { ...state, inkJob: null, planOptions: { ...state.planOptions, selectedStrokeLayers: state.inkJob.originalSelection } };
    case "SET_PLAN_OPTION":
      if (state.inkJob) {
        if (action.value.hardware && action.value.hardware !== state.planOptions.hardware) {
          return { ...state, inkJob: advanceInkJob(state.inkJob, "interrupt"), planOptions: { ...state.planOptions, hardware: action.value.hardware, machineTravel: undefined } };
        }
        return state;
      }
      if (state.progress !== null) return state;
      return {
        ...state,
        planOptions: {
          ...state.planOptions,
          ...action.value,
          ...(action.value.hardware && action.value.hardware !== state.planOptions.hardware ? { machineTravel: undefined } : {}),
        },
      };
    case "SET_VISUALIZATION_OPTION":
      return { ...state, visualizationOptions: { ...state.visualizationOptions, ...action.value } };
    case "SET_DEVICE_INFO":
      return { ...state, deviceInfo: action.value };
    case "SET_PAUSED":
      return { ...state, paused: action.value };
    case "SET_PATHS": {
      if (state.progress !== null || state.inkJob) return state;
      const { paths, strokeLayers, selectedStrokeLayers, groupLayers, selectedGroupLayers, layerMode } = action;
      return {
        ...state,
        paths,
        groupLayers,
        strokeLayers,
        planOptions: { ...state.planOptions, selectedStrokeLayers, selectedGroupLayers, layerMode },
      };
    }
    case "SET_PROGRESS":
      return { ...state, progress: action.motionIdx };
    case "SET_CONNECTED":
      return { ...state, connected: action.connected, inkJob: !action.connected && state.inkJob?.mode === "live" ? advanceInkJob(state.inkJob, "interrupt") : state.inkJob };
    default:
      console.warn(`Unrecognized action '${{ action }}'`);
      return state;
  }
}

// FIXME: This should probably be used for the WebWorker
function serialize(po: PlanOptions): string {
  return JSON.stringify(po, (_k, v) => (v instanceof Set ? [...v] : v));
}

function attemptRejigger(previousOptions: PlanOptions, newOptions: PlanOptions, previousPlan: Plan): Plan | null {
  const newOptionsWithOldPenHeights = {
    ...newOptions,
    penUpHeight: previousOptions.penUpHeight,
    penDownHeight: previousOptions.penDownHeight,
  };
  if (serialize(previousOptions) === serialize(newOptionsWithOldPenHeights)) {
    const device = Device(newOptions.hardware);
    // The existing plan should be the same except for penup/pendown heights.
    return previousPlan.withPenHeights(
      device.penPctToPos(newOptions.penUpHeight),
      device.penPctToPos(newOptions.penDownHeight),
    );
  }
  return null;
}

const usePlan = (paths: Path[] | null, planOptions: PlanOptions) => {
  const [isPlanning, setIsPlanning] = useState(false);
  const [latestPlan, setPlan] = useState<Plan | null>(null);
  const [ready, setReady] = useState<{ paths: Path[]; options: PlanOptions } | null>(null);
  const [workerError, setWorkerError] = useState<string | null>(null);
  const placementError = useMemo(() => paths ? manualPlacementError(paths, planOptions) : null, [paths, planOptions]);

  const lastPaths = useRef<Path[]>(null);
  const lastPlan = useRef<Plan>(null);
  const lastPlanOptions = useRef<PlanOptions>(null);

  useEffect(() => {
    setWorkerError(null);
    if (!paths || placementError) {
      setReady(null);
      setIsPlanning(false);
      if (placementError) setPlan(null);
      return () => {};
    }
    if (lastPlan.current !== null && lastPaths.current === paths) {
      const rejiggered = attemptRejigger(lastPlanOptions.current ?? defaultPlanOptions, planOptions, lastPlan.current);
      if (rejiggered) {
        setPlan(rejiggered);
        lastPlan.current = rejiggered;
        lastPlanOptions.current = planOptions;
        setReady({ paths, options: planOptions });
        return () => {};
      }
    }
    const worker = new Worker("background-planner.js");
    setIsPlanning(true);
    console.time("posting to worker");
    // FIXME: planOptions contains Set objects which get converted to empty objects {}
    // during structured cloning. Should use: { paths, planOptions: JSON.parse(serialize(planOptions)) }
    worker.postMessage({ paths, planOptions });
    console.timeEnd("posting to worker");
    const listener = (m: MessageEvent<TransferredMotion[]>) => {
      console.time("deserializing");
      const plan = Plan.fromTransferable(m.data);
      console.timeEnd("deserializing");
      setPlan(plan);
      lastPlan.current = plan;
      lastPaths.current = paths;
      lastPlanOptions.current = planOptions;
      setReady({ paths, options: planOptions });
      setIsPlanning(false);
    };
    const onError = (event: ErrorEvent) => {
      setWorkerError(event.message || "Motion planning failed.");
      setPlan(null);
      setReady(null);
      setIsPlanning(false);
    };
    worker.addEventListener("message", listener);
    worker.addEventListener("error", onError);
    return () => {
      worker.removeEventListener("message", listener);
      worker.removeEventListener("error", onError);
      worker.terminate();
      setIsPlanning(false);
    };
  }, [paths, planOptions, placementError]);

  const stale = !!paths && (ready?.paths !== paths || ready?.options !== planOptions);
  return {
    isPlanning: !placementError && !workerError && (isPlanning || stale),
    plan: latestPlan,
    setPlan,
    planningError: placementError ?? workerError,
  };
};

const setPaths = (paths: Path[]): Action => {
  const strokes = new Set<string>();
  const groups = new Set<string>();
  for (const path of paths) {
    strokes.add(path.stroke);
    groups.add(path.groupId);
  }
  const layerMode = groups.size > 1 ? "group" : "stroke";
  const groupLayers = Array.from(groups).sort();
  const strokeLayers = Array.from(strokes).sort();
  return {
    type: "SET_PATHS",
    paths,
    groupLayers,
    strokeLayers,
    selectedGroupLayers: new Set(groupLayers),
    selectedStrokeLayers: new Set(strokeLayers),
    layerMode,
  };
};

function PenHeight({ state, driver }: { state: State; driver: BaseDriver }) {
  const { penUpHeight, penDownHeight, hardware } = state.planOptions;
  const dispatch = useContext(DispatchContext);
  const setPenUpHeight = (x: number) => dispatch({ type: "SET_PLAN_OPTION", value: { penUpHeight: x } });
  const setPenDownHeight = (x: number) => dispatch({ type: "SET_PLAN_OPTION", value: { penDownHeight: x } });
  const device = Device(hardware);

  const penUp = () => {
    const height = device.penPctToPos(penUpHeight);
    driver.setPenHeight(height, 1000);
  };
  const penDown = () => {
    const height = device.penPctToPos(penDownHeight);
    driver.setPenHeight(height, 1000);
  };
  return (
    <Fragment>
      <div className="flex">
        <label className="pen-label">
          up height (%)
          <input
            type="number"
            min="0"
            max="100"
            value={penUpHeight}
            onChange={(e) => setPenUpHeight(parseInt(e.target.value, 10))}
          />
        </label>
        <label className="pen-label">
          down height (%)
          <input
            type="number"
            min="0"
            max="100"
            value={penDownHeight}
            onChange={(e) => setPenDownHeight(parseInt(e.target.value, 10))}
          />
        </label>
      </div>
      <div className="flex">
        <button type="button" onClick={penUp}>
          pen up
        </button>
        <button type="button" onClick={penDown}>
          pen down
        </button>
      </div>
    </Fragment>
  );
}

function HardwareOptions({ state, driver }: { state: State; driver: BaseDriver | null }) {
  const dispatch = useContext(DispatchContext);

  const handleHardwareChange = (hardware: Hardware) => {
    // Always update the UI state first
    dispatch({ type: "SET_PLAN_OPTION", value: { hardware } });

    // Then notify the driver if connected
    driver?.changeHardware(hardware);
  };

  const currentHardware = state.deviceInfo?.hardware || state.planOptions.hardware;

  return (
    <div>
      <label title="Hardware model (affects servo and motor settings)">
        Hardware:
        <select
          value={currentHardware}
          onChange={(e) => handleHardwareChange(e.target.value as Hardware)}
          style={{ marginLeft: "8px" }}
          disabled={!driver}
        >
          <option value="v3">AxiDraw V3</option>
          <option value="brushless">AxiDraw V3 Brushless</option>
          <option value="nextdraw-2234">NextDraw 2234</option>
          <option value="idraw-h-se">iDraw H SE</option>
        </select>
      </label>
    </div>
  );
}

function VisualizationOptions({ state }: { state: State }) {
  const dispatch = useContext(DispatchContext);

  return (
    <>
      <label title="Width of lines in preview. Does not affect plot.">
        visualized stroke width (mm)
        <input
          type="number"
          value={state.visualizationOptions.penStrokeWidth}
          min="0"
          max="10"
          step="0.1"
          onChange={(e) =>
            dispatch({ type: "SET_VISUALIZATION_OPTION", value: { penStrokeWidth: Number(e.target.value) } })
          }
        />
      </label>
      <label
        className="flex-checkbox"
        title="Color paths in the preview based on the order in which they will be plotted. Yellow is first, pink is last."
      >
        <input
          type="checkbox"
          checked={state.visualizationOptions.colorPathsByStrokeOrder}
          onChange={(e) =>
            dispatch({ type: "SET_VISUALIZATION_OPTION", value: { colorPathsByStrokeOrder: !!e.target.checked } })
          }
        />
        color based on order
      </label>
    </>
  );
}

function OriginOptions({ state }: { state: State }) {
  const dispatch = useContext(DispatchContext);
  const device = Device(state.planOptions.hardware);
  return (
    <div className="flex">
      <label title="Starting and final position of pen when plotting (x)">
        home x (mm):
        <input
          type="number"
          min="0"
          max={state.planOptions.paperSize.size.x * device.stepsPerMm}
          step="10"
          value={state.planOptions.penHome.x}
          onChange={(e) =>
            dispatch({
              type: "SET_PLAN_OPTION",
              value: { penHome: { x: Number(e.target.value), y: state.planOptions.penHome.y } },
            })
          }
        />
      </label>
      <label title="Starting and final position of pen when plotting (y)">
        home y (mm):
        <input
          type="number"
          min="0"
          max={state.planOptions.paperSize.size.y * device.stepsPerMm}
          step="10"
          value={state.planOptions.penHome.y}
          onChange={(e) =>
            dispatch({
              type: "SET_PLAN_OPTION",
              value: { penHome: { x: state.planOptions.penHome.x, y: Number(e.target.value) } },
            })
          }
        />
      </label>
    </div>
  );
}

function SwapPaperSizesButton({ onClick }: { onClick: () => void }) {
  const handleKeyDown = (event: React.KeyboardEvent<SVGSVGElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault(); // Prevent scrolling with spacebar
      onClick();
    }
  };
  return (
    <svg
      className="paper-sizes__swap"
      xmlns="http://www.w3.org/2000/svg"
      width="14.05"
      height="11.46"
      viewBox="0 0 14.05 11.46"
      onKeyDown={handleKeyDown}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: no need for a div wrapper
      tabIndex={0}
      onClick={onClick}
    >
      <title>swap width and height</title>
      <g>
        <polygon points="14.05 3.04 8.79 0 8.79 1.78 1.38 1.78 1.38 4.29 8.79 4.29 8.79 6.08 14.05 3.04" />
        <polygon points="0 8.43 5.26 11.46 5.26 9.68 12.67 9.68 12.67 7.17 5.26 7.17 5.26 5.39 0 8.43" />
      </g>
    </svg>
  );
}

function PlacementControls({ state }: { state: State }) {
  const dispatch = useContext(DispatchContext);
  const options = state.planOptions;
  const manual = options.manualPlacement;
  const paths = state.paths ?? [];
  const update = (value: Partial<PlanOptions>) => dispatch({ type: "SET_PLAN_OPTION", value });
  const change = (value: Partial<ManualPlacement>) => {
    if (manual) update({ manualPlacement: { ...manual, ...value } });
  };
  const size = manualDimensions(paths, options);
  return (
    <div className="placement-controls">
      <label>
        placement
        <select
          value={manual ? "manual" : options.fitPage ? "fit" : "original"}
          onChange={(e) => {
            if (e.target.value === "manual") {
              update({ manualPlacement: startManual(paths, options) });
              dispatch({ type: "SET_VISUALIZATION_OPTION", value: { previewMode: "artwork" } });
            } else update({ manualPlacement: undefined, fitPage: e.target.value === "fit" });
          }}
        >
          <option value="fit">Fit to paper</option>
          <option value="original">Original size</option>
          <option value="manual">Manual</option>
        </select>
      </label>
      {manual && (
        <>
          <div className="flex">
            <label>X (mm)<input type="number" step="0.1" value={Number(manual.x.toFixed(3))} onChange={(e) => change({ x: Number(e.target.value) })} /></label>
            <label>Y (mm)<input type="number" step="0.1" value={Number(manual.y.toFixed(3))} onChange={(e) => change({ y: Number(e.target.value) })} /></label>
          </div>
          <div className="scale-line">
          <label>Scale (%)<input type="number" min="0.01" step="1" value={Number((manual.scale * 100).toFixed(3))} onChange={(e) => change({ scale: Number(e.target.value) / 100 })} /></label>
          {size && <div className="artwork-size"><span>Artwork size</span><strong>{size.x.toFixed(1)} × {size.y.toFixed(1)} mm</strong></div>}
          </div>
          <div className="placement-centers">
            {(["x", "y", "both"] as const).map((axis) => (
              <button type="button" key={axis} onClick={() => update({ manualPlacement: centerManual(paths, options, axis) })}>
                {axis === "both" ? "Center both" : axis === "x" ? "Center X" : "Center Y"}
              </button>
            ))}
          </div>
          <div className="placement-hint">Drag the artwork or enter its top-left X/Y. No cropping in Manual.</div>
          <div className="machine-travel">
          <div className="flex">
            <label>Machine travel X (mm)<input type="number" min="0" value={options.machineTravel?.x || ""} onChange={(e) => update({ machineTravel: { x: Number(e.target.value), y: options.machineTravel?.y ?? 0 } })} /></label>
            <label>Machine travel Y (mm)<input type="number" min="0" value={options.machineTravel?.y || ""} onChange={(e) => update({ machineTravel: { x: options.machineTravel?.x ?? 0, y: Number(e.target.value) } })} /></label>
          </div>
          <div className="placement-hint">Measured machine travel from its origin, required each session; not paper dimensions.</div>
          </div>
        </>
      )}
    </div>
  );
}

function PaperConfig({ state }: { state: State }) {
  const dispatch = useContext(DispatchContext);
  const landscape = state.planOptions.paperSize.isLandscape;
  function setPaperSize(e: ChangeEvent) {
    const name = (e.target as HTMLInputElement).value;
    if (name !== "Custom") {
      const ps = PaperSize.standard[name][landscape ? "landscape" : "portrait"];
      dispatch({ type: "SET_PLAN_OPTION", value: { paperSize: ps } });
    }
  }
  function setCustomPaperSize(x: number, y: number) {
    dispatch({ type: "SET_PLAN_OPTION", value: { paperSize: new PaperSize({ x, y }) } });
  }
  const { paperSize } = state.planOptions;
  const paperSizeName =
    Object.keys(PaperSize.standard).find((psName) => {
      const ps = PaperSize.standard[psName].size;
      return (
        (ps.x === paperSize.size.x && ps.y === paperSize.size.y) ||
        (ps.y === paperSize.size.x && ps.x === paperSize.size.y)
      );
    }) || "Custom";
  return (
    <div>
      <select aria-label="Paper format" value={paperSizeName} onChange={setPaperSize}>
        {Object.keys(PaperSize.standard).map((name) => (
          <option key={name}>{name}</option>
        ))}
        <option>Custom</option>
      </select>
      <div className="paper-sizes">
        <label className="paper-label">
          width (mm)
          <input
            type="number"
            value={paperSize.size.x}
            onChange={(e) => setCustomPaperSize(Number(e.target.value), paperSize.size.y)}
          />
        </label>
        <SwapPaperSizesButton
          onClick={() => {
            dispatch({
              type: "SET_PLAN_OPTION",
              value: { paperSize: paperSize.isLandscape ? paperSize.portrait : paperSize.landscape },
            });
          }}
        />
        <label className="paper-label">
          height (mm)
          <input
            type="number"
            value={paperSize.size.y}
            onChange={(e) => setCustomPaperSize(paperSize.size.x, Number(e.target.value))}
          />
        </label>
      </div>
      <div className="paper-adjustments">
        <label>
          Rotation (°)
          <div>
            <input
              type="number"
              min="-90"
              step="90"
              max="360"
              placeholder="0"
              value={state.planOptions.rotateDrawing}
              onInput={(e) => {
                const value = (e.target as HTMLInputElement).value;
                if (Number(value) < 0) {
                  (e.target as HTMLInputElement).value = "270";
                }
                if (Number(value) > 270) {
                  (e.target as HTMLInputElement).value = "0";
                }
              }}
              onChange={(e) => dispatch({ type: "SET_PLAN_OPTION", value: { rotateDrawing: Number(e.target.value) } })}
            />
          </div>
        </label>
      <label>
        Margin (mm)
        <input
          type="number"
          value={state.planOptions.marginMm}
          min="0"
          max={Math.min(paperSize.size.x / 2, paperSize.size.y / 2)}
          onChange={(e) => dispatch({ type: "SET_PLAN_OPTION", value: { marginMm: Number(e.target.value) } })}
        />
      </label>
      </div>
    </div>
  );
}

function MotorControl({ driver }: { driver: BaseDriver }) {
  return (
    <div>
      <button type="button" onClick={() => driver.limp()}>
        disengage motors
      </button>
    </div>
  );
}

function PlanStatistics({ plan }: { plan: Plan | null }) {
  const totalDuration = useMemo(() => (plan ? plan.duration() : 0), [plan]);
  return (
    <div className="duration">
      <div>Duration</div>
      <div>
        <strong>{totalDuration > 0 ? formatDuration(totalDuration) : "-"}</strong>
      </div>
    </div>
  );
}

function TimeLeft({
  plan,
  progress,
  currentMotionStartedTime,
  paused,
}: {
  plan: Plan | null;
  progress: number | null;
  currentMotionStartedTime: Date;
  paused: boolean;
}) {
  const [_, setTime] = useState(new Date());

  // Interval that ticks every second to rerender
  // and recalculate time remaining for long motions
  useEffect(() => {
    const interval = setInterval(() => {
      setTime(new Date());
    }, 1000);

    return () => {
      clearInterval(interval);
    };
  }, []);

  if (!plan || progress === null || paused) {
    return null;
  }

  const currentMotionTimeSpent = (Date.now() - currentMotionStartedTime.getTime()) / 1000;
  const duration = plan.duration(progress);
  return (
    <div className="duration">
      <div>Time remaining</div>
      <div>
        <strong>{formatDuration(duration - currentMotionTimeSpent)}</strong>
      </div>
    </div>
  );
}

function PlanPreview({
  state,
  previewSize,
  plan,
  onDragging,
  allowDrag,
}: {
  state: State;
  previewSize: { width: number; height: number };
  plan: Plan | null;
  onDragging: (value: boolean) => void;
  allowDrag: boolean;
}) {
  const dispatch = useContext(DispatchContext);
  const [draft, setDraft] = useState<ManualPlacement | null>(null);
  const drag = useRef<{ pointer: number; startX: number; startY: number; initial: ManualPlacement } | null>(null);
  const manual = state.planOptions.manualPlacement;
  const ps = state.planOptions.paperSize;
  const device = Device(state.planOptions.hardware);
  const strokeWidth = state.visualizationOptions.penStrokeWidth * device.stepsPerMm;
  const colorPathsByStrokeOrder = state.visualizationOptions.colorPathsByStrokeOrder;
  const showArtwork = state.visualizationOptions.previewMode === "artwork" && state.progress === null;
  const canDrag = allowDrag && showArtwork && !!manual && !!state.paths;
  const toPaper = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * ps.size.x / rect.width, y: (e.clientY - rect.top) * ps.size.y / rect.height };
  };
  const moved = (e: React.PointerEvent<SVGSVGElement>) => {
    const active = drag.current;
    if (!active || active.pointer !== e.pointerId) return null;
    const p = toPaper(e);
    return { ...active.initial, x: active.initial.x + p.x - active.startX, y: active.initial.y + p.y - active.startY };
  };
  const stopDrag = () => {
    drag.current = null;
    setDraft(null);
    onDragging(false);
  };
  const memoizedArtwork = useMemo(() => {
    if (!showArtwork || !state.paths) return null;
    return (
      <g>
        <title>Artwork preview before path optimization</title>
        {placeArtwork(state.paths, draft ? { ...state.planOptions, manualPlacement: draft } : state.planOptions).map((path) => (
          <path
            key={`${path.sourceIndex}:${path.fragmentIndex}`}
            d={path.points.map(({ x, y }, i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join(" ")}
            style={{
              stroke: previewInk(path.stroke, (value) => CSS.supports("color", value)) ?? "#777777",
              strokeWidth: strokeWidth / device.stepsPerMm,
              fill: "none",
              strokeLinecap: "round",
              strokeLinejoin: "round",
            }}
          />
        ))}
      </g>
    );
  }, [showArtwork, state.paths, state.planOptions, strokeWidth, device.stepsPerMm, draft]);
  const selectionBounds = useMemo(() => {
    if (!showArtwork || !manual || !state.paths) return null;
    return artworkBounds(placeArtwork(state.paths, {
      ...state.planOptions,
      manualPlacement: draft ?? manual,
      layerMode: "all",
    }).map((path) => path.points));
  }, [showArtwork, manual, state.paths, state.planOptions, draft]);
  const memoizedPlanPreview = useMemo(() => {
    if (plan) {
      const palette = colorPathsByStrokeOrder
        ? interpolator(colormap({ colormap: "spring" }))
        : () => "rgba(0, 0, 0, 0.8)";
      const lines = plan.motions
        .filter((m) => m instanceof XYMotion)
        .map((m) => (m as XYMotion).points()) // Each XYMotion's block start points plus its final end point
        .filter((m) => m.length);
      if (lines.length === 0) return null;
      return (
        <g transform={`scale(${1 / device.stepsPerMm})`}>
          <title>Pen home</title>
          <text x={lines[0][0].x} y={lines[0][0].y} fontSize="40" textAnchor="middle" dominantBaseline="middle">
            ꚛ
          </text>
          {lines.map((line, i) => (
            <path
              // biome-ignore lint/suspicious/noArrayIndexKey: the paths are not changed elsewhere
              key={i}
              d={line.reduce((m, { x, y }, j) => `${m}${j === 0 ? "M" : "L"}${x} ${y}`, "")}
              style={
                i % 2 === 0
                  ? { stroke: "rgba(0, 0, 0, 0.3)", strokeWidth: 0.5 }
                  : { stroke: palette(1 - i / lines.length), strokeWidth }
              }
            />
          ))}
        </g>
      );
    }
    return null;
  }, [plan, strokeWidth, colorPathsByStrokeOrder, device.stepsPerMm]);

  // w/h of svg.
  // first try scaling so that h = area.h. if w < area.w, then ok.
  // otherwise, scale so that w = area.w.
  const { width, height } =
    (ps.size.x / ps.size.y) * previewSize.height <= previewSize.width
      ? { width: (ps.size.x / ps.size.y) * previewSize.height, height: previewSize.height }
      : { height: (ps.size.y / ps.size.x) * previewSize.width, width: previewSize.width };

  const [microprogress, setMicroprogress] = useState(0);
  useLayoutEffect(() => {
    let rafHandle: number;
    let cancelled = false;
    if (state.progress !== null) {
      const startingTime = Date.now();
      const updateProgress = () => {
        if (cancelled) {
          return;
        }
        setMicroprogress(Date.now() - startingTime);
        rafHandle = requestAnimationFrame(updateProgress);
      };
      updateProgress();
    }
    return () => {
      cancelled = true;
      if (rafHandle !== null) {
        cancelAnimationFrame(rafHandle);
      }
      setMicroprogress(0);
    };
  }, [state.progress]);

  let progressIndicator = <></>;
  if (state.progress !== null && plan !== null) {
    const motion = plan.motion(state.progress);
    const pos =
      motion instanceof XYMotion
        ? motion.instant(Math.min(microprogress / 1000, motion.duration())).p
        : (plan.motion(state.progress - 1) as XYMotion).p2;
    const posXMm = pos.x / device.stepsPerMm;
    const posYMm = pos.y / device.stepsPerMm;
    progressIndicator = (
      <svg
        width={width * 2}
        height={height * 2}
        viewBox={`${-width} ${-height} ${width * 2} ${height * 2}`}
        style={{
          transform:
            "translateZ(0.001px) " +
            `translate(${-width}px, ${-height}px) ` +
            `translate(${(posXMm / ps.size.x) * 50}%,${(posYMm / ps.size.y) * 50}%)`,
        }}
      >
        <title>Progress percentage bar</title>
        <g>
          <path
            d={`M-${width} 0l${width * 2} 0M0 -${height}l0 ${height * 2}`}
            style={{ stroke: "rgba(222, 114, 114, 0.6)", strokeWidth: 1 }}
          />
          <path d="M-10 0l20 0M0 -10l0 20" style={{ stroke: "rgba(222, 114, 114, 1)", strokeWidth: 2 }} />
        </g>
      </svg>
    );
  }
  const margins = (
    <g>
      <rect
        x={state.planOptions.marginMm}
        y={state.planOptions.marginMm}
        width={ps.size.x - state.planOptions.marginMm * 2}
        height={ps.size.y - state.planOptions.marginMm * 2}
        fill="none"
        stroke="black"
        strokeWidth="0.1"
        strokeDasharray="1,1"
      />
    </g>
  );
  return (
    <div className="paper-frame">
      <div className="ruler ruler-x" aria-hidden="true">
        {Array.from({ length: Math.min(100, Math.max(0, Math.floor(ps.size.x / 20) + 1)) }, (_, i) => i * 20).map((mm) => (
          <span key={mm} style={{ left: `${mm / ps.size.x * 100}%` }}>{mm}</span>
        ))}
      </div>
      <div className="ruler ruler-y" aria-hidden="true">
        {Array.from({ length: Math.min(100, Math.max(0, Math.floor(ps.size.y / 20) + 1)) }, (_, i) => i * 20).map((mm) => (
          <span key={mm} style={{ top: `${mm / ps.size.y * 100}%` }}>{mm}</span>
        ))}
      </div>
      <div className="preview">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${ps.size.x} ${ps.size.y}`}
        className={canDrag ? "manual-paper" : undefined}
        onPointerDown={(e) => {
          if (!canDrag || !manual || e.button !== 0) return;
          const p = toPaper(e);
          if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { pointer: e.pointerId, startX: p.x, startY: p.y, initial: manual };
          setDraft(manual);
          onDragging(true);
        }}
        onPointerMove={(e) => {
          const next = moved(e);
          if (next) setDraft(next);
        }}
        onPointerUp={(e) => {
          const next = moved(e);
          if (next) dispatch({ type: "SET_PLAN_OPTION", value: { manualPlacement: next } });
          stopDrag();
        }}
        onPointerCancel={stopDrag}
        onLostPointerCapture={stopDrag}
      >
        <title>{showArtwork ? "Artwork preview" : "Plot preview"}</title>
        {showArtwork ? memoizedArtwork : memoizedPlanPreview}
        {margins}
        {selectionBounds && (
          <g className="selection-bounds" pointerEvents="none">
            <rect
              x={selectionBounds.minX}
              y={selectionBounds.minY}
              width={selectionBounds.maxX - selectionBounds.minX}
              height={selectionBounds.maxY - selectionBounds.minY}
              fill="none"
              stroke="#4879bc"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
              strokeDasharray="4 3"
            />
          </g>
        )}
      </svg>
      {progressIndicator}
      </div>
    </div>
  );
}

function PlanLoader({ isLoadingFile, isPlanning }: { isLoadingFile: boolean; isPlanning: boolean }) {
  if (isLoadingFile || isPlanning) {
    return <div className="preview-loader">{isLoadingFile ? "Loading file..." : "Replanning..."}</div>;
  }

  return null;
}

function LayerSelector({ state }: { state: State }) {
  const dispatch = useContext(DispatchContext);
  const { layerMode } = state.planOptions;
  const layers = layerMode === "group" ? state.groupLayers : state.strokeLayers;
  const selectedLayers =
    layerMode === "group" ? state.planOptions.selectedGroupLayers : state.planOptions.selectedStrokeLayers;
  const swatches = useMemo(
    () => new Map(layers.map((layer) => [layer, layerStrokes(state.paths ?? [], layerMode, layer)])),
    [layers, state.paths, layerMode],
  );
  if (layers.length === 0 || layerMode === "all") return null;

  const setLayers = (next: Set<string>) => {
    if (layerMode === "group") {
      dispatch({ type: "SET_PLAN_OPTION", value: { selectedGroupLayers: next } });
    } else {
      dispatch({ type: "SET_PLAN_OPTION", value: { selectedStrokeLayers: next } });
    }
  };
  const toggleLayer = (layer: string, checked: boolean) => {
    const next = new Set(selectedLayers);
    if (checked) next.add(layer);
    else next.delete(layer);
    setLayers(next);
  };

  return (
    <div>
      <div className="layer-toolbar">
      <div className="layer-heading">{selectedLayers.size} of {layers.length} selected</div>
      <div className="layer-actions">
        <button type="button" disabled={state.progress !== null} onClick={() => setLayers(new Set(layers))}>
          All
        </button>
        <button type="button" disabled={state.progress !== null} onClick={() => setLayers(new Set())}>
          None
        </button>
      </div>
      </div>
      <div className="layer-list">
        {layers.map((layer) => {
          const strokes = swatches.get(layer) ?? [];
          const name = layer || (layerMode === "group" ? "(ungrouped)" : "(unknown stroke)");
          return (
            <label className="layer-row" key={layer}>
              <input
                type="checkbox"
                checked={selectedLayers.has(layer)}
                disabled={state.progress !== null}
                onChange={(e) => toggleLayer(layer, e.target.checked)}
              />
              <span className="layer-swatches" title={strokes.map((stroke) => stroke || "Unknown").join(", ")}>
                {strokes.slice(0, 4).map((stroke) => (
                  <span
                    key={stroke}
                    className="layer-swatch"
                    style={{ backgroundColor: previewInk(stroke, (value) => CSS.supports("color", value)) ?? "#777777" }}
                  />
                ))}
                {strokes.length > 4 && <span className="layer-more">+{strokes.length - 4}</span>}
              </span>
              <span className="layer-name" title={name}>{name}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function InkQueueSetup({ inks, canLive, disabled }: { inks: string[]; canLive: boolean; disabled: boolean }) {
  const dispatch = useContext(DispatchContext);
  const [order, setOrder] = useState(inks);
  return (
    <div className="ink-queue">
      <div className="ink-caption">Choose the order of the selected source colors.</div>
      {order.map((ink, index) => (
        <div className="ink-row" key={ink}>
          <span className="ink-number">{index + 1}</span>
          <span className="layer-swatch" style={{ backgroundColor: previewInk(ink, (v) => CSS.supports("color", v)) ?? "#777777" }} />
          <span className="ink-name" title={ink}>{ink || "Unknown stroke"}</span>
          <button type="button" aria-label={`Move ${ink} up`} disabled={index === 0 || disabled} onClick={() => setOrder(moveInk(order, index, -1))}>↑</button>
          <button type="button" aria-label={`Move ${ink} down`} disabled={index === order.length - 1 || disabled} onClick={() => setOrder(moveInk(order, index, 1))}>↓</button>
        </div>
      ))}
      <div className="ink-actions">
        <button type="button" disabled={disabled} onClick={() => dispatch({ type: "START_INK_JOB", inks: order, mode: "dry-run" })}>Dry run</button>
        <button type="button" disabled={disabled || !canLive} onClick={() => dispatch({ type: "START_INK_JOB", inks: order, mode: "live" })}>Prepare live job</button>
      </div>
      {!canLive && <div className="ink-caption">Live requires a connected plotter, valid Manual placement and measured machine travel. Dry run never sends motion.</div>}
    </div>
  );
}

function InkJobPanel({ job, ready, onStart, onConfirm }: { job: InkJob; ready: boolean; onStart: () => void; onConfirm: () => void }) {
  const dispatch = useContext(DispatchContext);
  const current = job.inks[job.index];
  return (
    <div className="ink-queue ink-active">
      <div className="ink-job-title">{job.mode === "dry-run" ? "Dry run · no hardware" : "Guided ink job"} <span>{job.index + 1}/{job.inks.length}</span></div>
      {job.inks.map((ink, i) => (
        <div key={ink} className={`ink-row ${i === job.index ? "ink-current" : ""}`}>
          <span className="ink-number">{i < job.index || job.stage === "complete" ? "✓" : i + 1}</span>
          <span className="layer-swatch" style={{ backgroundColor: previewInk(ink, (v) => CSS.supports("color", v)) ?? "#777777" }} />
          <span className="ink-name" title={ink}>{ink || "Unknown stroke"}</span>
        </div>
      ))}
      {job.stage === "ready" && <>
        <div className="ink-caption">{job.mode === "live" ? "Fit the indicated pen, verify the physical origin and paper alignment, and keep the carriage stationary during pen changes." : "Only this ink is selected in the real artwork and motion preview."}</div>
        <button type="button" className="ink-primary" disabled={!ready} onClick={onStart}>{job.mode === "dry-run" ? "Simulate layer" : `Plot ${current || "current ink"}`}</button>
      </>}
      {job.stage === "running" && <div className="ink-caption">Plotting this ink. Wait for completion; Pause and Cancel remain available.</div>}
      {job.stage === "review" && <>
        <div className="ink-caption">{job.mode === "live" ? "Verify the machine is completely stopped and the layer is correct before continuing." : "Layer simulated. No movement was sent to the plotter."}</div>
        <button type="button" className="ink-primary" disabled={!ready} onClick={onConfirm}>{job.index + 1 === job.inks.length ? "Finish sequence" : "Confirm & prepare next ink"}</button>
      </>}
      {job.stage === "complete" && <div className="ink-caption">Sequence complete. Close to restore the original selection.</div>}
      {job.stage === "interrupted" && <div className="placement-error">Sequence interrupted. Verify the machine and origin before starting a new sequence. No automatic retry.</div>}
      {job.stage !== "running" && <button type="button" disabled={!ready && job.stage !== "interrupted" && job.stage !== "complete"} onClick={() => dispatch({ type: "END_INK_JOB" })}>{job.stage === "complete" ? "Close sequence" : "End sequence"}</button>}
    </div>
  );
}

function PlotButtons({
  state,
  plan,
  isPlanning,
  driver,
  blocked,
}: {
  state: State;
  plan: Plan | null;
  isPlanning: boolean;
  driver: BaseDriver | null;
  blocked: boolean;
}) {
  function cancel() {
    driver?.cancel();
  }
  function pause() {
    driver?.pause();
  }
  function resume() {
    driver?.resume();
  }
  function plot(plan: Plan) {
    if (!blocked && driver?.connected) void Promise.resolve(driver.plot(plan)).catch((error) => console.error("Plot failed", error));
  }

  return (
    <div>
      {!state.inkJob && (isPlanning ? (
        <button type="button" disabled={true}>
          Replanning...
        </button>
      ) : (
        <button
          type="button"
          className={`plot-button ${state.progress !== null ? "plot-button--plotting" : ""}`}
          disabled={blocked || !driver?.connected || plan === null || state.progress !== null || (state.planOptions.layerMode === "group" && state.planOptions.selectedGroupLayers.size === 0) || (state.planOptions.layerMode === "stroke" && state.planOptions.selectedStrokeLayers.size === 0)}
          onClick={() => plan && plot(plan)}
        >
          {plan && state.progress !== null ? "Plotting..." : "Plot"}
        </button>
      ))}
      <div className={"button-row"}>
        <button
          type="button"
          className={`cancel-button ${state.progress !== null ? "cancel-button--active" : ""}`}
          onClick={state.paused ? resume : pause}
          disabled={plan === null || state.progress === null}
        >
          {state.paused ? "Resume" : "Pause"}
        </button>
        <button
          type="button"
          className={`cancel-button ${state.progress !== null ? "cancel-button--active" : ""}`}
          onClick={cancel}
          disabled={plan === null || state.progress === null}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function ResetToDefaultsButton() {
  const dispatch = useContext(DispatchContext);
  const onClick = () => {
    // Clear all user settings that have been saved and reset to the defaults
    window.localStorage.removeItem("planOptions");
    dispatch({ type: "SET_PLAN_OPTION", value: { ...defaultPlanOptions, manualPlacement: undefined, machineTravel: undefined } });
  };

  return (
    <button type="reset" className="button-link" onClick={onClick}>
      reset all options
    </button>
  );
}

function PlanConfig({ state }: { state: State }) {
  const dispatch = useContext(DispatchContext);
  return (
    <div>
      <form>
        <label className="flex-checkbox" title="Re-order paths to minimize pen-up travel time">
          <input
            type="checkbox"
            checked={state.planOptions.sortPaths}
            onChange={(e) => dispatch({ type: "SET_PLAN_OPTION", value: { sortPaths: !!e.target.checked } })}
          />
          sort paths
        </label>
        <label className="flex-checkbox" title="Split into layers according to group ID, instead of stroke">
          <input
            type="checkbox"
            checked={state.planOptions.layerMode === "group"}
            onChange={(e) =>
              dispatch({ type: "SET_PLAN_OPTION", value: { layerMode: e.target.checked ? "group" : "stroke" } })
            }
          />
          layer by group
        </label>
        {!state.planOptions.manualPlacement && !state.planOptions.fitPage ? (
          <label className="flex-checkbox" title="Remove lines that fall outside the margins">
            <input
              type="checkbox"
              checked={state.planOptions.cropToMargins}
              onChange={(e) => dispatch({ type: "SET_PLAN_OPTION", value: { cropToMargins: !!e.target.checked } })}
            />
            crop to margins
          </label>
        ) : null}
      </form>
      <div className="flex">
        <label title="point-joining radius (mm)">
          Point join (mm)
          <input
            type="number"
            value={state.planOptions.pointJoinRadius}
            step="0.1"
            min="0"
            onChange={(e) => dispatch({ type: "SET_PLAN_OPTION", value: { pointJoinRadius: Number(e.target.value) } })}
          />
        </label>
        <label title="path-joining radius (mm)">
          Path join (mm)
          <input
            type="number"
            value={state.planOptions.pathJoinRadius}
            step="0.1"
            min="0"
            onChange={(e) => dispatch({ type: "SET_PLAN_OPTION", value: { pathJoinRadius: Number(e.target.value) } })}
          />
        </label>
      </div>
      <div>
        <label title="Remove paths that are shorter than this length (in mm)">
          minimum path length
          <input
            type="number"
            value={state.planOptions.minimumPathLength}
            step="0.1"
            min="0"
            onChange={(e) =>
              dispatch({ type: "SET_PLAN_OPTION", value: { minimumPathLength: Number(e.target.value) } })
            }
          />
        </label>
        <div className="flex">
          <label title="Acceleration when the pen is down (in mm/s^2)">
            down acc. (mm/s<sup>2</sup>)
            <input
              type="number"
              value={state.planOptions.penDownAcceleration}
              step="0.1"
              min="0"
              onChange={(e) =>
                dispatch({ type: "SET_PLAN_OPTION", value: { penDownAcceleration: Number(e.target.value) } })
              }
            />
          </label>
          <label title="Maximum velocity when the pen is down (in mm/s)">
            down max vel. (mm/s)
            <input
              type="number"
              value={state.planOptions.penDownMaxVelocity}
              step="0.1"
              min="0"
              onChange={(e) =>
                dispatch({ type: "SET_PLAN_OPTION", value: { penDownMaxVelocity: Number(e.target.value) } })
              }
            />
          </label>
        </div>
        <label>
          cornering factor
          <input
            type="number"
            value={state.planOptions.penDownCorneringFactor}
            step="0.01"
            min="0"
            onChange={(e) =>
              dispatch({ type: "SET_PLAN_OPTION", value: { penDownCorneringFactor: Number(e.target.value) } })
            }
          />
        </label>
        <div className="flex">
          <label title="Acceleration when the pen is up (in mm/s^2)">
            up acc. (mm/s<sup>2</sup>)
            <input
              type="number"
              value={state.planOptions.penUpAcceleration}
              step="0.1"
              min="0"
              onChange={(e) =>
                dispatch({ type: "SET_PLAN_OPTION", value: { penUpAcceleration: Number(e.target.value) } })
              }
            />
          </label>
          <label title="Maximum velocity when the pen is up (in mm/s)">
            up max vel. (mm/s)
            <input
              type="number"
              value={state.planOptions.penUpMaxVelocity}
              step="0.1"
              min="0"
              onChange={(e) =>
                dispatch({ type: "SET_PLAN_OPTION", value: { penUpMaxVelocity: Number(e.target.value) } })
              }
            />
          </label>
        </div>
        <div className="flex">
          <label title="How long the pen takes to lift (in seconds)">
            pen lift duration (s)
            <input
              type="number"
              value={state.planOptions.penLiftDuration}
              step="0.01"
              min="0"
              onChange={(e) =>
                dispatch({ type: "SET_PLAN_OPTION", value: { penLiftDuration: Number(e.target.value) } })
              }
            />
          </label>
          <label title="How long the pen takes to drop (in seconds)">
            pen drop duration (s)
            <input
              type="number"
              value={state.planOptions.penDropDuration}
              step="0.01"
              min="0"
              onChange={(e) =>
                dispatch({ type: "SET_PLAN_OPTION", value: { penDropDuration: Number(e.target.value) } })
              }
            />
          </label>
        </div>
      </div>
    </div>
  );
}

type PortSelectorProps = {
  driver: BaseDriver | null;
  setDriver: (driver: BaseDriver) => void;
  hardware: Hardware;
};

function PortSelector({ driver, setDriver, hardware }: PortSelectorProps) {
  const [initializing, setInitializing] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: setDriver is stable
  useEffect(() => {
    (async () => {
      if (driver?.connected) return; // Already connected
      setInitializing(true);
      try {
        const ports = await navigator.serial.getPorts(); // re-connect to previously established connection
        const port = ports[0];
        if (port) {
          console.log("connecting to", port);
          // get the first
          setDriver(await WebSerialDriver.connect(port, hardware));
        }
      } finally {
        setInitializing(false);
      }
    })();
  }, [driver, hardware]);
  return (
    <>
      {driver?.connected ? `Connected to ${driver.name()}` : null}
      <button
        type="button"
        disabled={initializing}
        onClick={async () => {
          setInitializing(true);
          try {
            const port = await navigator.serial.requestPort({
              filters: [{ usbVendorId: 0x04d8, usbProductId: 0xfd92 }],
            });
            setDriver(await WebSerialDriver.connect(port, hardware));
          } catch (e) {
            alert(`Failed to connect to serial device: ${e.message}`);
            console.error(e);
          } finally {
            setInitializing(false);
          }
        }}
      >
        {initializing ? "Connecting..." : driver?.connected ? "Change port" : "Connect"}
      </button>
    </>
  );
}

function Root() {
  const [driver, setDriver] = useState<BaseDriver | null>(null);
  const [isDriverConnected, setIsDriverConnected] = useState(false);
  useEffect(() => {
    if (isDriverConnected) return;
    if (IS_WEB) return;
    (async () => {
      setDriver(await SaxiDriver.connect());
      setIsDriverConnected(true);
    })();
  }, [isDriverConnected]);

  const [state, dispatch] = useReducer(reducer, initialState);
  const { isPlanning, plan, setPlan, planningError } = usePlan(state.paths, state.planOptions);
  const [dragging, setDragging] = useState(false);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">(() => window.localStorage.getItem("whiteaxe-theme") === "dark" ? "dark" : "light");
  const [zoom, setZoom] = useState(1);
  const [panMode, setPanMode] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const panStart = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  useEffect(() => {
    window.localStorage.setItem("planOptions", JSON.stringify(state.planOptions));
  }, [state.planOptions]);

  // biome-ignore lint/correctness/useExhaustiveDependencies(setPlan): React setters are stable
  useEffect(() => {
    if (driver === null) return;
    driver.onprogress = (motionIdx: number) => {
      dispatch({ type: "SET_PROGRESS", motionIdx });
    };
    driver.oncancelled = () => {
      dispatch({ type: "SET_PROGRESS", motionIdx: null });
      dispatch({ type: "INK_EVENT", event: "interrupt" });
    };
    driver.onfinished = () => {
      dispatch({ type: "SET_PROGRESS", motionIdx: null });
      // WebSerial completion is acknowledged only after its plot promise resolves (motor idle).
      if (!IS_WEB) dispatch({ type: "INK_EVENT", event: "finished" });
    };
    driver.ondevinfo = (devInfo: DeviceInfo) => {
      dispatch({ type: "SET_DEVICE_INFO", value: devInfo });
      dispatch({ type: "SET_PLAN_OPTION", value: { hardware: devInfo.hardware } });
    };
    driver.onpause = (paused: boolean) => {
      dispatch({ type: "SET_PAUSED", value: paused });
    };
    driver.onplan = (plan: Plan) => {
      setPlan(plan);
    };
  }, [driver]);

  useEffect(() => {
    // poll the driver so React notices connection changes
    if (!driver) return;
    const interval = setInterval(() => {
      if (state.connected !== driver.connected) {
        dispatch({ type: "SET_CONNECTED", connected: driver.connected });
      }
    }, 100);
    return () => clearInterval(interval);
  }, [driver, state.connected]);

  const handleFile = React.useCallback(
    (file: File) => {
      if (state.progress !== null || dragging || state.inkJob) return;
      setIsLoadingFile(true);
      setPlan(null);

      const reader = new FileReader();
      reader.onload = () => {
        dispatch(setPaths(readSvg(reader.result as string)));
        setFileName(file.name);
        setIsLoadingFile(false);
      };
      reader.onerror = () => {
        setIsLoadingFile(false);
      };
      reader.readAsText(file);
    },
    [setPlan, state.progress, dragging, state.inkJob],
  );

  useEffect(() => {
    // Called when the user drags and drops the image
    const ondrop = (e: DragEvent) => {
      e.preventDefault();
      document.body.classList.remove("dragover");
      const file = e.dataTransfer?.items[0]?.getAsFile();
      if (file) handleFile(file);
    };
    const ondragover = (e: DragEvent) => {
      e.preventDefault();
      document.body.classList.add("dragover");
    };
    const ondragleave = (e: DragEvent) => {
      e.preventDefault();
      document.body.classList.remove("dragover");
    };
    const onpaste = (e: ClipboardEvent) => {
      if (state.inkJob || state.progress !== null || dragging) return;
      e.clipboardData?.items[0].getAsString((s) => {
        dispatch(setPaths(readSvg(s)));
        setFileName("Pasted SVG");
      });
    };
    document.body.addEventListener("drop", ondrop);
    document.body.addEventListener("dragover", ondragover);
    document.body.addEventListener("dragleave", ondragleave);
    document.addEventListener("paste", onpaste);
    return () => {
      document.body.removeEventListener("drop", ondrop);
      document.body.removeEventListener("dragover", ondragover);
      document.body.removeEventListener("dragleave", ondragleave);
      document.removeEventListener("paste", onpaste);
    };
  }, [handleFile, state.inkJob, state.progress, dragging]);

  // Each time new motion is started, save the start time
  // biome-ignore lint/correctness/useExhaustiveDependencies: currentMotionStartedTime should be re-set with each motion
  const currentMotionStartedTime = useMemo(() => {
    return new Date();
  }, [state.progress, state.paused]);

  const previewArea = useRef<HTMLDivElement>(null);
  const previewSize = useComponentSize(previewArea);
  const showDragTarget = !state.paths && !plan && !isLoadingFile && !isPlanning;

  const locked = state.progress !== null || dragging || !!state.inkJob;
  const inks = useMemo(() => state.paths ? availableInks(state.paths, state.planOptions) : [], [state.paths, state.planOptions]);
  const physicalConnected = !!driver?.connected && (IS_WEB || !!state.deviceInfo?.path);
  const canLive = physicalConnected && !!state.planOptions.manualPlacement && !planningError;
  const inkReady = !isPlanning && !planningError && !!plan && !isLoadingFile && state.progress === null;
  const startInk = async () => {
    const job = state.inkJob;
    if (!job || job.stage !== "ready" || !inkReady || !plan) return;
    if (job.mode === "dry-run") {
      dispatch({ type: "INK_EVENT", event: "simulate" });
      return;
    }
    if (!canLive || !driver) return;
    dispatch({ type: "INK_EVENT", event: "start" });
    try {
      if (!IS_WEB) {
        const response = await fetch("/plot/status");
        if (!response.ok || (await response.json()).plotting !== false) throw new Error("Plotter is busy.");
      }
      await driver.plot(plan);
      if (IS_WEB) dispatch({ type: "INK_EVENT", event: "finished" });
    } catch (error) {
      console.error("Ink job interrupted", error);
      dispatch({ type: "INK_EVENT", event: "interrupt" });
    }
  };
  const confirmInk = async () => {
    if (!state.inkJob || state.inkJob.stage !== "review" || !inkReady) return;
    if (state.inkJob.mode === "live") {
      if (!physicalConnected) return;
      try {
        if (!IS_WEB) {
          const response = await fetch("/plot/status");
          if (!response.ok || (await response.json()).plotting !== false) return;
        }
      } catch {
        dispatch({ type: "INK_EVENT", event: "interrupt" });
        return;
      }
    }
    dispatch({ type: "INK_EVENT", event: "confirm" });
  };
  const paper = state.planOptions.paperSize.size;
  const viewport = { width: Math.max(0, previewSize.width - 88), height: Math.max(0, previewSize.height - 88) };
  const changeZoom = (value: number) => setZoom(Math.max(0.5, Math.min(4, value)));
  const resetView = () => {
    setZoom(1);
    previewArea.current?.scrollTo(0, 0);
  };

  return (
    <DispatchContext.Provider value={dispatch}>
      <div className={`root studio ${state.connected ? "connected" : "disconnected"}`} data-theme={theme}>
        <header className="studio-header">
          <div className="studio-brand">whiteaxe<span>.</span><small>STUDIO</small></div>
          <div className="file-controls">
            <button type="button" className="open-file studio-tool" disabled={locked || isLoadingFile} onClick={() => fileInput.current?.click()}>
              <svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16" fill="none"><path d="M2.5 5.5h5l1.6 2H17l-2 8H2.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" fill="none"/></svg> Open SVG
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".svg,image/svg+xml"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
                e.target.value = "";
              }}
            />
            <span className="file-name" title={fileName ?? "No artwork loaded"}>{fileName ?? "Untitled"}</span>
          </div>
          <div className="header-right">
            <div className="connection-status">
              <span className={`connection-dot ${driver?.connected && (IS_WEB || state.deviceInfo?.path) ? "is-connected" : ""}`} />
              <span>{driver?.connected && (IS_WEB || state.deviceInfo?.path) ? "Connected" : "No plotter"}</span>
              {IS_WEB && <PortSelector driver={driver} setDriver={setDriver} hardware={(driver as WebSerialDriver)?.ebb?.hardware ?? state.planOptions.hardware} />}
            </div>
            <button type="button" className="theme-toggle" aria-label="Toggle theme" onClick={() => {
              const next = theme === "light" ? "dark" : "light";
              setTheme(next);
              window.localStorage.setItem("whiteaxe-theme", next);
            }}>{theme === "light" ? "☾" : "☀"}</button>
          </div>
        </header>
        <main className="studio-workspace">
          <section className="canvas-workspace" aria-label="Artwork workspace">
            <div className="canvas-toolbar">
              <div className="preview-mode-toggle">
                <select
                  aria-label="Preview mode"
                  value={state.visualizationOptions.previewMode}
                  onChange={(e) => dispatch({ type: "SET_VISUALIZATION_OPTION", value: { previewMode: e.target.value === "plot" ? "plot" : "artwork" } })}
                >
                  <option value="artwork">Artwork</option>
                  <option value="plot">Plot preview</option>
                </select>
              </div>
              <div className="view-controls">
                <button type="button" className="studio-tool" aria-pressed={!panMode} disabled={dragging} onClick={() => setPanMode(false)} title="Move artwork in Manual mode"><svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16"><path d="M10 2v16M2 10h16M7 5l3-3 3 3M7 15l3 3 3-3M5 7l-3 3 3 3M15 7l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round"/></svg>Move</button>
                <button type="button" className="studio-tool" aria-pressed={panMode} disabled={dragging} onClick={() => setPanMode(true)} title="Pan the viewport without moving artwork"><svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16"><path d="M5 10V5a1 1 0 0 1 2 0v4-6a1 1 0 0 1 2 0v6-5a1 1 0 0 1 2 0v5-3a1 1 0 0 1 2 0v6l2-2c1-1 2 0 1 1l-3 5H7l-4-5c-1-2 1-2 2-1z" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round"/></svg>Pan</button>
              </div>
              <div className="zoom-controls">
                <button type="button" aria-label="Zoom out" disabled={dragging || zoom <= 0.5} onClick={() => changeZoom(zoom / 1.25)}>−</button>
                <span className="zoom-value">{Math.round(zoom * 100)}%</span>
                <button type="button" aria-label="Zoom in" disabled={dragging || zoom >= 4} onClick={() => changeZoom(zoom * 1.25)}>+</button>
                <button type="button" disabled={dragging} onClick={resetView}>Fit view</button>
              </div>
            </div>
            <div
              className={`preview-area ${panMode ? "pan-mode" : ""}`}
              ref={previewArea}
              onPointerDown={(e) => {
                if (!panMode || e.button !== 0 || !state.paths) return;
                const el = e.currentTarget;
                panStart.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
                el.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                const start = panStart.current;
                if (!start) return;
                e.currentTarget.scrollLeft = start.left + start.x - e.clientX;
                e.currentTarget.scrollTop = start.top + start.y - e.clientY;
              }}
              onPointerUp={() => { panStart.current = null; }}
              onPointerCancel={() => { panStart.current = null; }}
              onLostPointerCapture={() => { panStart.current = null; }}
            >
              <div className="canvas-stage" style={{
                width: Math.max(previewSize.width, viewport.width * zoom + 88),
                height: Math.max(previewSize.height, viewport.height * zoom + 88),
              }}>
                <PlanPreview state={state} previewSize={{ width: viewport.width * zoom, height: viewport.height * zoom }} plan={plan} onDragging={setDragging} allowDrag={!panMode && !state.inkJob} />
                <PlanLoader isPlanning={isPlanning} isLoadingFile={isLoadingFile} />
                {showDragTarget && (
                  <div className="drag-target">
                    <div className="drag-target-message">
                      <div className="empty-icon" aria-hidden="true">↗</div>
                      <strong>Start with an artwork</strong>
                      <span>Drop an SVG here, or open a file.</span>
                      <button type="button" onClick={() => fileInput.current?.click()}>Upload SVG</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <footer className="canvas-status">
              <span>{paper.x.toFixed(1)} × {paper.y.toFixed(1)} mm</span>
              <span>{state.paths ? `${state.paths.length} source paths` : "No artwork"}</span>
              <span>{panMode ? "Pan view" : state.planOptions.manualPlacement ? "Drag to position" : "Fit / original placement"}</span>
            </footer>
          </section>
          <aside className="control-panel" aria-label="Inspector">
            <div className="inspector-title">Inspector <span>DOCUMENT</span></div>
            <div className="inspector-scroll">
              <fieldset className="plot-settings" disabled={locked}>
                <section className="inspector-section">
                  <div className="section-header">Paper & placement</div>
                  <div className="section-body">
                    <PaperConfig state={state} />
                    <PlacementControls state={state} />
                  </div>
                </section>
                <section className="inspector-section">
                  <div className="section-header">Layers</div>
                  <div className="section-body"><LayerSelector state={state} /></div>
                </section>
                <details className="inspector-section advanced-settings">
                  <summary className="section-header">Advanced settings</summary>
                  <div className="section-body">
                    <PlanConfig state={state} />
                    <OriginOptions state={state} />
                    <VisualizationOptions state={state} />
                  </div>
                </details>
                <details className="inspector-section pen-settings">
                  <summary className="section-header">Pen & machine</summary>
                  <div className="section-body">
                    <fieldset className="device-controls" disabled={!driver?.connected || (!IS_WEB && !state.deviceInfo?.path)}>
                      <PenHeight state={state} driver={driver} />
                      <MotorControl driver={driver} />
                    </fieldset>
                    <HardwareOptions state={state} driver={driver} />
                    <ResetToDefaultsButton />
                  </div>
                </details>
              </fieldset>
              {!state.inkJob && state.paths && (
                <details className="inspector-section ink-settings">
                  <summary className="section-header">Multicolor sequence</summary>
                  <div className="section-body">
                    {state.planOptions.layerMode !== "stroke" ? (
                      <div className="ink-caption">Choose stroke layers for pen changes. Mixed groups are not treated as one ink.
                        <button type="button" disabled={locked} onClick={() => dispatch({ type: "SET_PLAN_OPTION", value: { layerMode: "stroke" } })}>Use stroke layers</button>
                      </div>
                    ) : inks.length < 2 ? <div className="ink-caption">Select at least two drawable colors.</div> : (
                      <InkQueueSetup key={JSON.stringify(inks)} inks={inks} canLive={canLive} disabled={locked || isPlanning || !!planningError || isLoadingFile} />
                    )}
                  </div>
                </details>
              )}
            </div>
            <div className="control-panel-bottom">
              <div className="section-header">Plot job</div>
              <div className="section-body section-body__plot">
                <PlanStatistics plan={plan} />
                <TimeLeft plan={plan} progress={state.progress} currentMotionStartedTime={currentMotionStartedTime} paused={state.paused} />
                {planningError && <div className="placement-error" role="alert">{planningError}</div>}
                {state.inkJob && <InkJobPanel job={state.inkJob} ready={inkReady} onStart={() => void startInk()} onConfirm={() => void confirmInk()} />}
                <PlotButtons plan={plan} isPlanning={isPlanning || dragging} state={state} driver={driver} blocked={!!planningError || isLoadingFile} />
              </div>
            </div>
          </aside>
        </main>
      </div>
    </DispatchContext.Provider>
  );
}

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
// biome-ignore lint/style/noNonNullAssertion: static element
createRoot(document.getElementById("app")!).render(<Root />);

/**
 * Read an SVG string and transform it to a list of Path.
 * @param svgString Raw SVG String
 * @returns A list of obj
 */
function readSvg(svgString: string): Path[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, "image/svg+xml");

  const svg = doc.querySelector("svg");
  // flattenSVG relies on getCTM(), which returns null on elements that aren't
  // part of a rendered document. Without it, the viewBox -> width/height
  // scaling is lost and drawings with a viewBox come out the wrong size, so
  // temporarily attach the SVG off-screen while flattening.
  const container = document.createElement("div");
  container.style.position = "absolute";
  container.style.left = "99999px";
  document.body.appendChild(container);
  try {
    container.appendChild(document.importNode(svg, true));
    return flattenSVG(container.querySelector("svg"));
  } finally {
    container.remove();
  }
}
