import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";

export interface StateNodeData {
  label: string;
  isStart: boolean;
  active: boolean;
  isError: boolean;
  [key: string]: unknown;
}

export type StateFlowNode = Node<StateNodeData, "state">;

/**
 * Both the source and target handles are pinned to the node's exact center and invisible. Edges
 * don't actually connect through these handle positions — TransitionEdge computes its own
 * boundary-anchored attachment points from each node's live center/radius (see
 * TransitionEdge.tsx's `nodeCenterAndRadius`). React Flow still requires *some* handle to exist
 * for an edge to be valid, so these exist purely to satisfy that, not to place anything visually.
 */
const centerHandleStyle: React.CSSProperties = {
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  opacity: 0,
  width: 1,
  height: 1,
  pointerEvents: "none",
};

/** A circular state node. Visual state (active/start/error) is driven entirely by `data`, computed by DiagramView — this component has no logic of its own beyond picking CSS classes. */
export function StateNode({ data }: NodeProps<StateFlowNode>) {
  return (
    <div className={`state-node${data.active ? " state-node--active" : ""}${data.isError ? " state-node--error" : ""}`}>
      <Handle type="target" position={Position.Top} id="t" style={centerHandleStyle} />
      {data.isStart && <div className="state-node__start-marker" title="Start state" />}
      <span className="state-node__label">{data.label}</span>
      <Handle type="source" position={Position.Top} id="s" style={centerHandleStyle} />
    </div>
  );
}
