import React from "react";
import { BaseEdge, EdgeProps } from "@xyflow/react";

/**
 * Generates a deterministic "random" offset between 0.25 and 0.75 based on the edge ID.
 * This ensures the same edge always gets the same offset, preventing layout shifts on re-render.
 */
function getRandomOffset(edgeId: string): number {
  let hash = 0;
  for (let i = 0; i < edgeId.length; i++) {
    hash = ((hash << 5) - hash) + edgeId.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }
  // Convert to 0.10-0.75 range (10% to 75% of the distance)
  return 0.10 + (Math.abs(hash) % 1000) / 1538.46;
}

/**
 * Custom edge component that creates a stepped path with a randomized bend point.
 * Instead of bending at the midpoint (0.5), the bend occurs at a random position
 * between 10% and 75% of the horizontal distance between nodes.
 */
export function RandomOffsetEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style,
  markerEnd,
}: EdgeProps) {
  const offset = getRandomOffset(id);
  const distance = Math.abs(targetX - sourceX);
  const bendOffset = distance * offset;

  // Calculate the X position where the edge should bend
  const midX = sourceX < targetX
    ? sourceX + bendOffset
    : sourceX - bendOffset;

  // Build an SVG path:
  // - Start at source (sourceX, sourceY)
  // - Go horizontally to the bend point (midX, sourceY)
  // - Go vertically to target height (midX, targetY)
  // - Go horizontally to target (targetX, targetY)
  const path = `M ${sourceX} ${sourceY} L ${midX} ${sourceY} L ${midX} ${targetY} L ${targetX} ${targetY}`;

  return (
    <BaseEdge
      id={id}
      path={path}
      style={style}
      markerEnd={markerEnd}
    />
  );
}

/**
 * Edge types object to be passed to ReactFlow's edgeTypes prop.
 * Add more custom edge types here as needed.
 */
export const EDGE_TYPES = {
  randomOffset: RandomOffsetEdge,
};
