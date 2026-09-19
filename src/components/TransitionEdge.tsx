import { useCallback, useRef, useState } from "react";
import { BaseEdge, EdgeLabelRenderer, useInternalNode, useReactFlow, type Edge, type EdgeProps, type InternalNode, type Node } from "@xyflow/react";
import { circleBoundaryPoint, polarPoint, type Point } from "../engine/nodeGeometry";
import { closestTOnCurve, cubicBezierPoint, quadraticBezierPoint } from "../engine/bezier";

/**
 * Renders one transition as a "floating edge": rather than connecting through React Flow's
 * regular fixed handle positions (see StateNode.tsx — both handles are pinned dead-center and
 * invisible), it computes its own attachment points on the live boundary of the source/target
 * node circles every render (`nodeCenterAndRadius` + `useInternalNode`), which is what lets edges
 * stay correctly anchored as nodes get dragged around, and lets multiple parallel
 * edges/self-loops between the same nodes fan out at different angles instead of stacking.
 *
 * The label is draggable along the edge's own curve (not free-floating) — see the `labelT` state
 * and `handleLabelPointerMove` below, which reprojects the pointer onto the actual bezier path on
 * every move via `closestTOnCurve`, so the label can visually only ever sit on the line it's
 * labeling.
 */
export interface TransitionEdgeData {
  label: string;
  active: boolean;
  isSelfLoop: boolean;
  offsetIndex: number;
  flip: boolean;
  /** User-dragged override for where the loop sits around the node's rim (degrees, 0 = top, clockwise). Falls back to the auto-fanned lane angle when unset. */
  loopAngleDeg?: number;
  /** User-dragged override for how far the loop bulges out from the rim. Falls back to `SELF_LOOP_HEIGHT` when unset. */
  loopHeight?: number;
  /** Called while dragging the loop's apex handle, so the owner can persist the new angle/height. */
  onLoopChange?: (edgeId: string, angleDeg: number, height: number) => void;
  [key: string]: unknown;
}

export type TransitionFlowEdge = Edge<TransitionEdgeData, "transition">;

const DEFAULT_DIAMETER = 108;
const LANE_ANGLE_STEP = (12 * Math.PI) / 180;
const LANE_BOW = 26;
const SELF_LOOP_SPAN_DEG = 34;
const SELF_LOOP_GAP_DEG = 15;
const SELF_LOOP_HEIGHT = 70;
const SELF_LOOP_MIN_HEIGHT = 28;
const SELF_LOOP_MAX_HEIGHT = 260;
const SELF_LOOP_HANDLE_OFFSET = 16;

/** A node's live center and radius, read straight from React Flow's internal store rather than our own layout state — this is what makes edges track a node while it's being dragged. */
function nodeCenterAndRadius(node: InternalNode<Node>): { center: Point; radius: number } {
  const width = node.measured.width ?? DEFAULT_DIAMETER;
  const height = node.measured.height ?? DEFAULT_DIAMETER;
  return {
    center: { x: node.internals.positionAbsolute.x + width / 2, y: node.internals.positionAbsolute.y + height / 2 },
    radius: Math.min(width, height) / 2,
  };
}

interface QuadraticGeometry {
  kind: "quadratic";
  p0: Point;
  control: Point;
  p1: Point;
}

interface CubicGeometry {
  kind: "cubic";
  p0: Point;
  c1: Point;
  c2: Point;
  p1: Point;
}

type EdgeGeometryPoints = QuadraticGeometry | CubicGeometry;

/**
 * Both ends anchored on the node's own rim, centered on `angleDeg` (0 = top, clockwise) and
 * bulging out by `height`. Defaults come from the auto-fanned lane (`offsetIndex *
 * SELF_LOOP_SPAN_DEG` / `SELF_LOOP_HEIGHT`), but either can be overridden by dragging the loop's
 * apex handle — see `onLoopChange` in TransitionEdge.
 */
function selfLoopGeometry(center: Point, radius: number, angleDeg: number, height: number): CubicGeometry {
  const p1 = polarPoint(center, radius, angleDeg - SELF_LOOP_GAP_DEG);
  const p2 = polarPoint(center, radius, angleDeg + SELF_LOOP_GAP_DEG);
  const dirRad = (angleDeg * Math.PI) / 180;
  const outward = { x: Math.sin(dirRad), y: -Math.cos(dirRad) };
  const c1 = { x: p1.x + outward.x * height, y: p1.y + outward.y * height };
  const c2 = { x: p2.x + outward.x * height, y: p2.y + outward.y * height };
  return { kind: "cubic", p0: p1, c1, c2, p1: p2 };
}

/**
 * Both ends anchored on their own node's rim, rotated a few degrees per lane so parallel edges
 * between the same two nodes leave/enter at visibly different points instead of converging on one
 * spot. The rotation and bow are derived from a canonical (direction-independent) vector between
 * the two nodes so an A->B edge and a B->A edge sharing a lane bow to the same side.
 */
function parallelEdgeGeometry(
  sourceCenter: Point,
  sourceRadius: number,
  targetCenter: Point,
  targetRadius: number,
  offsetIndex: number,
  flip: boolean
): QuadraticGeometry {
  const theta = offsetIndex * LANE_ANGLE_STEP;
  const canonical: Point = flip
    ? { x: sourceCenter.x - targetCenter.x, y: sourceCenter.y - targetCenter.y }
    : { x: targetCenter.x - sourceCenter.x, y: targetCenter.y - sourceCenter.y };
  const negCanonical: Point = { x: -canonical.x, y: -canonical.y };

  const aCenter = flip ? targetCenter : sourceCenter;
  const aRadius = flip ? targetRadius : sourceRadius;
  const bCenter = flip ? sourceCenter : targetCenter;
  const bRadius = flip ? sourceRadius : targetRadius;

  const aPoint = circleBoundaryPoint(aCenter, aRadius, canonical, theta);
  const bPoint = circleBoundaryPoint(bCenter, bRadius, negCanonical, -theta);

  const sourcePoint = flip ? bPoint : aPoint;
  const targetPoint = flip ? aPoint : bPoint;

  const canonicalLen = Math.hypot(canonical.x, canonical.y) || 1;
  const perp = { x: -canonical.y / canonicalLen, y: canonical.x / canonicalLen };
  const bow = offsetIndex * LANE_BOW;
  const control = {
    x: (sourcePoint.x + targetPoint.x) / 2 + perp.x * bow,
    y: (sourcePoint.y + targetPoint.y) / 2 + perp.y * bow,
  };

  return { kind: "quadratic", p0: sourcePoint, control, p1: targetPoint };
}

/** SVG path `d` string for the geometry — what actually gets drawn. */
function pathFor(geo: EdgeGeometryPoints): string {
  return geo.kind === "quadratic"
    ? `M ${geo.p0.x} ${geo.p0.y} Q ${geo.control.x} ${geo.control.y} ${geo.p1.x} ${geo.p1.y}`
    : `M ${geo.p0.x} ${geo.p0.y} C ${geo.c1.x} ${geo.c1.y}, ${geo.c2.x} ${geo.c2.y}, ${geo.p1.x} ${geo.p1.y}`;
}

/** The exact point on the curve at parameter `t` (0 = start, 1 = end) — used both to place the label and, via closestTOnCurve, to constrain dragging it. */
function sampleAt(geo: EdgeGeometryPoints, t: number): Point {
  return geo.kind === "quadratic"
    ? quadraticBezierPoint(geo.p0, geo.control, geo.p1, t)
    : cubicBezierPoint(geo.p0, geo.c1, geo.c2, geo.p1, t);
}

export function TransitionEdge({ id, source, target, data, markerEnd }: EdgeProps<TransitionFlowEdge>) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const { screenToFlowPosition } = useReactFlow();
  const [labelT, setLabelT] = useState(0.5);
  const draggingRef = useRef(false);
  const [loopDragging, setLoopDragging] = useState(false);

  let geo: EdgeGeometryPoints | null = null;
  let selfLoopCenter: Point | null = null;
  let selfLoopRadius = 0;
  let selfLoopAngleDeg = 0;
  if (sourceNode && targetNode && data) {
    const src = nodeCenterAndRadius(sourceNode);
    const tgt = nodeCenterAndRadius(targetNode);
    if (data.isSelfLoop) {
      selfLoopCenter = src.center;
      selfLoopRadius = src.radius;
      selfLoopAngleDeg = data.loopAngleDeg ?? data.offsetIndex * SELF_LOOP_SPAN_DEG;
      const height = data.loopHeight ?? SELF_LOOP_HEIGHT;
      geo = selfLoopGeometry(src.center, src.radius, selfLoopAngleDeg, height);
    } else {
      geo = parallelEdgeGeometry(src.center, src.radius, tgt.center, tgt.radius, data.offsetIndex, data.flip);
    }
  }

  const handleLabelPointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    draggingRef.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handleLabelPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current || !geo) return;
      const flowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      setLabelT(closestTOnCurve((t) => sampleAt(geo, t), flowPos));
    },
    [geo, screenToFlowPosition]
  );

  const handleLabelPointerUp = useCallback((e: React.PointerEvent) => {
    draggingRef.current = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

  const handleLoopPointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setLoopDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handleLoopPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!loopDragging || !selfLoopCenter || !data?.onLoopChange) return;
      const flowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const dx = flowPos.x - selfLoopCenter.x;
      const dy = flowPos.y - selfLoopCenter.y;
      const angleDeg = (Math.atan2(dx, -dy) * 180) / Math.PI;
      const distance = Math.hypot(dx, dy);
      const height = Math.min(SELF_LOOP_MAX_HEIGHT, Math.max(SELF_LOOP_MIN_HEIGHT, distance - selfLoopRadius));
      data.onLoopChange(id, angleDeg, height);
    },
    [data, id, loopDragging, screenToFlowPosition, selfLoopCenter, selfLoopRadius]
  );

  const handleLoopPointerUp = useCallback((e: React.PointerEvent) => {
    setLoopDragging(false);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

  if (!data || !geo) return null;
  const active = data.active;
  const path = pathFor(geo);
  const labelPoint = sampleAt(geo, labelT);
  let loopHandlePoint: Point | null = null;
  if (data.isSelfLoop) {
    const apex = sampleAt(geo, 0.5);
    const dirRad = (selfLoopAngleDeg * Math.PI) / 180;
    const outward = { x: Math.sin(dirRad), y: -Math.cos(dirRad) };
    loopHandlePoint = { x: apex.x + outward.x * SELF_LOOP_HANDLE_OFFSET, y: apex.y + outward.y * SELF_LOOP_HANDLE_OFFSET };
  }

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        className={`transition-edge${active || loopDragging ? " transition-edge--active" : ""}`}
      />
      <EdgeLabelRenderer>
        <div
          className={`transition-edge__label nopan nodrag${active ? " transition-edge__label--active" : ""}`}
          style={{ transform: `translate(-50%, -50%) translate(${labelPoint.x}px, ${labelPoint.y}px)` }}
          onPointerDown={handleLabelPointerDown}
          onPointerMove={handleLabelPointerMove}
          onPointerUp={handleLabelPointerUp}
          title="Drag along the edge"
        >
          {data.label}
        </div>
        {loopHandlePoint && (
          <div
            className={`transition-edge__loop-handle nopan nodrag${loopDragging ? " transition-edge__loop-handle--active" : ""}`}
            style={{ transform: `translate(-50%, -50%) translate(${loopHandlePoint.x}px, ${loopHandlePoint.y}px)` }}
            onPointerDown={handleLoopPointerDown}
            onPointerMove={handleLoopPointerMove}
            onPointerUp={handleLoopPointerUp}
            title="Drag to move the loop around the node or stretch it out"
          />
        )}
      </EdgeLabelRenderer>
    </>
  );
}
