import { MarkerType } from "reactflow";
import { getNodeStyle } from "../components/Nodes";
import { GraphNode, GraphEdge, GraphNodeData, VirtualAttributeInfo } from "./types";
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
  estimateNodeWidth,
  compareByHierarchyThenLabel,
} from "./constants";
import { layoutVirtualAttributeDescendants } from "./virtualDescendants";

export function layoutVirtualAttributes(
  ownerNode: GraphNode,
  virtualAttrs: VirtualAttributeInfo[],
  existingAttrsCount: number,
  nodes: GraphNode[],
  edges: GraphEdge[],
  existingNodeIds: Set<string>,
  existingEdgeIds: Set<string>,
  kind: "property" | "interface" | "directProperty",
  collapsed: Set<string>,
  nodePositions?: Map<string, { x: number; y: number }>
) {
  if (virtualAttrs.length === 0) return;

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
  const baseY =
    ownerNode.position.y + ownerHeight + ATTRIBUTE_VERTICAL_MARGIN + existingAttrsCount * ATTRIBUTE_VERTICAL_SPACING;

  const pushVirtualNode = (
    info: VirtualAttributeInfo,
    virtualKind: GraphNodeData["kind"],
    posX: number,
    posY: number
  ) => {
    const storedPos = nodePositions?.get(info.id);
    if (storedPos) {
      posX = storedPos.x;
      posY = storedPos.y;
    }
    const hasChildren = info.children && info.children.length > 0;
    const isCollapsedItem = collapsed.has(info.id);
    const nodeStyle = getNodeStyle(virtualKind, hasChildren && isCollapsedItem, false, undefined, info.isDescriptorProperty);
    const finalStyle = info.isDepthCutoff ? { ...nodeStyle, borderColor: "#e63946", borderWidth: 2 } : nodeStyle;
    nodes.push({
      id: info.id,
      position: { x: posX, y: posY },
      data: {
        label: info.label,
        richText: info.richText,
        remId: info.id,
        kind: virtualKind,
        sourcePropertyId: info.sourcePropertyId,
        ownerRemId: info.ownerRemId,
        sourceRemLabel: info.sourceRemLabel,
        isDescriptorProperty: info.isDescriptorProperty,
        isDepthCutoff: info.isDepthCutoff,
      },
      style: finalStyle,
      draggable: true,
      selectable: true,
      type: `${virtualKind}Node`,
    });
    existingNodeIds.add(info.id);
    return { node: nodes[nodes.length - 1], hasChildren, isCollapsedItem };
  };

  const connectOwner = (targetId: string) => {
    const edgeId = `vattr-link:${ownerNode.id}->${targetId}`;
    if (existingEdgeIds.has(edgeId)) return;
    edges.push({
      id: edgeId,
      source: ownerNode.id,
      target: targetId,
      sourceHandle: ownerNode.type === "remNode" ? REM_SOURCE_BOTTOM_HANDLE : ATTRIBUTE_SOURCE_BOTTOM_HANDLE,
      targetHandle: ATTRIBUTE_TARGET_LEFT_HANDLE,
      type: "randomOffset",
      markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
      style: { stroke: "#9ca3af", strokeDasharray: "4 2" },
    });
    existingEdgeIds.add(edgeId);
  };

  if (kind === "interface") {
    const groupMap = new Map<string, { sourceRemLabel: string; minHierarchyLevel: number; items: VirtualAttributeInfo[] }>();
    for (const info of virtualAttrs) {
      const existing = groupMap.get(info.sourceRemId);
      const level = info.hierarchyLevel ?? 0;
      if (existing) {
        existing.items.push(info);
        if (level < existing.minHierarchyLevel) existing.minHierarchyLevel = level;
      } else {
        groupMap.set(info.sourceRemId, { sourceRemLabel: info.sourceRemLabel, minHierarchyLevel: level, items: [info] });
      }
    }
    const sortedGroups = [...groupMap.entries()].sort(([, a], [, b]) => {
      if (a.minHierarchyLevel !== b.minHierarchyLevel) return a.minHierarchyLevel - b.minHierarchyLevel;
      return a.sourceRemLabel.localeCompare(b.sourceRemLabel);
    });
    let slotOffset = 0;
    for (const [sourceRemId, group] of sortedGroups) {
      const groupNodeId = `vgroup:${ownerNode.id}:${sourceRemId}`;
      const sortedItems = [...group.items].sort(compareByHierarchyThenLabel);
      const groupSize = sortedItems.length;
      if (groupSize === 1) {
        const info = sortedItems[0];
        if (!existingNodeIds.has(info.id)) {
          const created = pushVirtualNode(info, "virtualInterface", ownerNode.position.x + 150, baseY + slotOffset * ATTRIBUTE_VERTICAL_SPACING);
          connectOwner(info.id);
          if (created.hasChildren && !created.isCollapsedItem) {
            layoutVirtualAttributeDescendants(created.node, info.children, nodes, edges, existingNodeIds, existingEdgeIds, kind, collapsed, nodePositions);
          }
        }
        slotOffset += 1;
        continue;
      }
      const groupCenterSlot = slotOffset + (groupSize - 1) / 2;
      let groupX = ownerNode.position.x + 150;
      let groupY = baseY + groupCenterSlot * ATTRIBUTE_VERTICAL_SPACING;
      const storedGroupPos = nodePositions?.get(groupNodeId);
      if (storedGroupPos) {
        groupX = storedGroupPos.x;
        groupY = storedGroupPos.y;
      }
      const isGroupCollapsed = collapsed.has(groupNodeId);
      let groupNode: GraphNode;
      if (!existingNodeIds.has(groupNodeId)) {
        groupNode = {
          id: groupNodeId,
          position: { x: groupX, y: groupY },
          data: {
            label: group.sourceRemLabel,
            remId: groupNodeId,
            kind: "virtualInterfaceGroup",
            sourceRemLabel: group.sourceRemLabel,
            ownerRemId: ownerNode.id,
          },
          style: getNodeStyle("virtualInterfaceGroup", isGroupCollapsed, false),
          draggable: true,
          selectable: true,
          type: "virtualInterfaceGroupNode",
        };
        nodes.push(groupNode);
        existingNodeIds.add(groupNodeId);
      } else {
        groupNode = nodes.find((n) => n.id === groupNodeId)!;
      }
      const groupEdgeId = `vgroup-link:${ownerNode.id}->${groupNodeId}`;
      if (!existingEdgeIds.has(groupEdgeId)) {
        edges.push({
          id: groupEdgeId,
          source: ownerNode.id,
          target: groupNodeId,
          sourceHandle: ownerNode.type === "remNode" ? REM_SOURCE_BOTTOM_HANDLE : ATTRIBUTE_SOURCE_BOTTOM_HANDLE,
          targetHandle: ATTRIBUTE_TARGET_LEFT_HANDLE,
          type: "randomOffset",
          markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
          style: { stroke: "#9ca3af" },
        });
        existingEdgeIds.add(groupEdgeId);
      }
      if (!isGroupCollapsed) {
        const groupWidth =
          typeof groupNode.style?.width === "number"
            ? groupNode.style.width
            : estimateNodeWidth(group.sourceRemLabel, "virtualInterfaceGroup");
        const childX = groupX + groupWidth + ATTRIBUTE_HORIZONTAL_SPACING;
        const startOffset = ((groupSize - 1) / 2) * ATTRIBUTE_VERTICAL_SPACING;
        sortedItems.forEach((info, childIndex) => {
          if (existingNodeIds.has(info.id)) return;
          const created = pushVirtualNode(info, "virtualInterface", childX, groupY + childIndex * ATTRIBUTE_VERTICAL_SPACING - startOffset);
          const childEdgeId = `vgroup-child:${groupNodeId}->${info.id}`;
          if (!existingEdgeIds.has(childEdgeId)) {
            edges.push({
              id: childEdgeId,
              source: groupNodeId,
              target: info.id,
              sourceHandle: ATTRIBUTE_SOURCE_RIGHT_HANDLE,
              targetHandle: ATTRIBUTE_TARGET_LEFT_HANDLE,
              type: "randomOffset",
              markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
              style: { stroke: "#9ca3af", strokeDasharray: "4 2" },
            });
            existingEdgeIds.add(childEdgeId);
          }
          if (created.hasChildren && !created.isCollapsedItem) {
            layoutVirtualAttributeDescendants(created.node, info.children, nodes, edges, existingNodeIds, existingEdgeIds, kind, collapsed, nodePositions);
          }
        });
      }
      slotOffset += isGroupCollapsed ? 1 : groupSize;
    }
    return;
  }

  const virtualKind = kind === "property" ? "virtualProperty" : "virtualDirectProperty";
  const groupMap = new Map<string, { baseTypeLabel: string; minHierarchyLevel: number; items: VirtualAttributeInfo[] }>();
  for (const info of virtualAttrs) {
    const groupId = info.baseTypeId ?? info.sourceRemId;
    const groupLabel = info.baseTypeLabel ?? info.sourceRemLabel;
    const existing = groupMap.get(groupId);
    const level = info.hierarchyLevel ?? 0;
    if (existing) {
      existing.items.push(info);
      if (level < existing.minHierarchyLevel) existing.minHierarchyLevel = level;
    } else {
      groupMap.set(groupId, { baseTypeLabel: groupLabel, minHierarchyLevel: level, items: [info] });
    }
  }
  const sortedGroups = [...groupMap.entries()].sort(([, a], [, b]) => {
    if (a.minHierarchyLevel !== b.minHierarchyLevel) return a.minHierarchyLevel - b.minHierarchyLevel;
    return a.baseTypeLabel.localeCompare(b.baseTypeLabel);
  });
  let slotOffset = 0;
  for (const [baseTypeId, group] of sortedGroups) {
    const groupNodeId = `vpropgroup:${ownerNode.id}:${baseTypeId}`;
    const sortedItems = [...group.items].sort(compareByHierarchyThenLabel);
    const groupSize = sortedItems.length;
    if (groupSize === 1) {
      const info = sortedItems[0];
      if (!existingNodeIds.has(info.id)) {
        const created = pushVirtualNode(info, virtualKind, ownerNode.position.x + 150, baseY + slotOffset * ATTRIBUTE_VERTICAL_SPACING);
        connectOwner(info.id);
        if (created.hasChildren && !created.isCollapsedItem) {
          layoutVirtualAttributeDescendants(created.node, info.children, nodes, edges, existingNodeIds, existingEdgeIds, kind, collapsed, nodePositions);
        }
      }
      slotOffset += 1;
      continue;
    }
    const groupCenterSlot = slotOffset + (groupSize - 1) / 2;
    let groupX = ownerNode.position.x + 150;
    let groupY = baseY + groupCenterSlot * ATTRIBUTE_VERTICAL_SPACING;
    const storedGroupPos = nodePositions?.get(groupNodeId);
    if (storedGroupPos) {
      groupX = storedGroupPos.x;
      groupY = storedGroupPos.y;
    }
    const isGroupCollapsed = collapsed.has(groupNodeId);
    let groupNode: GraphNode;
    if (!existingNodeIds.has(groupNodeId)) {
      groupNode = {
        id: groupNodeId,
        position: { x: groupX, y: groupY },
        data: {
          label: group.baseTypeLabel,
          remId: groupNodeId,
          kind: "virtualInterfaceGroup",
          sourceRemLabel: group.baseTypeLabel,
          ownerRemId: ownerNode.id,
        },
        style: getNodeStyle("virtualInterfaceGroup", isGroupCollapsed, false),
        draggable: true,
        selectable: true,
        type: "virtualInterfaceGroupNode",
      };
      nodes.push(groupNode);
      existingNodeIds.add(groupNodeId);
    } else {
      groupNode = nodes.find((n) => n.id === groupNodeId)!;
    }
    const groupEdgeId = `vpropgroup-link:${ownerNode.id}->${groupNodeId}`;
    if (!existingEdgeIds.has(groupEdgeId)) {
      edges.push({
        id: groupEdgeId,
        source: ownerNode.id,
        target: groupNodeId,
        sourceHandle: ownerNode.type === "remNode" ? REM_SOURCE_BOTTOM_HANDLE : ATTRIBUTE_SOURCE_BOTTOM_HANDLE,
        targetHandle: ATTRIBUTE_TARGET_LEFT_HANDLE,
        type: "randomOffset",
        markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
        style: { stroke: "#9ca3af" },
      });
      existingEdgeIds.add(groupEdgeId);
    }
    if (!isGroupCollapsed) {
      const groupWidth =
        typeof groupNode.style?.width === "number"
          ? groupNode.style.width
          : estimateNodeWidth(group.baseTypeLabel, "virtualInterfaceGroup");
      const childX = groupX + groupWidth + ATTRIBUTE_HORIZONTAL_SPACING;
      const startOffset = ((groupSize - 1) / 2) * ATTRIBUTE_VERTICAL_SPACING;
      sortedItems.forEach((info, childIndex) => {
        if (existingNodeIds.has(info.id)) return;
        const created = pushVirtualNode(info, virtualKind, childX, groupY + childIndex * ATTRIBUTE_VERTICAL_SPACING - startOffset);
        const childEdgeId = `vpropgroup-child:${groupNodeId}->${info.id}`;
        if (!existingEdgeIds.has(childEdgeId)) {
          edges.push({
            id: childEdgeId,
            source: groupNodeId,
            target: info.id,
            sourceHandle: ATTRIBUTE_SOURCE_RIGHT_HANDLE,
            targetHandle: ATTRIBUTE_TARGET_LEFT_HANDLE,
            type: "randomOffset",
            markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
            style: { stroke: "#9ca3af", strokeDasharray: "4 2" },
          });
          existingEdgeIds.add(childEdgeId);
        }
        if (created.hasChildren && !created.isCollapsedItem) {
          layoutVirtualAttributeDescendants(created.node, info.children, nodes, edges, existingNodeIds, existingEdgeIds, kind, collapsed, nodePositions);
        }
      });
    }
    slotOffset += isGroupCollapsed ? 1 : groupSize;
  }
}
