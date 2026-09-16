import { MarkerType } from "reactflow";
import { getNodeStyle } from "../components/Nodes";
import {
  GraphNode,
  GraphEdge,
  GraphNodeData,
  AttributeData,
  AttributeNodeInfo,
} from "./types";
import {
  ATTRIBUTE_VERTICAL_MARGIN,
  ATTRIBUTE_VERTICAL_SPACING,
  ATTRIBUTE_HORIZONTAL_SPACING,
  REM_NODE_HEIGHT_ESTIMATE,
  ATTRIBUTE_NODE_HEIGHT_ESTIMATE,
  REM_SOURCE_BOTTOM_HANDLE,
  ATTRIBUTE_SOURCE_BOTTOM_HANDLE,
  ATTRIBUTE_SOURCE_RIGHT_HANDLE,
  ATTRIBUTE_TARGET_LEFT_HANDLE,
  getColorForNode,
  estimateNodeWidth,
  compareByHierarchyThenLabel,
} from "./constants";
import { attributeNodeId } from "./attributeData";

export function layoutAttributeTree(
  ownerNode: GraphNode,
  attributes: AttributeNodeInfo[],
  nodes: GraphNode[],
  edges: GraphEdge[],
  existingNodeIds: Set<string>,
  existingEdgeIds: Set<string>,
  hiddenAttributes: Set<string> | undefined,
  attributeData: AttributeData,
  collapsed: Set<string>,
  kind: "property" | "interface" | "directProperty",
  nodePositions?: Map<string, { x: number; y: number }>,
  existingAttrsCount: number = 0
) {
  const visible = hiddenAttributes ? attributes.filter((info) => !hiddenAttributes.has(info.id)) : attributes;
  if (visible.length === 0) return;
  const sorted = [...visible].sort(compareByHierarchyThenLabel);
  const ownerData = ownerNode.data as GraphNodeData;
  const ownerStyleWidth = ownerNode.style?.width;
  const ownerWidth =
    typeof ownerStyleWidth === "number" ? ownerStyleWidth : estimateNodeWidth(ownerData.label, ownerData.kind);
  const ownerStyleHeight = ownerNode.style?.height;
  const ownerHeight =
    typeof ownerStyleHeight === "number"
      ? ownerStyleHeight
      : ownerData.kind === "rem"
        ? REM_NODE_HEIGHT_ESTIMATE
        : ATTRIBUTE_NODE_HEIGHT_ESTIMATE;
  const baseY = ownerNode.position.y + ownerHeight + ATTRIBUTE_VERTICAL_MARGIN + existingAttrsCount * ATTRIBUTE_VERTICAL_SPACING;
  sorted.forEach((info, index) => {
    const nodeId = attributeNodeId(kind, info.id);
    if (existingNodeIds.has(nodeId)) return;
    let posX = ownerNode.position.x + 150;
    let posY = baseY + index * ATTRIBUTE_VERTICAL_SPACING;
    const storedPos = nodePositions?.get(nodeId);
    if (storedPos) {
      posX = storedPos.x;
      posY = storedPos.y;
    }
    const nodeStyle = getNodeStyle(kind, collapsed.has(info.id), false);
    const finalStyle = info.isDepthCutoff ? { ...nodeStyle, borderColor: "#e63946", borderWidth: 2 } : nodeStyle;
    nodes.push({
      id: nodeId,
      position: { x: posX, y: posY },
      data: { label: info.label, richText: info.richText, remId: info.id, kind, isDepthCutoff: info.isDepthCutoff },
      style: finalStyle,
      draggable: true,
      selectable: true,
      type: `${kind}Node`,
    });
    existingNodeIds.add(nodeId);
    const attributeGraphNode = nodes[nodes.length - 1];
    const edgeId = `attr-link:${ownerNode.id}->${info.id}`;
    if (!existingEdgeIds.has(edgeId)) {
      edges.push({
        id: edgeId,
        source: ownerNode.id,
        target: nodeId,
        sourceHandle: ownerNode.type === "remNode" ? REM_SOURCE_BOTTOM_HANDLE : ATTRIBUTE_SOURCE_BOTTOM_HANDLE,
        targetHandle: ATTRIBUTE_TARGET_LEFT_HANDLE,
        type: "randomOffset",
        markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
      });
      existingEdgeIds.add(edgeId);
    }
    if (!collapsed.has(info.id) && info.children.length > 0) {
      layoutAttributeDescendants(
        attributeGraphNode,
        info.children,
        nodes,
        edges,
        existingNodeIds,
        existingEdgeIds,
        hiddenAttributes,
        attributeData,
        collapsed,
        kind,
        nodePositions
      );
    }
  });
}

export function layoutAttributeDescendants(
  parentNode: GraphNode,
  children: AttributeNodeInfo[],
  nodes: GraphNode[],
  edges: GraphEdge[],
  existingNodeIds: Set<string>,
  existingEdgeIds: Set<string>,
  hiddenAttributes: Set<string> | undefined,
  attributeData: AttributeData,
  collapsed: Set<string>,
  kind: "property" | "interface" | "directProperty",
  nodePositions?: Map<string, { x: number; y: number }>
) {
  const visibleChildren = hiddenAttributes ? children.filter((child) => !hiddenAttributes.has(child.id)) : children;
  if (visibleChildren.length === 0) return;
  const sorted = [...visibleChildren].sort(compareByHierarchyThenLabel);
  const parentData = parentNode.data as GraphNodeData;
  const parentStyleWidth = parentNode.style?.width;
  const parentWidth =
    typeof parentStyleWidth === "number" ? parentStyleWidth : estimateNodeWidth(parentData.label, parentData.kind);
  const baseX = parentNode.position.x + parentWidth + ATTRIBUTE_HORIZONTAL_SPACING;
  const startOffset = ((sorted.length - 1) / 2) * ATTRIBUTE_VERTICAL_SPACING;
  sorted.forEach((info, index) => {
    const nodeId = attributeNodeId(kind, info.id);
    let posX = baseX;
    let posY = parentNode.position.y + index * ATTRIBUTE_VERTICAL_SPACING - startOffset;
    const storedPos = nodePositions?.get(nodeId);
    if (storedPos) {
      posX = storedPos.x;
      posY = storedPos.y;
    }
    const nodeStyle = getNodeStyle(kind, collapsed.has(info.id), false);
    const finalStyle = info.isDepthCutoff ? { ...nodeStyle, borderColor: "#e63946", borderWidth: 2 } : nodeStyle;
    let childNodeIndex = nodes.findIndex((n) => n.id === nodeId);
    let childNode = childNodeIndex >= 0 ? nodes[childNodeIndex] : null;
    const updatedData: GraphNodeData = { label: info.label, remId: info.id, kind, isDepthCutoff: info.isDepthCutoff };
    if (!childNode) {
      childNode = {
        id: nodeId,
        position: { x: posX, y: posY },
        data: updatedData,
        style: finalStyle,
        draggable: true,
        selectable: true,
        type: `${kind}Node`,
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
    const linkEdgeId = `attr-child:${parentNode.id}->${info.id}`;
    if (!existingEdgeIds.has(linkEdgeId)) {
      edges.push({
        id: linkEdgeId,
        source: parentNode.id,
        target: nodeId,
        sourceHandle: ATTRIBUTE_SOURCE_RIGHT_HANDLE,
        targetHandle: ATTRIBUTE_TARGET_LEFT_HANDLE,
        type: "randomOffset",
        markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
        style: { stroke: getColorForNode(parentNode.id), strokeDasharray: "4 2" },
      });
      existingEdgeIds.add(linkEdgeId);
    }
    if (!collapsed.has(info.id) && info.children.length > 0) {
      layoutAttributeDescendants(
        childNode,
        info.children,
        nodes,
        edges,
        existingNodeIds,
        existingEdgeIds,
        hiddenAttributes,
        attributeData,
        collapsed,
        kind,
        nodePositions
      );
    }
  });
}
