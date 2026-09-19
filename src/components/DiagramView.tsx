import { useCallback, useEffect, useMemo, useState } from "react";
import { ReactFlow, ReactFlowProvider, Background, Controls, MarkerType, useNodesState, type EdgeTypes, type NodeTypes } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useAppContext } from "../state/AppContext";
import { circularLayout } from "../engine/layout";
import { computeEdgeGeometry } from "../engine/edgeGeometry";
import { StateNode, type StateFlowNode } from "./StateNode";
import { TransitionEdge, type TransitionFlowEdge } from "./TransitionEdge";
import "./DiagramView.css";

const nodeTypes: NodeTypes = { state: StateNode };
const edgeTypes: EdgeTypes = { transition: TransitionEdge };

/**
 * The actual React Flow canvas. Split from `DiagramView` only because `useNodesState` (and
 * everything else here) needs to run inside a `<ReactFlowProvider>`.
 *
 * Node positions are real React state (`useNodesState`), not derived from the machine on every
 * render — see the two effects below for why that split matters: one resets layout only when the
 * *machine itself* changes (so switching tabs or applying an edit gets a fresh circular layout),
 * the other updates only the active-state highlight as playback advances, without touching
 * position. If both were combined into one derivation, every step of playback would snap
 * user-dragged nodes back to their computed layout position.
 */
function DiagramInner() {
  const { active } = useAppContext();
  const { machine, simulation, currentStepIndex } = active;

  const currentStep = currentStepIndex >= 0 ? simulation?.steps[currentStepIndex] : undefined;
  const activeState = currentStep ? currentStep.toState ?? currentStep.fromState : machine?.startState;
  const activeTransitionId = currentStep?.transition?.id;

  const [nodes, setNodes, onNodesChange] = useNodesState<StateFlowNode>([]);
  // User-dragged self-loop adjustments (angle around the node's rim + how far it stretches out),
  // keyed by transition id. Reset alongside node layout when the machine itself changes, same as
  // dragged node positions — neither is meant to survive a fresh Apply or tab switch.
  const [loopOverrides, setLoopOverrides] = useState<Record<string, { angleDeg: number; height: number }>>({});

  const handleLoopChange = useCallback((edgeId: string, angleDeg: number, height: number) => {
    setLoopOverrides((prev) => ({ ...prev, [edgeId]: { angleDeg, height } }));
  }, []);

  // Re-layout only when the machine definition itself changes (a tab switch or a fresh Apply).
  // This intentionally does NOT depend on activeState, so user-dragged positions survive playback.
  useEffect(() => {
    setLoopOverrides({});
    if (!machine) {
      setNodes([]);
      return;
    }
    const positions = circularLayout(machine.states.map((s) => s.id));
    setNodes(
      machine.states.map((s) => ({
        id: s.id,
        type: "state",
        position: positions[s.id],
        data: { label: s.label, isStart: s.id === machine.startState, active: s.id === machine.startState, isError: Boolean(s.isError) },
      }))
    );
  }, [machine, setNodes]);

  // Update just the active-state highlight as playback advances, without touching positions.
  useEffect(() => {
    setNodes((current) => current.map((n) => ({ ...n, data: { ...n.data, active: n.id === activeState } })));
  }, [activeState, setNodes]);

  const edges: TransitionFlowEdge[] = useMemo(() => {
    if (!machine) return [];
    const geometry = computeEdgeGeometry(machine.transitions);
    return machine.transitions.map((t) => {
      const geo = geometry.get(t.id)!;
      const active = t.id === activeTransitionId;
      return {
        id: t.id,
        type: "transition",
        source: t.from,
        target: t.to,
        sourceHandle: "s",
        targetHandle: "t",
        markerEnd: { type: MarkerType.ArrowClosed, color: active ? "var(--accent)" : "var(--edge)" },
        data: {
          label: t.label ?? conditionSummary(t.condition),
          active,
          isSelfLoop: geo.isSelfLoop,
          offsetIndex: geo.offsetIndex,
          flip: geo.flip,
          loopAngleDeg: loopOverrides[t.id]?.angleDeg,
          loopHeight: loopOverrides[t.id]?.height,
          onLoopChange: handleLoopChange,
        },
        zIndex: active ? 1 : 0,
      };
    });
  }, [machine, activeTransitionId, loopOverrides, handleLoopChange]);

  if (!machine) {
    return <div className="diagram-view__empty">No valid machine loaded yet.</div>;
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      fitViewOptions={{ padding: 0.3 }}
      nodesDraggable
      nodesConnectable={false}
      elementsSelectable={false}
      nodesFocusable={false}
      edgesFocusable={false}
      edgesReconnectable={false}
      deleteKeyCode={null}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={20} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

/** Fallback edge label text when a transition has no explicit `label` — describes its ConditionSpec in plain text ("otherwise" for the catch-all "else" kind, etc.). */
function conditionSummary(condition: { type: string; value?: string; values?: string[]; pattern?: string }): string {
  switch (condition.type) {
    case "charEquals":
      return `char = ${JSON.stringify(condition.value)}`;
    case "charIn":
      return `char in ${JSON.stringify(condition.values)}`;
    case "charMatches":
      return `char ~ /${condition.pattern}/`;
    case "endOfInput":
      return "end of input";
    case "else":
      return "otherwise";
    default:
      return condition.type;
  }
}

/** Public entry point: just supplies the `ReactFlowProvider` context `DiagramInner` needs. */
export function DiagramView() {
  return (
    <ReactFlowProvider>
      <DiagramInner />
    </ReactFlowProvider>
  );
}
