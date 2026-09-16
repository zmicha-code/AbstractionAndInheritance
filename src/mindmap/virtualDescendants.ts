import { MarkerType } from "reactflow";
import { getNodeStyle } from "../components/Nodes";
import { GraphNode, GraphEdge, GraphNodeData, VirtualAttributeInfo } from "./types";
import {
  ATTRIBUTE_VERTICAL_SPACING,
  ATTRIBUTE_HORIZONTAL_SPACING,
  ATTRIBUTE_SOURCE_RIGHT_HANDLE,
  ATTRIBUTE_TARGET_LEFT_HANDLE,
  estimateNodeWidth,
  compareByHierarchyThenLabel,
} from "./constants";

export function layoutVirtualAttributeDescendants(
  parentNode: GraphNode,
  children: VirtualAttributeInfo[],
  nodes: GraphNode[],
  edges: GraphEdge[],
  existingNodeIds: Set<string>,
  existingEdgeIds: Set<string>,
  kind: "property" | "interface" | "directProperty",
  collapsed: Set<string>,
  nodePositions?: Map<string, { x: number; y: number }>
) {
  if (children.length === 0) return;

  const sorted = [...children].sort(compareByHierarchyThenLabel);
  const parentData = parentNode.data as GraphNodeData;
  const parentStyleWidth = parentNode.style?.width;
  const parentWidth =
    typeof parentStyleWidth === "number"
      ? parentStyleWidth
      : estimateNodeWidth(parentData.label, parentData.kind);
  const baseX = parentNode.position.x + parentWidth + ATTRIBUTE_HORIZONTAL_SPACING;
  const startOffset = ((sorted.length - 1) / 2) * ATTRIBUTE_VERTICAL_SPACING;

  sorted.forEach((info, index) => {
    const nodeId = info.id;
    const virtualKind = kind === "property" ? "virtualProperty" : kind === "interface" ? "virtualInterface" : "virtualDirectProperty";
    const hasChildren = info.children && info.children.length > 0;
    const isCollapsed = collapsed.has(info.id);
    let posX = baseX;
    let posY = parentNode.position.y + index * ATTRIBUTE_VERTICAL_SPACING - startOffset;
    const storedPos = nodePositions?.get(nodeId);
    if (storedPos) {
      posX = storedPos.x;
      posY = storedPos.y;
    }

    const nodeStyle = getNodeStyle(virtualKind, hasChildren && isCollapsed, false, undefined, info.isDescriptorProperty);
    const finalStyle = info.isDepthCutoff ? { ...nodeStyle, borderColor: "#e63946", borderWidth: 2 } : nodeStyle;
    let childNodeIndex = nodes.findIndex((n) => n.id === nodeId);
    let childNode = childNodeIndex >= 0 ? nodes[childNodeIndex] : null;
    const updatedData: GraphNodeData = {
      label: info.label,
      remId: info.id,
      kind: virtualKind,
      sourcePropertyId: info.sourcePropertyId,
      ownerRemId: info.ownerRemId,
      sourceRemLabel: info.sourceRemLabel,
      isDescriptorProperty: info.isDescriptorProperty,
      isDepthCutoff: info.isDepthCutoff,
    };

    if (!childNode) {
      childNode = {
        id: nodeId,
        position: { x: posX, y: posY },
        data: updatedData,
        style: finalStyle,
        draggable: true,
        selectable: true,
        type: `${virtualKind}Node`,
      };
      nodes.push(childNode);
      existingNodeIds.add(nodeId);
      childNodeIndex = nodes.length - 1;
    } else if (!storedPos) {
      childNode = { ...childNode, position: { x: posX, y: posY }, data: updatedData, style: finalStyle };
      nodes[childNodeIndex] = childNode;
    } else {
      childNode = { ...childNode, data: updatedData, style: finalStyle };
      nodes[childNodeIndex] = childNode;
    }

    existingNodeIds.add(nodeId);
    const linkEdgeId = `vattr-child:${parentNode.id}->${info.id}`;
    if (!existingEdgeIds.has(linkEdgeId)) {
      edges.push({
        id: linkEdgeId,
        source: parentNode.id,
        target: nodeId,
        sourceHandle: ATTRIBUTE_SOURCE_RIGHT_HANDLE,
        targetHandle: ATTRIBUTE_TARGET_LEFT_HANDLE,
        type: "randomOffset",
        markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
        style: { stroke: "#9ca3af", strokeDasharray: "4 2" },
      });
      existingEdgeIds.add(linkEdgeId);
    }

    if (hasChildren && !isCollapsed) {
      layoutVirtualAttributeDescendants(
        childNode,
        info.children,
        nodes,
        edges,
        existingNodeIds,
        existingEdgeIds,
        kind,
        collapsed,
        nodePositions
      );
    }
  });
}
