import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from "@xyflow/react";
import { roundedOrthogonalPath, routeOrthogonal, type EdgeObstacle } from "../edge-geometry";

/** Identical source-to-trunk segments overlap, so siblings read as one shared branch. */
export function OrthogonalEdge({ id, sourceX, sourceY, targetX, targetY, data, markerEnd, style, label }: EdgeProps) {
  const obstacles = Array.isArray(data?.obstacles) ? data.obstacles as EdgeObstacle[] : [];
  const axis = data?.axis === "vertical" ? "vertical" : "horizontal";
  const points = data?.straight === true ? [{ x: sourceX, y: sourceY }, { x: targetX, y: targetY }] : routeOrthogonal({ x: sourceX, y: sourceY }, { x: targetX, y: targetY }, obstacles, axis);
  const path = data?.straight === true ? `M ${sourceX} ${sourceY} L ${targetX} ${targetY}` : roundedOrthogonalPath(points);
  const middle = points[Math.floor(points.length / 2)] ?? { x: (sourceX + targetX) / 2, y: (sourceY + targetY) / 2 };
  return <><BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />{label ? <EdgeLabelRenderer><span className="edge-label nodrag nopan" style={{ transform: `translate(-50%, -50%) translate(${middle.x}px,${middle.y}px)` }}>{label}</span></EdgeLabelRenderer> : null}</>;
}
