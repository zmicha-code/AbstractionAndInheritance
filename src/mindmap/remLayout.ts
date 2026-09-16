import { MarkerType } from "reactflow";
import { getNodeStyle } from "../components/Nodes";
import {
  HierarchyNode,
  GraphNode,
  GraphEdge,
  GraphNodeData,
  AttributeData,
  VirtualAttributeData,
} from "./types";
import {
  REM_HORIZONTAL_SPACING,
  REM_CHILD_GAP_UNITS,
  REM_UNIT_HEIGHT_PX,
  ATTRIBUTE_VERTICAL_SPACING,
  ATTRIBUTE_HEIGHT_SPACING_FACTOR,
  ATTRIBUTE_HEIGHT_SPACING_OFFSET,
  REM_SOURCE_LEFT_HANDLE,
  REM_SOURCE_RIGHT_HANDLE,
  REM_TARGET_LEFT_HANDLE,
  REM_TARGET_RIGHT_HANDLE,
  getColorForNode,
  estimateNodeWidth,
} from "./constants";

function sortRemSiblings(children: HierarchyNode[]): HierarchyNode[] {
  return [...children].sort((a, b) => {
    const aExported = a.isExported ? 1 : 0;
    const bExported = b.isExported ? 1 : 0;
    if (aExported !== bExported) return bExported - aExported;
    return a.name.localeCompare(b.name);
  });
}

export function measureSubtreeHeight(
  node: HierarchyNode,
  cache: Map<string, number>,
  collapsed: Set<string>,
  attributeData?: AttributeData,
  hiddenAttributes?: Set<string>,
  kind?: "property" | "interface" | "directProperty",
  virtualAttributeData?: VirtualAttributeData,
  hiddenVirtualAttributes?: Set<string>
): number {
  if (cache.has(node.id)) return cache.get(node.id)!;
  let baseHeight = 1;
  if (!(collapsed.has(node.id) || !node.children?.length)) {
    const ordered = sortRemSiblings(node.children);
    let total = 0;
    for (let i = 0; i < ordered.length; i++) {
      const childHeight = measureSubtreeHeight(
        ordered[i],
        cache,
        collapsed,
        attributeData,
        hiddenAttributes,
        kind,
        virtualAttributeData,
        hiddenVirtualAttributes
      );
      total += childHeight;
      if (i < ordered.length - 1) total += REM_CHILD_GAP_UNITS;
    }
    baseHeight = Math.max(1, total);
  }
  let attributeHeight = 0;
  if (attributeData && kind && attributeData.byOwner[node.id]) {
    const attrs = attributeData.byOwner[node.id];
    const visible = hiddenAttributes ? attrs.filter((a) => !hiddenAttributes.has(a.id)) : attrs;
    attributeHeight = visible.length * (ATTRIBUTE_VERTICAL_SPACING / REM_UNIT_HEIGHT_PX);
  }
  let virtualAttributeHeight = 0;
  if (virtualAttributeData && virtualAttributeData.byOwner[node.id]) {
    const virtualAttrs = virtualAttributeData.byOwner[node.id];
    const visibleVirtual = hiddenVirtualAttributes
      ? virtualAttrs.filter((v) => !hiddenVirtualAttributes.has(v.id))
      : virtualAttrs;
    virtualAttributeHeight = visibleVirtual.length * (ATTRIBUTE_VERTICAL_SPACING / REM_UNIT_HEIGHT_PX);
  }
  const totalAttributeHeight =
    (attributeHeight + virtualAttributeHeight) * ATTRIBUTE_HEIGHT_SPACING_FACTOR + ATTRIBUTE_HEIGHT_SPACING_OFFSET;
  const result = baseHeight + totalAttributeHeight;
  cache.set(node.id, result);
  return result;
}

export function unitToY(unit: number): number {
  return unit * REM_UNIT_HEIGHT_PX;
}

export function layoutSubtreeHorizontal(
  node: HierarchyNode,
  parentNode: GraphNode,
  orientation: "left" | "right",
  relation: "ancestor" | "descendant",
  centerUnit: number,
  nodes: GraphNode[],
  edges: GraphEdge[],
  existingNodeIds: Set<string>,
  heightCache: Map<string, number>,
  collapsed: Set<string>,
  nodePositions?: Map<string, { x: number; y: number }>,
  attributeData?: AttributeData,
  hiddenAttributes?: Set<string>,
  kind?: "property" | "interface" | "directProperty",
  virtualAttributeData?: VirtualAttributeData,
  hiddenVirtualAttributes?: Set<string>
): GraphNode | null {
  if (existingNodeIds.has(node.id)) {
    return nodes.find((n) => n.id === node.id) ?? null;
  }

  const estWidth = estimateNodeWidth(node.name, "rem");
  const parentData = parentNode.data as GraphNodeData;
  const parentStyleWidth = parentNode.style?.width;
  const parentWidth =
    typeof parentStyleWidth === "number"
      ? parentStyleWidth
      : estimateNodeWidth(parentData.label, parentData.kind);

  let x =
    orientation === "right"
      ? parentNode.position.x + parentWidth + REM_HORIZONTAL_SPACING
      : parentNode.position.x - REM_HORIZONTAL_SPACING - estWidth;
  let y = unitToY(centerUnit);

  const stored = nodePositions?.get(node.id);
  if (stored) {
    x = stored.x;
    y = stored.y;
  }

  const style = getNodeStyle("rem", collapsed.has(node.id), false, undefined, undefined, node.isExported);
  const graphNode: GraphNode = {
    id: node.id,
    position: { x, y },
    data: { label: node.name, richText: node.richText, remId: node.id, kind: "rem", isExported: node.isExported },
    style,
    draggable: true,
    selectable: true,
    type: "remNode",
  };

  nodes.push(graphNode);
  existingNodeIds.add(node.id);

  const parentId = parentNode.id;
  const edgeId = relation === "ancestor" ? `${node.id}->${parentId}` : `${parentId}->${node.id}`;

  let sourceHandle: string;
  let targetHandle: string;
  if (orientation === "right") {
    if (relation === "ancestor") {
      sourceHandle = REM_SOURCE_LEFT_HANDLE;
      targetHandle = REM_TARGET_RIGHT_HANDLE;
    } else {
      sourceHandle = REM_SOURCE_RIGHT_HANDLE;
      targetHandle = REM_TARGET_LEFT_HANDLE;
    }
  } else if (relation === "ancestor") {
    sourceHandle = REM_SOURCE_RIGHT_HANDLE;
    targetHandle = REM_TARGET_LEFT_HANDLE;
  } else {
    sourceHandle = REM_SOURCE_LEFT_HANDLE;
    targetHandle = REM_TARGET_RIGHT_HANDLE;
  }

  if (!edges.some((edge) => edge.id === edgeId)) {
    const sourceNodeId = relation === "ancestor" ? node.id : parentId;
    edges.push({
      id: edgeId,
      source: sourceNodeId,
      target: relation === "ancestor" ? parentId : node.id,
      sourceHandle,
      targetHandle,
      type: "randomOffset",
      markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
      style: { stroke: getColorForNode(sourceNodeId) },
    });
  }

  if (collapsed.has(node.id) || !node.children?.length) {
    return graphNode;
  }

  layoutChildrenHorizontal(
    node.children,
    graphNode,
    orientation,
    relation,
    nodes,
    edges,
    existingNodeIds,
    collapsed,
    nodePositions,
    heightCache,
    attributeData,
    hiddenAttributes,
    kind,
    virtualAttributeData,
    hiddenVirtualAttributes
  );
  return graphNode;
}

export function layoutChildrenHorizontal(
  children: HierarchyNode[],
  parentNode: GraphNode,
  orientation: "left" | "right",
  relation: "ancestor" | "descendant",
  nodes: GraphNode[],
  edges: GraphEdge[],
  existingNodeIds: Set<string>,
  collapsed: Set<string>,
  nodePositions?: Map<string, { x: number; y: number }>,
  heightCache: Map<string, number> = new Map(),
  attributeData?: AttributeData,
  hiddenAttributes?: Set<string>,
  kind?: "property" | "interface" | "directProperty",
  virtualAttributeData?: VirtualAttributeData,
  hiddenVirtualAttributes?: Set<string>
): void {
  if (children.length === 0) return;

  const ordered = sortRemSiblings(children);
  const parentUnit = parentNode.position.y / REM_UNIT_HEIGHT_PX;
  const heights = ordered.map((child) =>
    measureSubtreeHeight(
      child,
      heightCache,
      collapsed,
      attributeData,
      hiddenAttributes,
      kind,
      virtualAttributeData,
      hiddenVirtualAttributes
    )
  );
  const totalUnits =
    heights.reduce((sum, h) => sum + h, 0) + Math.max(0, ordered.length - 1) * REM_CHILD_GAP_UNITS;
  let currentUnit = parentUnit - totalUnits / 2;

  for (let i = 0; i < ordered.length; i++) {
    const child = ordered[i];
    const childUnits = heights[i];
    const childCenterUnit = currentUnit + childUnits / 2;
    layoutSubtreeHorizontal(
      child,
      parentNode,
      orientation,
      relation,
      childCenterUnit,
      nodes,
      edges,
      existingNodeIds,
      heightCache,
      collapsed,
      nodePositions,
      attributeData,
      hiddenAttributes,
      kind,
      virtualAttributeData,
      hiddenVirtualAttributes
    );
    currentUnit += childUnits;
    if (i < ordered.length - 1) currentUnit += REM_CHILD_GAP_UNITS;
  }
}

export function layoutForestHorizontal(
  forest: HierarchyNode[],
  parentNode: GraphNode,
  orientation: "left" | "right",
  relation: "ancestor" | "descendant",
  nodes: GraphNode[],
  edges: GraphEdge[],
  existingNodeIds: Set<string>,
  collapsed: Set<string>,
  nodePositions?: Map<string, { x: number; y: number }>,
  attributeData?: AttributeData,
  hiddenAttributes?: Set<string>,
  kind?: "property" | "interface" | "directProperty",
  virtualAttributeData?: VirtualAttributeData,
  hiddenVirtualAttributes?: Set<string>
): void {
  if (forest.length === 0) return;
  const heightCache = new Map<string, number>();
  layoutChildrenHorizontal(
    forest,
    parentNode,
    orientation,
    relation,
    nodes,
    edges,
    existingNodeIds,
    collapsed,
    nodePositions,
    heightCache,
    attributeData,
    hiddenAttributes,
    kind,
    virtualAttributeData,
    hiddenVirtualAttributes
  );
}
