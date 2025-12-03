import React, { useCallback, useEffect, useState, useRef } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Node,
  Edge,
  MarkerType,
  ReactFlowInstance,
  Handle,
  Position,
  NodeProps,
  applyNodeChanges,
  NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { renderWidget, usePlugin, useTrackerPlugin, PluginRem, RNPlugin, RemType, SetRemType } from "@remnote/plugin-sdk";

import { getRemText, getParentClass, getExtendsChildren, getCleanChildren, getExtendsParents, updateDescendantPropertyReferences } from "../utils/utils";
import { EDGE_TYPES } from "../components/Edges";
import {
  REM_NODE_STYLE,
  REM_NODE_STYLE_COLLAPSED,
  REM_NODE_STYLE_CENTER,
  PROPERTY_NODE_STYLE,
  PROPERTY_NODE_STYLE_COLLAPSED,
  INTERFACE_NODE_STYLE,
  INTERFACE_NODE_STYLE_COLLAPSED,
  getNodeStyle,
} from "../components/Nodes";

type HierarchyNode = {
  id: string;
  name: string;
  remRef: PluginRem;
  children: HierarchyNode[];
};

type GraphNodeData = {
  label: string;
  remId: string;
  kind: "rem" | "property" | "interface" | "virtualProperty" | "virtualInterface";
  sourcePropertyId?: string;  // For virtual nodes: the ancestor property this inherits from
  ownerRemId?: string;        // For virtual nodes: the REM that should implement this
};

// Vertical Space Between Different Ancestor or Descendant REM Nodes
const VERTICAL_SPACING = 150; // 35
// Horizontal Space Between Ancestor and Descendant REM Nodes
const REM_HORIZONTAL_SPACING = 110; // 220
const REM_CHILD_GAP_UNITS = 0.5;
const REM_UNIT_HEIGHT_PX = VERTICAL_SPACING;
const REM_NODE_HEIGHT_ESTIMATE = 46;
const ATTRIBUTE_NODE_HEIGHT_ESTIMATE = 40;
// Vertical Space Between Rem Node and Property Nodes
const ATTRIBUTE_VERTICAL_MARGIN = 12; // 24
// Horizontal Space Between Ancestor and Descendant Property Nodes
const ATTRIBUTE_HORIZONTAL_SPACING = 47; // 160
// Vertical Space Between Different Property Nodes of One REM Node
const ATTRIBUTE_VERTICAL_SPACING = 50; // 55
// Factor to reduce attribute height contribution to subtree spacing (0 = ignore attributes, 1 = full height)
const ATTRIBUTE_HEIGHT_SPACING_FACTOR = 1;
const ATTRIBUTE_HEIGHT_SPACING_OFFSET = -1;

// Node styles are now imported from ../components/Nodes

type AttributeNodeInfo = {
  id: string;
  label: string;
  extends: string[];
  children: AttributeNodeInfo[];
};

type AttributeDetail = Omit<AttributeNodeInfo, 'children'> & {
  ownerNodeId: string;
  hasChildren: boolean;
  parentId?: string;
};

type AttributeData = {
  byOwner: Record<string, AttributeNodeInfo[]>;
  byId: Record<string, AttributeDetail>;
};

type VirtualAttributeInfo = {
  id: string;                    // Unique virtual ID (e.g., "virtual:ownerRemId:sourcePropertyId")
  label: string;                 // Same label as source property
  sourcePropertyId: string;      // The ancestor property this inherits from
  ownerRemId: string;            // The REM that should implement this
};

type VirtualAttributeData = {
  byOwner: Record<string, VirtualAttributeInfo[]>;
};

type GraphNode = Node<GraphNodeData>;
type GraphEdge = Edge;

const MINDMAP_STATE_KEY = "mindmap_widget_state";

type MindMapState = {
  loadedRemId: string;
  loadedRemName: string;
  attributeType: 'property' | 'interface';
  collapsedNodes: string[];
  hiddenAttributes: string[];
  hiddenVirtualAttributes: string[];
  nodePositions: Record<string, { x: number; y: number }>;
  historyStack: string[];
};

// Property and Interface node styles are now imported from ../components/Nodes

const REM_SOURCE_BOTTOM_HANDLE = "rem-source-bottom";
const REM_TARGET_TOP_HANDLE = "rem-target-top";
const REM_SOURCE_RIGHT_HANDLE = "rem-source-right";
const REM_SOURCE_LEFT_HANDLE = "rem-source-left";
const REM_TARGET_LEFT_HANDLE = "rem-target-left";
const REM_TARGET_RIGHT_HANDLE = "rem-target-right";
const ATTRIBUTE_TARGET_LEFT_HANDLE = "attribute-target-left";
const ATTRIBUTE_SOURCE_RIGHT_HANDLE = "attribute-source-right";
const ATTRIBUTE_SOURCE_BOTTOM_HANDLE = "attribute-source-bottom";
const ATTRIBUTE_TARGET_TOP_HANDLE = "attribute-target-top";
const ATTRIBUTE_TARGET_RIGHT_HANDLE = "attribute-target-right";

const NODE_CONTAINER_STYLE: React.CSSProperties = {
  width: '100%',
  height: '100%',
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'inherit',
  fontWeight: 'inherit',
};

const ATTRIBUTE_CONTAINER_STYLE: React.CSSProperties = {
  ...NODE_CONTAINER_STYLE,
  justifyContent: 'flex-start',
};

const HANDLE_COMMON_STYLE: React.CSSProperties = {
  width: 6,
  height: 6,
};

const NODE_VERTICAL_PADDING = 6;
const NODE_HORIZONTAL_PADDING = 10;

const TOP_HANDLE_STYLE: React.CSSProperties = {
  top: -NODE_VERTICAL_PADDING,
  left: '50%',
  transform: 'translate(-50%, -50%)',
};

const BOTTOM_HANDLE_STYLE: React.CSSProperties = {
  bottom: -NODE_VERTICAL_PADDING,
  left: '50%',
  transform: 'translate(-50%, 50%)',
};

const RIGHT_HANDLE_STYLE: React.CSSProperties = {
  right: -NODE_HORIZONTAL_PADDING,
  top: '50%',
  transform: 'translate(50%, -50%)',
};

const LEFT_HANDLE_STYLE: React.CSSProperties = {
  left: -NODE_HORIZONTAL_PADDING,
  top: '50%',
  transform: 'translate(-50%, -50%)',
};

const RIGHT_TARGET_HANDLE_STYLE: React.CSSProperties = {
  right: -NODE_HORIZONTAL_PADDING,
  top: '50%',
  transform: 'translate(50%, -50%)',
};

const BOTTOM_SOURCE_HANDLE_STYLE: React.CSSProperties = {
  bottom: -NODE_VERTICAL_PADDING,
  left: '50%',
  transform: 'translate(-50%, 50%)',
};

function getRandomColor() {
  // Generates a random hex color
  return "#" + Math.floor(Math.random()*16777215).toString(16);
}

function estimateNodeWidth(label: string, kind: 'rem' | 'property' | 'interface' | 'virtualProperty' | 'virtualInterface'): number {
  const fontSize = kind === 'rem' ? 13 : 12;
  const avgCharWidth = fontSize * 0.6;
  const textWidth = label.length * avgCharWidth;
  const padding = 2 * 10;
  const minWidth = kind === 'rem' ? 140 : 160;
  return Math.max(minWidth, textWidth + padding);
}

function RemFlowNode({ data }: NodeProps<GraphNodeData>) {
  return (
    <div style={{ ...NODE_CONTAINER_STYLE, cursor: 'pointer' }}>
      <Handle
        type="target"
        position={Position.Top}
        id={REM_TARGET_TOP_HANDLE}
        style={{ ...HANDLE_COMMON_STYLE, ...TOP_HANDLE_STYLE }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id={REM_SOURCE_BOTTOM_HANDLE}
        style={{ ...HANDLE_COMMON_STYLE, ...BOTTOM_HANDLE_STYLE }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id={REM_SOURCE_RIGHT_HANDLE}
        style={{ ...HANDLE_COMMON_STYLE, ...RIGHT_HANDLE_STYLE }}
      />
      <Handle
        type="source"
        position={Position.Left}
        id={REM_SOURCE_LEFT_HANDLE}
        style={{ ...HANDLE_COMMON_STYLE, ...LEFT_HANDLE_STYLE }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id={REM_TARGET_LEFT_HANDLE}
        style={{ ...HANDLE_COMMON_STYLE, ...LEFT_HANDLE_STYLE }}
      />
      <Handle
        type="target"
        position={Position.Right}
        id={REM_TARGET_RIGHT_HANDLE}
        style={{ ...HANDLE_COMMON_STYLE, ...RIGHT_TARGET_HANDLE_STYLE }}
      />
      <span>{data.label}</span>
    </div>
  );
}

function PropertyFlowNode({ data }: NodeProps<GraphNodeData>) {
  return (
    <div style={{ ...ATTRIBUTE_CONTAINER_STYLE, cursor: 'pointer' }}>
      <Handle
        type="target"
        position={Position.Left}
        id={ATTRIBUTE_TARGET_LEFT_HANDLE}
        style={{ ...HANDLE_COMMON_STYLE, ...LEFT_HANDLE_STYLE }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id={ATTRIBUTE_SOURCE_RIGHT_HANDLE}
        style={{ ...HANDLE_COMMON_STYLE, ...RIGHT_HANDLE_STYLE }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id={ATTRIBUTE_SOURCE_BOTTOM_HANDLE}
        style={{ ...HANDLE_COMMON_STYLE, ...BOTTOM_SOURCE_HANDLE_STYLE }}
      />
      <Handle
        type="target"
        position={Position.Right}
        id={ATTRIBUTE_TARGET_RIGHT_HANDLE}
        style={{ ...HANDLE_COMMON_STYLE, ...RIGHT_TARGET_HANDLE_STYLE }}
      />
      <Handle
        type="target"
        position={Position.Top}
        id={ATTRIBUTE_TARGET_TOP_HANDLE}
        style={{ ...HANDLE_COMMON_STYLE, ...TOP_HANDLE_STYLE }}
      />
      <span style={{ width: '100%' }}>{data.label}</span>
    </div>
  );
}

function InterfaceFlowNode({ data }: NodeProps<GraphNodeData>) {
  return (
    <div style={{ ...ATTRIBUTE_CONTAINER_STYLE, cursor: 'pointer' }}>
      <Handle
        type="target"
        position={Position.Left}
        id={ATTRIBUTE_TARGET_LEFT_HANDLE}
        style={{ ...HANDLE_COMMON_STYLE, ...LEFT_HANDLE_STYLE }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id={ATTRIBUTE_SOURCE_RIGHT_HANDLE}
        style={{ ...HANDLE_COMMON_STYLE, ...RIGHT_HANDLE_STYLE }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id={ATTRIBUTE_SOURCE_BOTTOM_HANDLE}
        style={{ ...HANDLE_COMMON_STYLE, ...BOTTOM_SOURCE_HANDLE_STYLE }}
      />
      <Handle
        type="target"
        position={Position.Right}
        id={ATTRIBUTE_TARGET_RIGHT_HANDLE}
        style={{ ...HANDLE_COMMON_STYLE, ...RIGHT_TARGET_HANDLE_STYLE }}
      />
      <Handle
        type="target"
        position={Position.Top}
        id={ATTRIBUTE_TARGET_TOP_HANDLE}
        style={{ ...HANDLE_COMMON_STYLE, ...TOP_HANDLE_STYLE }}
      />
      <span style={{ width: '100%' }}>{data.label}</span>
    </div>
  );
}

function VirtualPropertyFlowNode({ data }: NodeProps<GraphNodeData>) {
  return (
    <div style={{ ...ATTRIBUTE_CONTAINER_STYLE, cursor: 'pointer' }}>
      <Handle
        type="target"
        position={Position.Top}
        id={ATTRIBUTE_TARGET_TOP_HANDLE}
        style={{ ...HANDLE_COMMON_STYLE, ...TOP_HANDLE_STYLE }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id={ATTRIBUTE_TARGET_LEFT_HANDLE}
        style={{ ...HANDLE_COMMON_STYLE, ...LEFT_HANDLE_STYLE }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id={ATTRIBUTE_SOURCE_RIGHT_HANDLE}
        style={{ ...HANDLE_COMMON_STYLE, ...RIGHT_HANDLE_STYLE }}
      />
      <span style={{ width: '100%', fontStyle: 'italic' }}>⊕ {data.label}</span>
    </div>
  );
}

const NODE_TYPES = {
  remNode: RemFlowNode,
  propertyNode: PropertyFlowNode,
  interfaceNode: InterfaceFlowNode,
  virtualPropertyNode: VirtualPropertyFlowNode,
  virtualInterfaceNode: VirtualPropertyFlowNode,
};

async function buildAncestorNodes(
  plugin: RNPlugin,
  rem: PluginRem,
  visited: Set<string>
): Promise<HierarchyNode[]> {
  const parents = await getParentClass(plugin, rem);
  const uniqueParents = new Map<string, PluginRem>();
  for (const parent of parents) {
    if (!parent || parent._id === rem._id || visited.has(parent._id)) continue;
    uniqueParents.set(parent._id, parent);
  }

  const result: HierarchyNode[] = [];
  for (const parent of uniqueParents.values()) {
    visited.add(parent._id);
    const [name, ancestors] = await Promise.all([
      getRemText(plugin, parent),
      buildAncestorNodes(plugin, parent, visited),
    ]);
    result.push({
      id: parent._id,
      name: name || "(Untitled Rem)",
      remRef: parent,
      children: ancestors,
    });
  }

  return result;
}

async function getStructuralDescendantChildren(plugin: RNPlugin, rem: PluginRem): Promise<PluginRem[]> {
  const children = await getCleanChildren(plugin, rem);
  const meta = await Promise.all(
    children.map(async (child) => {
      const [isDoc, type] = await Promise.all([child.isDocument(), child.getType()]);
      return { child, isDoc, type };
    })
  );
  return meta
    .filter(({ isDoc, type }) => !isDoc && type !== RemType.DESCRIPTOR)
    .map(({ child } ) => child);
}

async function buildDescendantNodes(
  plugin: RNPlugin,
  rem: PluginRem,
  visited: Set<string>
): Promise<HierarchyNode[]> {
  const [extendsChildren, structuralChildren] = await Promise.all([
    getExtendsChildren(plugin, rem),
    getStructuralDescendantChildren(plugin, rem),
  ]);

  const childMap = new Map<string, PluginRem>();
  for (const child of extendsChildren) {
    if (!child || child._id === rem._id || visited.has(child._id)) continue;
    childMap.set(child._id, child);
  }
  for (const child of structuralChildren) {
    if (!child || child._id === rem._id || visited.has(child._id) || childMap.has(child._id)) continue;
    childMap.set(child._id, child);
  }

  const result: HierarchyNode[] = [];
  for (const child of childMap.values()) {
    visited.add(child._id);
    const [name, descendants] = await Promise.all([
      getRemText(plugin, child),
      buildDescendantNodes(plugin, child, visited),
    ]);
    result.push({
      id: child._id,
      name: name || "(Untitled Rem)",
      remRef: child,
      children: descendants,
    });
  }

  return result;
}

function measureSubtreeHeight(
  node: HierarchyNode,
  cache: Map<string, number>,
  collapsed: Set<string>,
  attributeData?: AttributeData,
  hiddenAttributes?: Set<string>,
  kind?: 'property' | 'interface',
  virtualAttributeData?: VirtualAttributeData,
  hiddenVirtualAttributes?: Set<string>
): number {
  if (cache.has(node.id)) return cache.get(node.id)!;
  let baseHeight = 1;
  if (collapsed.has(node.id) || !node.children?.length) {
    // baseHeight = 1;
  } else {
    let total = 0;
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      const childHeight = measureSubtreeHeight(child, cache, collapsed, attributeData, hiddenAttributes, kind, virtualAttributeData, hiddenVirtualAttributes);
      total += childHeight;
      if (i < node.children.length - 1) {
        total += REM_CHILD_GAP_UNITS;
      }
    }
    baseHeight = Math.max(1, total);
  }
  let attributeHeight = 0;
  if (attributeData && kind && attributeData.byOwner[node.id]) {
    const attrs = attributeData.byOwner[node.id];
    const visible = hiddenAttributes ? attrs.filter(a => !hiddenAttributes.has(a.id)) : attrs;
    attributeHeight = visible.length * (ATTRIBUTE_VERTICAL_SPACING / REM_UNIT_HEIGHT_PX);
  }
  // Also count visible virtual attributes
  let virtualAttributeHeight = 0;
  if (virtualAttributeData && virtualAttributeData.byOwner[node.id]) {
    const virtualAttrs = virtualAttributeData.byOwner[node.id];
    const visibleVirtual = hiddenVirtualAttributes 
      ? virtualAttrs.filter(v => !hiddenVirtualAttributes.has(v.id)) 
      : virtualAttrs;
    virtualAttributeHeight = visibleVirtual.length * (ATTRIBUTE_VERTICAL_SPACING / REM_UNIT_HEIGHT_PX);
  }
  // Apply reduction factor to attribute heights for tighter subtree spacing
  const totalAttributeHeight = (attributeHeight + virtualAttributeHeight) * ATTRIBUTE_HEIGHT_SPACING_FACTOR + ATTRIBUTE_HEIGHT_SPACING_OFFSET;
  const result = baseHeight + totalAttributeHeight;
  cache.set(node.id, result);
  return result;
}

function unitToY(unit: number): number {
  return unit * REM_UNIT_HEIGHT_PX;
}

function layoutSubtreeHorizontal(
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
  kind?: 'property' | 'interface',
  virtualAttributeData?: VirtualAttributeData,
  hiddenVirtualAttributes?: Set<string>
): GraphNode | null {
  if (existingNodeIds.has(node.id)) {
    return nodes.find((n) => n.id === node.id) ?? null;
  }

  const estWidth = estimateNodeWidth(node.name, 'rem');
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

  const style = getNodeStyle('rem', collapsed.has(node.id), false, estWidth);

  const graphNode: GraphNode = {
    id: node.id,
    position: { x, y },
    data: { label: node.name, remId: node.id, kind: "rem" },
    style,
    draggable: true,
    selectable: true,
    type: "remNode",
  };

  nodes.push(graphNode);
  existingNodeIds.add(node.id);

  const parentId = parentNode.id;
  const edgeId =
    relation === "ancestor" ? `${node.id}->${parentId}` : `${parentId}->${node.id}`;

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
  } else {
    if (relation === "ancestor") {
      sourceHandle = REM_SOURCE_RIGHT_HANDLE;
      targetHandle = REM_TARGET_LEFT_HANDLE;
    } else {
      sourceHandle = REM_SOURCE_LEFT_HANDLE;
      targetHandle = REM_TARGET_RIGHT_HANDLE;
    }
  }

  if (!edges.some((edge) => edge.id === edgeId)) {
    edges.push({
      id: edgeId,
      source: relation === "ancestor" ? node.id : parentId,
      target: relation === "ancestor" ? parentId : node.id,
      sourceHandle,
      targetHandle,
      type: "randomOffset",
      markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
      style: { stroke: getRandomColor() }
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

function layoutChildrenHorizontal(
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
  kind?: 'property' | 'interface',
  virtualAttributeData?: VirtualAttributeData,
  hiddenVirtualAttributes?: Set<string>
): void {
  if (children.length === 0) return;

  const parentUnit = parentNode.position.y / REM_UNIT_HEIGHT_PX;
  const heights = children.map((child) => measureSubtreeHeight(child, heightCache, collapsed, attributeData, hiddenAttributes, kind, virtualAttributeData, hiddenVirtualAttributes));
  const totalUnits =
    heights.reduce((sum, h) => sum + h, 0) + Math.max(0, children.length - 1) * REM_CHILD_GAP_UNITS;

  let currentUnit = parentUnit - totalUnits / 2;

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
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
    if (i < children.length - 1) {
      currentUnit += REM_CHILD_GAP_UNITS;
    }
  }
}

function layoutForestHorizontal(
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
  kind?: 'property' | 'interface',
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

function findNodeById(forest: HierarchyNode[], id: string): HierarchyNode | null {
  const stack: HierarchyNode[] = [...forest];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.id === id) return current;
    if (current.children && current.children.length > 0) {
      stack.push(...current.children);
    }
  }
  return null;
}

async function createGraphData(
  plugin: RNPlugin,
  centerId: string,
  centerLabel: string,
  ancestors: HierarchyNode[],
  descendants: HierarchyNode[],
  collapsed: Set<string>,
  attributeData: AttributeData | undefined,
  hiddenAttributes: Set<string>,
  hiddenVirtualAttributes: Set<string>,
  nodePositions: Map<string, { x: number; y: number }>,
  kind: 'property' | 'interface'
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const centerWidth = estimateNodeWidth(centerLabel, 'rem');
  const centerStored = nodePositions?.get(centerId);
  const centerGraphNode: GraphNode = {
    id: centerId,
    position: centerStored ? { ...centerStored } : { x: -centerWidth / 2, y: 0 },
    data: { label: centerLabel, remId: centerId, kind: "rem" },
    style: getNodeStyle('rem', false, true, centerWidth),
    draggable: true,
    selectable: true,
    type: "remNode",
  };

  const nodes: GraphNode[] = [centerGraphNode];
  const edges: GraphEdge[] = [];
  const existingIds = new Set<string>([centerId]);

  // Pre-compute virtual attribute data for height calculations
  // We need to build childToParentsMap first
  let virtualData: VirtualAttributeData | undefined;
  if (attributeData) {
    // Build a complete parent map for all REMs (ancestors AND descendants) by looking up their actual parents
    const childToParentsMap: Record<string, Set<string>> = {};
    
    // Collect all REM refs from a forest (ancestors or descendants)
    const collectRemRefs = (forest: HierarchyNode[]): Map<string, PluginRem> => {
      const remRefs = new Map<string, PluginRem>();
      const stack = [...forest];
      while (stack.length > 0) {
        const node = stack.pop()!;
        if (node.remRef) {
          remRefs.set(node.id, node.remRef);
        }
        if (node.children?.length) {
          stack.push(...node.children);
        }
      }
      return remRefs;
    };
    
    const ancestorRemRefs = collectRemRefs(ancestors);
    const descendantRemRefs = collectRemRefs(descendants);
    
    // Combine all REM refs (ancestors + descendants + center)
    const allRemRefs = new Map<string, PluginRem>();
    for (const [id, ref] of ancestorRemRefs) {
      allRemRefs.set(id, ref);
    }
    for (const [id, ref] of descendantRemRefs) {
      allRemRefs.set(id, ref);
    }
    
    // For each ancestor REM, look up its actual parents using getParentClass
    for (const [remId, remRef] of ancestorRemRefs) {
      const parents = await getParentClass(plugin, remRef);
      childToParentsMap[remId] = new Set(
        parents
          .filter(p => p && ancestorRemRefs.has(p._id))
          .map(p => p._id)
      );
    }
    
    // Add center's parents (the root ancestor nodes)
    childToParentsMap[centerId] = new Set(ancestors.map(a => a.id));
    
    // For each descendant REM, look up its actual parents using getParentClass
    // This properly handles multiple inheritance via "extends"
    for (const [remId, remRef] of descendantRemRefs) {
      const parents = await getParentClass(plugin, remRef);
      // Include parents that are either in ancestors, descendants, or the center
      childToParentsMap[remId] = new Set(
        parents
          .filter(p => p && (ancestorRemRefs.has(p._id) || descendantRemRefs.has(p._id) || p._id === centerId))
          .map(p => p._id)
      );
    }
    
    virtualData = buildVirtualAttributeData(attributeData, centerId, ancestors, descendants, kind, childToParentsMap);
  }

  layoutForestHorizontal(
    ancestors,
    centerGraphNode,
    "left",
    "ancestor",
    nodes,
    edges,
    existingIds,
    collapsed,
    nodePositions,
    attributeData,
    hiddenAttributes,
    kind,
    virtualData,
    hiddenVirtualAttributes
  );

  layoutForestHorizontal(
    descendants,
    centerGraphNode,
    "right",
    "descendant",
    nodes,
    edges,
    existingIds,
    collapsed,
    nodePositions,
    attributeData,
    hiddenAttributes,
    kind,
    virtualData,
    hiddenVirtualAttributes
  );

  return integrateAttributeGraph(plugin, nodes, edges, attributeData, hiddenAttributes, hiddenVirtualAttributes, collapsed, nodePositions, kind, centerId, ancestors, descendants);
}

function attributeNodeId(kind: 'property' | 'interface', attributeId: string): string {
  return `${kind}:${attributeId}`;
}

function layoutAttributeTree(
  ownerNode: GraphNode,
  attributes: AttributeNodeInfo[],
  nodes: GraphNode[],
  edges: GraphEdge[],
  existingNodeIds: Set<string>,
  existingEdgeIds: Set<string>,
  hiddenAttributes: Set<string> | undefined,
  attributeData: AttributeData,
  collapsed: Set<string>,
  kind: 'property' | 'interface',
  nodePositions?: Map<string, { x: number; y: number }>
) {
  const visible = hiddenAttributes ? attributes.filter((info) => !hiddenAttributes.has(info.id)) : attributes;
  if (visible.length === 0) return;
  const sorted = [...visible].sort((a, b) => a.label.localeCompare(b.label));
  const ownerData = ownerNode.data as GraphNodeData;
  const ownerStyleWidth = ownerNode.style?.width;
  const ownerWidth =
    typeof ownerStyleWidth === "number"
      ? ownerStyleWidth
      : estimateNodeWidth(ownerData.label, ownerData.kind);
  const ownerStyleHeight = ownerNode.style?.height;
  const ownerHeight =
    typeof ownerStyleHeight === "number"
      ? ownerStyleHeight
      : ownerData.kind === "rem"
      ? REM_NODE_HEIGHT_ESTIMATE
      : ATTRIBUTE_NODE_HEIGHT_ESTIMATE;
  const baseY = ownerNode.position.y + ownerHeight + ATTRIBUTE_VERTICAL_MARGIN;
  sorted.forEach((info, index) => {
    const nodeId = attributeNodeId(kind, info.id);
    if (existingNodeIds.has(nodeId)) return;
    const attrWidth = estimateNodeWidth(info.label, kind);
    let posX = ownerNode.position.x + ownerWidth / 2 - attrWidth / 2;
    let posY = baseY + index * ATTRIBUTE_VERTICAL_SPACING;
    const storedPos = nodePositions?.get(nodeId);
    if (storedPos) {
      posX = storedPos.x;
      posY = storedPos.y;
    }
    const nodeStyle = getNodeStyle(kind, collapsed.has(info.id), false, attrWidth);
    nodes.push({
      id: nodeId,
      position: { x: posX, y: posY },
      data: { label: info.label, remId: info.id, kind },
      style: nodeStyle,
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
        targetHandle: ATTRIBUTE_TARGET_TOP_HANDLE,
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

function layoutAttributeDescendants(
  parentNode: GraphNode,
  children: AttributeNodeInfo[],
  nodes: GraphNode[],
  edges: GraphEdge[],
  existingNodeIds: Set<string>,
  existingEdgeIds: Set<string>,
  hiddenAttributes: Set<string> | undefined,
  attributeData: AttributeData,
  collapsed: Set<string>,
  kind: 'property' | 'interface',
  nodePositions?: Map<string, { x: number; y: number }>
) {
  const visibleChildren = hiddenAttributes
    ? children.filter((child) => !hiddenAttributes.has(child.id))
    : children;
  if (visibleChildren.length === 0) return;

  const sorted = [...visibleChildren].sort((a, b) => a.label.localeCompare(b.label));
  const parentData = parentNode.data as GraphNodeData;
  const parentStyleWidth = parentNode.style?.width;
  const parentWidth =
    typeof parentStyleWidth === "number"
      ? parentStyleWidth
      : estimateNodeWidth(parentData.label, parentData.kind);
  const baseX = parentNode.position.x + parentWidth + ATTRIBUTE_HORIZONTAL_SPACING;
  const startOffset = ((sorted.length - 1) / 2) * ATTRIBUTE_VERTICAL_SPACING;

  sorted.forEach((info, index) => {
    const nodeId = attributeNodeId(kind, info.id);
    const attrWidth = estimateNodeWidth(info.label, kind);
    let posX = baseX;
    let posY = parentNode.position.y + index * ATTRIBUTE_VERTICAL_SPACING - startOffset;
    const storedPos = nodePositions?.get(nodeId);
    if (storedPos) {
      posX = storedPos.x;
      posY = storedPos.y;
    }

    const nodeStyle = getNodeStyle(kind, collapsed.has(info.id), false, attrWidth);

    let childNodeIndex = nodes.findIndex((n) => n.id === nodeId);
    let childNode = childNodeIndex >= 0 ? nodes[childNodeIndex] : null;
    const updatedData: GraphNodeData = {
      label: info.label,
      remId: info.id,
      kind,
    };

    if (!childNode) {
      childNode = {
        id: nodeId,
        position: { x: posX, y: posY },
        data: updatedData,
        style: nodeStyle,
        draggable: true,
        selectable: true,
        type: `${kind}Node`,
      };
      nodes.push(childNode);
      existingNodeIds.add(nodeId);
      childNodeIndex = nodes.length - 1;
    } else {
      if (!storedPos) {
        childNode = {
          ...childNode,
          position: { x: posX, y: posY },
          data: updatedData,
          style: nodeStyle,
        };
        nodes[childNodeIndex] = childNode;
      } else {
        childNode = {
          ...childNode,
          data: updatedData,
          style: nodeStyle,
        };
        nodes[childNodeIndex] = childNode;
      }
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
        style: { stroke: getRandomColor(), strokeDasharray: "4 2" }
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

async function integrateAttributeGraph(
  plugin: RNPlugin,
  nodes: GraphNode[],
  edges: GraphEdge[],
  attributeData?: AttributeData,
  hiddenAttributes?: Set<string>,
  hiddenVirtualAttributes?: Set<string>,
  collapsed?: Set<string>,
  nodePositions?: Map<string, { x: number; y: number }>,
  kind?: 'property' | 'interface',
  centerId?: string,
  ancestors?: HierarchyNode[],
  descendants?: HierarchyNode[]
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  if (!attributeData || !collapsed || !kind) {
    return { nodes, edges };
  }

  const existingNodeIds = new Set(nodes.map((node) => node.id));
  const existingEdgeIds = new Set(edges.map((edge) => edge.id));
  const baseNodeMap = new Map(
    nodes.filter((node) => node.data.kind === "rem").map((node) => [node.id, node])
  );

  for (const [ownerId, attributeList] of Object.entries(attributeData.byOwner)) {
    const ownerNode = baseNodeMap.get(ownerId);
    if (!ownerNode || attributeList.length === 0) {
      continue;
    }
    layoutAttributeTree(
      ownerNode,
      attributeList,
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

  // Build and layout virtual (unimplemented) attributes
  if (centerId && ancestors && descendants) {
    // Build a complete parent map for all REMs (ancestors AND descendants) by looking up their actual parents
    // This is needed because the HierarchyNode tree structure may be incomplete
    // due to the visited set preventing nodes from appearing in multiple branches
    const childToParentsMap: Record<string, Set<string>> = {};
    
    // Collect all REM refs from a forest (ancestors or descendants)
    const collectRemRefs = (forest: HierarchyNode[]): Map<string, PluginRem> => {
      const remRefs = new Map<string, PluginRem>();
      const stack = [...forest];
      while (stack.length > 0) {
        const node = stack.pop()!;
        if (node.remRef) {
          remRefs.set(node.id, node.remRef);
        }
        if (node.children?.length) {
          stack.push(...node.children);
        }
      }
      return remRefs;
    };
    
    const ancestorRemRefs = collectRemRefs(ancestors);
    const descendantRemRefs = collectRemRefs(descendants);
    
    // For each ancestor REM, look up its actual parents using getParentClass
    for (const [remId, remRef] of ancestorRemRefs) {
      const parents = await getParentClass(plugin, remRef);
      childToParentsMap[remId] = new Set(
        parents
          .filter(p => p && ancestorRemRefs.has(p._id))
          .map(p => p._id)
      );
    }
    
    // Add center's parents (the root ancestor nodes)
    childToParentsMap[centerId] = new Set(ancestors.map(a => a.id));
    
    // For each descendant REM, look up its actual parents using getParentClass
    // This properly handles multiple inheritance via "extends"
    for (const [remId, remRef] of descendantRemRefs) {
      const parents = await getParentClass(plugin, remRef);
      // Include parents that are either in ancestors, descendants, or the center
      childToParentsMap[remId] = new Set(
        parents
          .filter(p => p && (ancestorRemRefs.has(p._id) || descendantRemRefs.has(p._id) || p._id === centerId))
          .map(p => p._id)
      );
    }
    
    const virtualData = buildVirtualAttributeData(attributeData, centerId, ancestors, descendants, kind, childToParentsMap);
    
    for (const [ownerId, virtualAttrs] of Object.entries(virtualData.byOwner)) {
      const ownerNode = baseNodeMap.get(ownerId);
      if (!ownerNode || virtualAttrs.length === 0) {
        continue;
      }
      
      // Filter out hidden virtual attributes
      const visibleVirtualAttrs = hiddenVirtualAttributes
        ? virtualAttrs.filter(v => !hiddenVirtualAttributes.has(v.id))
        : virtualAttrs;
      
      if (visibleVirtualAttrs.length === 0) {
        continue;
      }
      
      // Count existing (non-hidden) attributes for this owner
      const existingAttrs = attributeData.byOwner[ownerId] || [];
      const visibleExistingCount = hiddenAttributes
        ? existingAttrs.filter(a => !hiddenAttributes.has(a.id)).length
        : existingAttrs.length;
      
      layoutVirtualAttributes(
        ownerNode,
        visibleVirtualAttrs,
        visibleExistingCount,
        nodes,
        edges,
        existingNodeIds,
        existingEdgeIds,
        kind,
        nodePositions
      );
    }
  }

  async function findClosestVisibleAncestor(attributeId: string, existingNodeIds: Set<string>, kind: 'property' | 'interface'): Promise<string | null> {
    const visited = new Set<string>();
    const queue: string[] = [attributeId];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) {
        continue;
      }
      visited.add(currentId);

      const nodeId = attributeNodeId(kind, currentId);
      if (existingNodeIds.has(nodeId)) {
        return currentId;
      }

      let currentRem: PluginRem | null = null;
      try {
        currentRem = (await plugin.rem.findOne(currentId)) as PluginRem | null;
      } catch (_) {
        currentRem = null;
      }
      if (!currentRem) {
        continue;
      }

      // If this attribute rem is not a document, its structural parent is also a candidate ancestor.
      try {
        const [parentRem, isDoc] = await Promise.all([currentRem.getParentRem(), currentRem.isDocument()]);
        if (!isDoc && parentRem && !visited.has(parentRem._id)) {
          queue.push(parentRem._id);
        }
      } catch (_) {
        // Ignore parent lookup failures
      }

      let parents: PluginRem[] = [];
      try {
        parents = await getExtendsParents(plugin, currentRem);
      } catch (_) {
        parents = [];
      }
      for (const parent of parents) {
        if (!visited.has(parent._id)) {
          queue.push(parent._id);
        }
      }
    }

    return null;
  }

  for (const detail of Object.values(attributeData.byId)) {
      // Always process every attribute, even if hidden, to ensure edges skip hidden nodes
      const childNodeId = attributeNodeId(kind, detail.id);
      // Only create edges if the child node is visible
      if (!existingNodeIds.has(childNodeId)) {
        continue;
      }
      for (const parentId of detail.extends) {
        // Find the closest visible ancestor for the parentId
        let visibleSourceId: string | null = parentId;
        if (!existingNodeIds.has(attributeNodeId(kind, parentId)) || (hiddenAttributes?.has(parentId))) {
          visibleSourceId = await findClosestVisibleAncestor(parentId, existingNodeIds, kind);
        }
        // Only create edge if the visible ancestor is not the child itself and exists
        if (visibleSourceId && visibleSourceId !== detail.id) {
          const sourceNodeId = attributeNodeId(kind, visibleSourceId);
          const edgeId = `attr-ext:${visibleSourceId}->${detail.id}`;
          if (!existingEdgeIds.has(edgeId)) {
            edges.push({
              id: edgeId,
              source: sourceNodeId,
              target: childNodeId,
              sourceHandle: ATTRIBUTE_SOURCE_RIGHT_HANDLE,
              targetHandle: ATTRIBUTE_TARGET_LEFT_HANDLE,
              type: "randomOffset",
              markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
              style: { stroke: getRandomColor(), strokeDasharray: "4 2" }
            });
            existingEdgeIds.add(edgeId);
          }
        }
      }
  }

  return { nodes, edges };
}

async function addMissingRemEdges(plugin: RNPlugin, nodes: GraphNode[], edges: GraphEdge[]): Promise<GraphEdge[]> {
  const visibleRemIds = new Set(nodes.filter(n => n.type === "remNode").map(n => n.id));
  const edgeMap = new Map(edges.map(e => [`${e.source}->${e.target}`, e.id]));
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const newEdges = [];
  for (const remId of visibleRemIds) {
    const rem = await plugin.rem.findOne(remId);
    if (!rem) continue;
    const [extendsC, structuralC] = await Promise.all([
      getExtendsChildren(plugin, rem),
      getStructuralDescendantChildren(plugin, rem)
    ]);
    const childrenIds = [...new Set([...extendsC, ...structuralC].filter(c => c).map(c => c._id).filter(id => visibleRemIds.has(id)))];
    for (const childId of childrenIds) {
      const edgeId = `${rem._id}->${childId}`;
      if (!edgeMap.has(edgeId)) {
        const sourceNode = nodeMap.get(rem._id);
        const targetNode = nodeMap.get(childId);
        let sourceHandle = REM_SOURCE_RIGHT_HANDLE;
        let targetHandle = REM_TARGET_LEFT_HANDLE;
        if (sourceNode && targetNode && sourceNode.position.x > targetNode.position.x) {
          sourceHandle = REM_SOURCE_LEFT_HANDLE;
          targetHandle = REM_TARGET_RIGHT_HANDLE;
        }
        newEdges.push({
          id: edgeId,
          source: rem._id,
          target: childId,
          sourceHandle,
          targetHandle,
          type: "randomOffset",
          markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
          style: { stroke: getRandomColor() }
        });
      }
    }
  }
  return [...edges, ...newEdges];
}

const buildDescendantOwnerMap = (descendants: HierarchyNode[]): Record<string, string> => {
  const map: Record<string, string> = {};
  const stack = [...descendants];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (!node.children || node.children.length === 0) {
      continue;
    }
    for (const child of node.children) {
      if (!(child.id in map)) {
        map[child.id] = node.id;
      }
    }
    stack.push(...node.children);
  }
  return map;
};

function collectRemsForProperties(
  center: PluginRem,
  ancestors: HierarchyNode[],
  descendants: HierarchyNode[]
): PluginRem[] {
  const remMap = new Map<string, PluginRem>();
  if (center) {
    remMap.set(center._id, center);
  }
  const stack: HierarchyNode[] = [...ancestors, ...descendants];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.remRef && !remMap.has(current.id)) {
      remMap.set(current.id, current.remRef);
    }
    if (current.children && current.children.length > 0) {
      stack.push(...current.children);
    }
  }
  return Array.from(remMap.values());
}

async function buildAttributeData(plugin: RNPlugin, rems: PluginRem[], topLevelIsDocument: boolean, skipTopLevelForId?: string): Promise<AttributeData> {
  const byOwner: Record<string, AttributeNodeInfo[]> = {};
  const byId: Record<string, AttributeDetail> = {};

  async function collectAttributes(owner: PluginRem, ownerNodeId: string, isSubAttribute: boolean = false, parentId?: string): Promise<AttributeNodeInfo[]> {
    if (!isSubAttribute && skipTopLevelForId && owner._id === skipTopLevelForId) {
      return [];
    }
    let childrenRems: PluginRem[];
    if (!isSubAttribute) {
      const children = await getCleanChildren(plugin, owner);
      if (topLevelIsDocument) {
        const docFlags = await Promise.all(children.map((child) => child.isDocument()));
        childrenRems = children.filter((_, i) => docFlags[i]);
      } else {
        childrenRems = await getStructuralDescendantChildren(plugin, owner);
      }
    } else {
      childrenRems = await getStructuralDescendantChildren(plugin, owner);
    }
    const attrs: AttributeNodeInfo[] = [];
    for (const attr of childrenRems) {
      if (skipTopLevelForId && attr._id === skipTopLevelForId) continue;
      const labelRaw = await getRemText(plugin, attr);
      const label = (labelRaw ?? "").trim() || "(Untitled Attribute)";
      let extendsIds: string[] = [];
      try {
        const parentRems = await getExtendsParents(plugin, attr);
        extendsIds = [...new Set(parentRems.map((p) => p._id))];
      } catch {}
      const subChildren = await collectAttributes(attr, attributeNodeId(topLevelIsDocument ? 'property' : 'interface', attr._id), true, attr._id);
      attrs.push({ id: attr._id, label, extends: extendsIds, children: subChildren });
    }
    attrs.sort((a, b) => a.label.localeCompare(b.label));
    attrs.forEach((p) => {
      const detail = { id: p.id, label: p.label, extends: p.extends, ownerNodeId, hasChildren: p.children.length > 0, parentId };
      if (!byId[p.id]) {
        byId[p.id] = detail;
      }
    });
    return attrs;
  }

  const uniqueRems = [...new Map(rems.map((r) => [r._id, r])).values()];
  for (const rem of uniqueRems) {
    const attrs = await collectAttributes(rem, rem._id);
    if (attrs.length > 0) byOwner[rem._id] = attrs;
  }

  return { byOwner, byId };
}

function buildVirtualAttributeData(
  attributeData: AttributeData,
  centerId: string,
  ancestors: HierarchyNode[],
  descendants: HierarchyNode[],
  kind: 'property' | 'interface',
  childToParentsMap: Record<string, Set<string>>
): VirtualAttributeData {
  const byOwner: Record<string, VirtualAttributeInfo[]> = {};

  // Build a map of which properties each REM implements (directly or via extends)
  const implementedByOwner: Record<string, Set<string>> = {};
  
  // Helper to recursively collect all property IDs that a set of attributes "implements"
  const collectImplementedIds = (attrs: AttributeNodeInfo[]): Set<string> => {
    const result = new Set<string>();
    for (const attr of attrs) {
      result.add(attr.id);
      // Also add all properties this extends from
      for (const extId of attr.extends) {
        result.add(extId);
      }
      // Recursively collect from children
      const childIds = collectImplementedIds(attr.children);
      childIds.forEach(id => result.add(id));
    }
    return result;
  };

  for (const [ownerId, attrs] of Object.entries(attributeData.byOwner)) {
    implementedByOwner[ownerId] = collectImplementedIds(attrs);
  }

  // Build ancestor chain for ALL REMs (ancestors, center, and descendants)
  const remAncestorMap: Record<string, string[]> = {};

  // Helper to collect all IDs from a forest (flattened)
  const collectAllIdsFromForest = (forest: HierarchyNode[]): string[] => {
    const ids: string[] = [];
    const stack = [...forest];
    while (stack.length > 0) {
      const node = stack.pop()!;
      ids.push(node.id);
      if (node.children?.length) {
        stack.push(...node.children);
      }
    }
    return ids;
  };

  // Get ALL ancestor IDs (flattened from the entire forest)
  const allAncestorIds = collectAllIdsFromForest(ancestors);

  // Compute the TRANSITIVE ancestors for a given node using the pre-built parent map
  // This correctly handles the DAG structure where nodes may have multiple parents
  const computeTransitiveAncestors = (nodeId: string): Set<string> => {
    const result = new Set<string>();
    const visited = new Set<string>();
    const stack = [...(childToParentsMap[nodeId] || [])];
    
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      result.add(current);
      
      const parents = childToParentsMap[current];
      if (parents) {
        for (const parent of parents) {
          if (!visited.has(parent)) {
            stack.push(parent);
          }
        }
      }
    }
    
    return result;
  };

  // Build remAncestorMap for all ancestor REMs using transitive closure
  for (const ancestorId of allAncestorIds) {
    remAncestorMap[ancestorId] = [...computeTransitiveAncestors(ancestorId)];
  }

  // Center REM gets all its transitive ancestors
  remAncestorMap[centerId] = [...computeTransitiveAncestors(centerId)];

  // For each descendant, build the ancestor chain using the proper childToParentsMap
  // This correctly handles multiple inheritance via "extends"
  const allDescendantIds = collectAllIdsFromForest(descendants);
  for (const descendantId of allDescendantIds) {
    // Use computeTransitiveAncestors which properly follows all parent relationships
    // including both structural parents and "extends" relationships
    remAncestorMap[descendantId] = [...computeTransitiveAncestors(descendantId)];
  }

  // Now for each REM, find which ancestor properties are NOT implemented
  // We need to only show the "closest" unimplemented property in the chain
  // (i.e., if ProbB extends ProbA and neither is implemented, only show ProbB)
  
  // First, build a map of property extends relationships for quick lookup
  const propertyExtendsMap: Record<string, string[]> = {};
  for (const detail of Object.values(attributeData.byId)) {
    propertyExtendsMap[detail.id] = detail.extends;
  }
  
  // Helper to get all ancestors of a property (transitive)
  const getPropertyAncestors = (propId: string): Set<string> => {
    const ancestors = new Set<string>();
    const stack = [...(propertyExtendsMap[propId] || [])];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (ancestors.has(current)) continue;
      ancestors.add(current);
      const parents = propertyExtendsMap[current] || [];
      stack.push(...parents);
    }
    return ancestors;
  };

  for (const [remId, ancestorIds] of Object.entries(remAncestorMap)) {
    const implemented = implementedByOwner[remId] || new Set<string>();
    const candidateVirtualAttrs: VirtualAttributeInfo[] = [];

    // First pass: collect all unimplemented properties as candidates
    for (const ancestorId of ancestorIds) {
      const ancestorProps = attributeData.byOwner[ancestorId] || [];
      
      // Only check top-level properties (documents under the ancestor), not their children
      for (const prop of ancestorProps) {
        // Check if this property (or something extending it) is implemented
        if (!implemented.has(prop.id)) {
          // Check if we already have a virtual node for this property on this REM
          const existingVirtual = candidateVirtualAttrs.find(v => v.sourcePropertyId === prop.id);
          if (!existingVirtual) {
            candidateVirtualAttrs.push({
              id: `virtual:${remId}:${prop.id}`,
              label: prop.label,
              sourcePropertyId: prop.id,
              ownerRemId: remId,
            });
          }
        }
      }
    }

    // Second pass: filter out properties that are ancestors of other candidates
    // (keep only the "closest" / most derived unimplemented property)
    const candidatePropertyIds = new Set(candidateVirtualAttrs.map(v => v.sourcePropertyId));
    const virtualAttrs = candidateVirtualAttrs.filter(candidate => {
      // Check if any other candidate property extends from this one
      for (const otherCandidate of candidateVirtualAttrs) {
        if (otherCandidate.sourcePropertyId === candidate.sourcePropertyId) continue;
        const otherAncestors = getPropertyAncestors(otherCandidate.sourcePropertyId);
        if (otherAncestors.has(candidate.sourcePropertyId)) {
          // This candidate is an ancestor of another candidate, so filter it out
          return false;
        }
      }
      return true;
    });

    if (virtualAttrs.length > 0) {
      byOwner[remId] = virtualAttrs;
    }
  }

  return { byOwner };
}

function layoutVirtualAttributes(
  ownerNode: GraphNode,
  virtualAttrs: VirtualAttributeInfo[],
  existingAttrsCount: number,
  nodes: GraphNode[],
  edges: GraphEdge[],
  existingNodeIds: Set<string>,
  existingEdgeIds: Set<string>,
  kind: 'property' | 'interface',
  nodePositions?: Map<string, { x: number; y: number }>
) {
  if (virtualAttrs.length === 0) return;

  const ownerData = ownerNode.data as GraphNodeData;
  const ownerStyleWidth = ownerNode.style?.width;
  const ownerWidth =
    typeof ownerStyleWidth === "number"
      ? ownerStyleWidth
      : estimateNodeWidth(ownerData.label, ownerData.kind);
  const ownerStyleHeight = ownerNode.style?.height;
  const ownerHeight =
    typeof ownerStyleHeight === "number"
      ? ownerStyleHeight
      : ownerData.kind === "rem"
      ? REM_NODE_HEIGHT_ESTIMATE
      : ATTRIBUTE_NODE_HEIGHT_ESTIMATE;

  const baseY =
    ownerNode.position.y +
    ownerHeight +
    ATTRIBUTE_VERTICAL_MARGIN +
    existingAttrsCount * ATTRIBUTE_VERTICAL_SPACING;

  const sorted = [...virtualAttrs].sort((a, b) => a.label.localeCompare(b.label));

  sorted.forEach((info, index) => {
    const nodeId = info.id;
    if (existingNodeIds.has(nodeId)) return;

    const virtualKind = kind === 'property' ? 'virtualProperty' : 'virtualInterface';
    const attrWidth = estimateNodeWidth(info.label, virtualKind);
    let posX = ownerNode.position.x + ownerWidth / 2 - attrWidth / 2;
    let posY = baseY + index * ATTRIBUTE_VERTICAL_SPACING;

    const storedPos = nodePositions?.get(nodeId);
    if (storedPos) {
      posX = storedPos.x;
      posY = storedPos.y;
    }

    const nodeStyle = getNodeStyle(virtualKind, false, false, attrWidth);

    nodes.push({
      id: nodeId,
      position: { x: posX, y: posY },
      data: {
        label: info.label,
        remId: info.id,
        kind: virtualKind,
        sourcePropertyId: info.sourcePropertyId,
        ownerRemId: info.ownerRemId,
      },
      style: nodeStyle,
      draggable: true,
      selectable: true,
      type: `${virtualKind}Node`,
    });
    existingNodeIds.add(nodeId);

    // Create edge from owner REM node to virtual property (like regular properties)
    const ownerEdgeId = `vattr-link:${ownerNode.id}->${info.id}`;
    if (!existingEdgeIds.has(ownerEdgeId)) {
      edges.push({
        id: ownerEdgeId,
        source: ownerNode.id,
        target: nodeId,
        sourceHandle: ownerNode.type === "remNode" ? REM_SOURCE_BOTTOM_HANDLE : ATTRIBUTE_SOURCE_BOTTOM_HANDLE,
        targetHandle: ATTRIBUTE_TARGET_TOP_HANDLE,
        type: "randomOffset",
        markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
        style: { stroke: "#9ca3af" }, // Grey line (no dash for owner connection)
      });
      existingEdgeIds.add(ownerEdgeId);
    }

    // Create edge from source property to virtual node (inheritance link)
    // const sourceNodeId = attributeNodeId(kind, info.sourcePropertyId);
    // if (existingNodeIds.has(sourceNodeId)) {
    //   const edgeId = `virtual-link:${info.sourcePropertyId}->${info.id}`;
    //   if (!existingEdgeIds.has(edgeId)) {
    //     edges.push({
    //       id: edgeId,
    //       source: sourceNodeId,
    //       target: nodeId,
    //       sourceHandle: ATTRIBUTE_SOURCE_RIGHT_HANDLE,
    //       targetHandle: ATTRIBUTE_TARGET_LEFT_HANDLE,
    //       type: "randomOffset",
    //       markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
    //       style: { stroke: "#9ca3af", strokeDasharray: "6 3" }, // Grey dashed line
    //     });
    //     existingEdgeIds.add(edgeId);
    //   }
    // }
  });
}

async function saveMindMapState(
  plugin: RNPlugin,
  state: MindMapState
): Promise<void> {
  try {
    await plugin.storage.setSynced(MINDMAP_STATE_KEY, state);
  } catch (err) {
    console.error("Failed to save mindmap state:", err);
  }
}

async function loadMindMapState(
  plugin: RNPlugin
): Promise<MindMapState | null> {
  try {
    const state = await plugin.storage.getSynced(MINDMAP_STATE_KEY);
    if (state && typeof state === "object" && "loadedRemId" in state) {
      return state as MindMapState;
    }
    return null;
  } catch (err) {
    console.error("Failed to load mindmap state:", err);
    return null;
  }
}

function MindmapWidget() {
  const plugin = usePlugin();

  const focusedRem = useTrackerPlugin(async (reactPlugin) => {
    return await reactPlugin.focus.getFocusedRem();
  });

  const [focusedRemName, setFocusedRemName] = useState<string>("");
  const [loadedRemName, setLoadedRemName] = useState<string>("");
  const [loadedRemId, setLoadedRemId] = useState<string>("");
  const [ancestorTrees, setAncestorTrees] = useState<HierarchyNode[]>([]);
  const [descendantTrees, setDescendantTrees] = useState<HierarchyNode[]>([]);
  const [descendantOwnerMap, setDescendantOwnerMap] = useState<Record<string, string>>({});
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(() => new Set<string>());
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [propertyData, setPropertyData] = useState<AttributeData | null>(null);
  const [interfaceData, setInterfaceData] = useState<AttributeData | null>(null);
  const [hiddenAttributes, setHiddenAttributes] = useState<Set<string>>(() => new Set<string>());
  const [hiddenVirtualAttributes, setHiddenVirtualAttributes] = useState<Set<string>>(() => new Set<string>());
  const [attributeType, setAttributeType] = useState<'property' | 'interface'>('property');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  const [historyStack, setHistoryStack] = useState<string[]>([]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; remId: string; label: string } | null>(null);
  const [virtualContextMenu, setVirtualContextMenu] = useState<{ x: number; y: number; nodeId: string; label: string; sourcePropertyId: string; ownerRemId: string } | null>(null);
  const [parentMap, setParentMap] = useState<Map<string, string>>(new Map());
  const [isInitialized, setIsInitialized] = useState<boolean>(false);

  const nodePositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const hiddenAttributeOffsetsRef = useRef<Map<string, { dx: number; dy: number }>>(new Map());

  const storePositions = useCallback((nodeList: GraphNode[]) => {
    for (const node of nodeList) {
      nodePositionsRef.current.set(node.id, {
        x: node.position.x,
        y: node.position.y,
      });
    }
  }, []);

  const focusedRemId = focusedRem?._id;

  // Save state whenever key values change
  useEffect(() => {
    if (!isInitialized || !loadedRemId) return;

    const nodePositionsObj: Record<string, { x: number; y: number }> = {};
    nodePositionsRef.current.forEach((pos, id) => {
      nodePositionsObj[id] = pos;
    });

    const stateToSave: MindMapState = {
      loadedRemId,
      loadedRemName,
      attributeType,
      collapsedNodes: Array.from(collapsedNodes),
      hiddenAttributes: Array.from(hiddenAttributes),
      hiddenVirtualAttributes: Array.from(hiddenVirtualAttributes),
      nodePositions: nodePositionsObj,
      historyStack,
    };

    saveMindMapState(plugin, stateToSave);
  }, [
    isInitialized,
    loadedRemId,
    loadedRemName,
    attributeType,
    collapsedNodes,
    hiddenAttributes,
    hiddenVirtualAttributes,
    historyStack,
    nodes,
    plugin,
  ]);

  // Load saved state on mount
  useEffect(() => {
    let cancelled = false;

    async function restoreState() {
      const savedState = await loadMindMapState(plugin);
      if (cancelled) return;

      if (savedState && savedState.loadedRemId) {
        // Restore node positions
        const positionsMap = new Map<string, { x: number; y: number }>();
        if (savedState.nodePositions) {
          Object.entries(savedState.nodePositions).forEach(([id, pos]) => {
            positionsMap.set(id, pos);
          });
        }
        nodePositionsRef.current = positionsMap;

        // Set state values that don't depend on loading
        setAttributeType(savedState.attributeType || 'property');
        setHistoryStack(savedState.historyStack || []);

        // Verify the rem still exists before trying to load
        const rem = await plugin.rem.findOne(savedState.loadedRemId);
        if (cancelled) return;

        if (rem) {
          // Load the hierarchy with the saved rem
          setLoading(true);
          setError(null);
          try {
            // Use separate visited sets to avoid race conditions between parallel builds
            const visitedAncestors = new Set<string>([rem._id]);
            const visitedDescendants = new Set<string>([rem._id]);
            const [name, ancestorTreesResult, descendantTreesResult] = await Promise.all([
              getRemText(plugin, rem),
              buildAncestorNodes(plugin, rem, visitedAncestors),
              buildDescendantNodes(plugin, rem, visitedDescendants),
            ]);

            if (cancelled) return;

            const centerLabel = name || "(Untitled Rem)";
            const remsForAttributes = collectRemsForProperties(
              rem,
              ancestorTreesResult,
              descendantTreesResult
            );
            const [properties, interfaces] = await Promise.all([
              buildAttributeData(plugin, remsForAttributes, true),
              buildAttributeData(plugin, remsForAttributes, false, rem._id),
            ]);

            if (cancelled) return;

            setAncestorTrees(ancestorTreesResult);
            setDescendantTrees(descendantTreesResult);
            setDescendantOwnerMap(buildDescendantOwnerMap(descendantTreesResult));
            setPropertyData(properties);
            setInterfaceData(interfaces);
            setLoadedRemId(rem._id);
            setLoadedRemName(centerLabel);

            // Restore collapsed and hidden from saved state
            setCollapsedNodes(new Set(savedState.collapsedNodes || []));
            setHiddenAttributes(new Set(savedState.hiddenAttributes || []));
            setHiddenVirtualAttributes(new Set(savedState.hiddenVirtualAttributes || []));

            // Build parent map
            const newParentMap = new Map<string, string>();
            const buildRemParentMap = (forest: HierarchyNode[]) => {
              const stack: { node: HierarchyNode; parent?: string }[] = forest.map((n) => ({ node: n }));
              while (stack.length) {
                const { node, parent } = stack.pop()!;
                if (parent) newParentMap.set(node.id, parent);
                node.children.forEach((child) => stack.push({ node: child, parent: node.id }));
              }
            };
            buildRemParentMap(ancestorTreesResult);
            buildRemParentMap(descendantTreesResult);

            const buildAttrParentMap = (attrs: AttributeNodeInfo[], parentNodeId: string, kind: 'property' | 'interface') => {
              attrs.forEach((p) => {
                const attrNodeId = attributeNodeId(kind, p.id);
                newParentMap.set(attrNodeId, parentNodeId);
                buildAttrParentMap(p.children, attrNodeId, kind);
              });
            };
            Object.entries(properties?.byOwner || {}).forEach(([ownerId, attrs]) => {
              buildAttrParentMap(attrs, ownerId, 'property');
            });
            Object.entries(interfaces?.byOwner || {}).forEach(([ownerId, attrs]) => {
              buildAttrParentMap(attrs, ownerId, 'interface');
            });
            setParentMap(newParentMap);
          } catch (err) {
            console.error("Error restoring mindmap state:", err);
          } finally {
            if (!cancelled) {
              setLoading(false);
            }
          }
        }
      }

      if (!cancelled) {
        setIsInitialized(true);
      }
    }

    restoreState();
    return () => {
      cancelled = true;
    };
  }, [plugin]);

  useEffect(() => {
    let cancelled = false;

    async function updateFocusedName() {
      if (!focusedRem) {
        if (!cancelled) setFocusedRemName("");
        return;
      }
      try {
        const name = await getRemText(plugin, focusedRem);
        if (!cancelled) setFocusedRemName(name || "(Untitled Rem)");
      } catch (_) {
        if (!cancelled) setFocusedRemName("");
      }
    }

    updateFocusedName();
    return () => {
      cancelled = true;
    };
  }, [plugin, focusedRem]);

  const updateGraph = useCallback(async () => {
    if (!loadedRemId) return;
    const attrData = attributeType === 'property' ? propertyData : interfaceData;
    const graph = await createGraphData(
      plugin,
      loadedRemId,
      loadedRemName || "(Untitled Rem)",
      ancestorTrees,
      descendantTrees,
      collapsedNodes,
      attrData ?? undefined,
      hiddenAttributes,
      hiddenVirtualAttributes,
      nodePositionsRef.current,
      attributeType
    );
    const updatedEdges = await addMissingRemEdges(plugin, graph.nodes, graph.edges);
    
    // Update parentMap to include virtual property nodes
    setParentMap((prevMap) => {
      const newMap = new Map(prevMap);
      for (const node of graph.nodes) {
        const data = node.data as GraphNodeData;
        if (data.kind === 'virtualProperty' || data.kind === 'virtualInterface') {
          // Virtual properties are children of their ownerRemId
          if (data.ownerRemId) {
            newMap.set(node.id, data.ownerRemId);
          }
        }
      }
      return newMap;
    });
    
    setNodes(graph.nodes);
    storePositions(graph.nodes);
    setEdges(updatedEdges);
  }, [loadedRemId, loadedRemName, ancestorTrees, descendantTrees, collapsedNodes, propertyData, interfaceData, hiddenAttributes, hiddenVirtualAttributes, plugin, storePositions, attributeType]);

  const loadHierarchy = useCallback(
    async (remId: string, ancestorsOnly?: boolean) => {
      setLoading(true);
      setError(null);
      setPropertyData(null);
      setInterfaceData(null);
      setHiddenAttributes(new Set<string>());
      setHiddenVirtualAttributes(new Set<string>());
      setEdges([]);
      try {
        const rem = await plugin.rem.findOne(remId);
        if (!rem) {
          throw new Error("Unable to load the selected rem.");
        }

        // 1.1 Collect Ancestors and Descendants
        // Use separate visited sets to avoid race conditions between parallel builds
        const visitedAncestors = new Set<string>([rem._id]);
        const visitedDescendants = new Set<string>([rem._id]);
        const [name, ancestorTreesResult, descendantTreesResult] = await Promise.all([
          getRemText(plugin, rem),
          buildAncestorNodes(plugin, rem, visitedAncestors),
          ancestorsOnly ? Promise.resolve([]) : buildDescendantNodes(plugin, rem, visitedDescendants),
        ]);

        // 1.2 Collect Properties
        const centerLabel = name || "(Untitled Rem)";
        const remsForAttributes = collectRemsForProperties(
          rem,
          ancestorTreesResult,
          descendantTreesResult
        );
        const [properties, interfaces] = await Promise.all([
          buildAttributeData(plugin, remsForAttributes, true),
          buildAttributeData(plugin, remsForAttributes, false, rem._id),
        ]);

        // 1.3
        const collapsed = new Set<string>();
        for (const detail of Object.values(properties.byId)) {
          if (detail.hasChildren) {
            collapsed.add(detail.id);
          }
        }
        for (const detail of Object.values(interfaces.byId)) {
          if (detail.hasChildren) {
            collapsed.add(detail.id);
          }
        }
        const hidden = new Set<string>();

        setAncestorTrees(ancestorTreesResult);
        setDescendantTrees(descendantTreesResult);
        setDescendantOwnerMap(buildDescendantOwnerMap(descendantTreesResult));
        setCollapsedNodes(collapsed);
        nodePositionsRef.current = new Map<string, { x: number; y: number }>();
        setPropertyData(properties);
        setInterfaceData(interfaces);
        setHiddenAttributes(hidden);
        setLoadedRemId(rem._id);
        setLoadedRemName(centerLabel);

        const newParentMap = new Map<string, string>();
        const buildRemParentMap = (forest: HierarchyNode[]) => {
          const stack: { node: HierarchyNode; parent?: string }[] = forest.map((n) => ({ node: n }));
          while (stack.length) {
            const { node, parent } = stack.pop()!;
            if (parent) newParentMap.set(node.id, parent);
            node.children.forEach((child) => stack.push({ node: child, parent: node.id }));
          }
        };
        buildRemParentMap(ancestorTreesResult);
        buildRemParentMap(descendantTreesResult);

        const buildAttrParentMap = (attrs: AttributeNodeInfo[], parentNodeId: string, kind: 'property' | 'interface') => {
          attrs.forEach((p) => {
            const attrNodeId = attributeNodeId(kind, p.id);
            newParentMap.set(attrNodeId, parentNodeId);
            buildAttrParentMap(p.children, attrNodeId, kind);
          });
        };
        Object.entries(properties?.byOwner || {}).forEach(([ownerId, attrs]) => {
          buildAttrParentMap(attrs, ownerId, 'property');
        });
        Object.entries(interfaces?.byOwner || {}).forEach(([ownerId, attrs]) => {
          buildAttrParentMap(attrs, ownerId, 'interface');
        });
        setParentMap(newParentMap);
      } catch (err) {
        console.error(err);
        setError("Failed to build inheritance hierarchy.");
      } finally {
        setLoading(false);
      }
    },
    [plugin, storePositions, updateGraph]
  );

  useEffect(() => {
    if (loadedRemId && !loading) {
      updateGraph();
    }
  }, [loadedRemId, ancestorTrees, descendantTrees, propertyData, interfaceData, collapsedNodes, hiddenAttributes, loading, updateGraph]);

  // Subtree-aware drag propagation without double-applying deltas
  const handleNodesChange = useCallback((changes) => {
    setNodes((current) => {
      const updated = applyNodeChanges(changes, current);
      const prevById = new Map(current.map((n) => [n.id, n]));
      const deltas = new Map<string, { dx: number; dy: number }>();

      // Per-node direct deltas from this change
      for (const n of updated) {
        const prev = prevById.get(n.id);
        if (!prev) continue;
        const dx = (n.position?.x ?? 0) - (prev.position?.x ?? 0);
        const dy = (n.position?.y ?? 0) - (prev.position?.y ?? 0);
        if (dx || dy) deltas.set(n.id, { dx, dy });
      }
      if (deltas.size === 0) {
        storePositions(updated);
        return updated;
      }

      // Ancestor-accumulated delta (from nodes that actually moved directly)
      const getAccumulatedDelta = (id: string): { dx: number; dy: number } | null => {
        let cur = id;
        let dx = 0, dy = 0;
        const seen = new Set<string>();
        while (parentMap.has(cur)) {
          cur = parentMap.get(cur)!;
          if (seen.has(cur)) break;
          seen.add(cur);
          const d = deltas.get(cur);
          if (d) { dx += d.dx; dy += d.dy; }
        }
        return (dx || dy) ? { dx, dy } : null;
      };

      // Build children map once
      const childrenMap = new Map<string, string[]>();
      parentMap.forEach((p, c) => {
        const list = childrenMap.get(p) ?? [];
        list.push(c);
        childrenMap.set(p, list);
      });

      // Hidden node store shifting
      const updatedIdSet = new Set(updated.map((n) => n.id));
      const shiftStoredIfHidden = (id: string, delta: { dx: number; dy: number }) => {
        if (updatedIdSet.has(id)) return; // visible => handled via rendering adjustments
        const prev = nodePositionsRef.current.get(id);
        if (prev) {
          nodePositionsRef.current.set(id, { x: prev.x + delta.dx, y: prev.y + delta.dy });
        }
      };

      // Compute "move roots": direct-move nodes with no ancestor that also directly moved
      const movedDirect = [...deltas.keys()];
      const hasMovedAncestor = (id: string) => {
        let cur = id;
        const seen = new Set<string>();
        while (parentMap.has(cur)) {
          cur = parentMap.get(cur)!;
          if (seen.has(cur)) break;
          seen.add(cur);
          if (deltas.has(cur)) return true;
        }
        return false;
      };
      const movedRoots = movedDirect.filter((id) => !hasMovedAncestor(id));

      // Propagate deltas to hidden descendants exactly once
      const shiftedHidden = new Set<string>();
      for (const rootId of movedRoots) {
        const delta = deltas.get(rootId)!;
        const stack = [...(childrenMap.get(rootId) ?? [])];
        while (stack.length) {
          const id = stack.pop()!;
          if (shiftedHidden.has(id)) continue;
          shiftedHidden.add(id);
          shiftStoredIfHidden(id, delta);
          const kids = childrenMap.get(id);
          if (kids?.length) stack.push(...kids);
        }
      }

      // Adjust visible nodes that inherit motion from any directly-moved ancestor
      let mutated = false;
      const adjusted = updated.map((node) => {
        // If this node was directly moved, ReactFlow already applied its delta
        if (deltas.has(node.id)) return node;

        // Sum deltas from moved ancestors (including owning REM for attributes via parentMap)
        const effective = getAccumulatedDelta(node.id);

        // Fallback: if an attribute somehow isn't in parentMap, inherit from its owner
        if (!effective) {
          const data = node.data as GraphNodeData | undefined;
          if (data && (data.kind === 'property' || data.kind === 'interface')) {
            const attrData = data.kind === 'property' ? propertyData : interfaceData;
            const ownerId = attrData?.byId?.[data.remId]?.ownerNodeId;
            if (ownerId) {
              const d = deltas.get(ownerId) ?? getAccumulatedDelta(ownerId);
              if (d) {
                mutated = true;
                return {
                  ...node,
                  position: { x: node.position.x + d.dx, y: node.position.y + d.dy },
                };
              }
            }
          }
          return node;
        }

        mutated = true;
        return {
          ...node,
          position: { x: node.position.x + effective.dx, y: node.position.y + effective.dy },
        };
      });

      // Persist final positions
      storePositions(mutated ? adjusted : updated);
      return mutated ? adjusted : updated;
    });
  }, [parentMap, propertyData, interfaceData, storePositions]);


  const handleLoad = useCallback(() => {
    if (!focusedRemId) {
      setError("Focus a rem before refreshing.");
      return;
    }

    if (loadedRemId && loadedRemId !== focusedRemId) {
      setHistoryStack((prev) => [...prev, loadedRemId]);
    }

    nodePositionsRef.current = new Map();
    loadHierarchy(focusedRemId);
  }, [focusedRemId, loadHierarchy]);



  const handleToggleAttributes = useCallback(async () => {
    if (!loadedRemId) {
      return;
    }
    const currentData = attributeType === 'property' ? propertyData : interfaceData;
    if (!currentData) {
      return;
    }
    const oldHiddenSize = hiddenAttributes.size;
    const oldHiddenVirtualSize = hiddenVirtualAttributes.size;
    const allHidden = oldHiddenSize > 0 || oldHiddenVirtualSize > 0;
    
    if (!allHidden) {
      // Store offsets for regular attributes before hiding
      nodes.forEach((node) => {
        const data = node.data as GraphNodeData;
        if (data?.kind === attributeType) {
          const detail = currentData.byId[data.remId];
          if (detail) {
            const ownerNode = nodes.find((n) => n.id === detail.ownerNodeId);
            if (ownerNode) {
              const dx = node.position.x - ownerNode.position.x;
              const dy = node.position.y - ownerNode.position.y;
              hiddenAttributeOffsetsRef.current.set(data.remId, { dx, dy });
            }
          }
        }
      });
    }
    
    // Toggle regular attributes
    const nextHidden = !allHidden ? new Set(Object.keys(currentData.byId)) : new Set<string>();
    
    // Toggle virtual attributes - collect all virtual attribute IDs from current nodes
    const virtualKind = attributeType === 'property' ? 'virtualProperty' : 'virtualInterface';
    const allVirtualIds = nodes
      .filter(node => {
        const data = node.data as GraphNodeData;
        return data.kind === virtualKind;
      })
      .map(node => node.id);
    
    // Also include any already-hidden virtual IDs
    const nextHiddenVirtual = !allHidden 
      ? new Set([...allVirtualIds, ...hiddenVirtualAttributes])
      : new Set<string>();
    
    const graph = await createGraphData(
      plugin,
      loadedRemId,
      loadedRemName || "(Untitled Rem)",
      ancestorTrees,
      descendantTrees,
      collapsedNodes,
      currentData,
      nextHidden,
      nextHiddenVirtual,
      nodePositionsRef.current,
      attributeType
    );
    let displayNodes = graph.nodes;
    if (allHidden && nextHidden.size === 0) {
      displayNodes = graph.nodes.map((node) => {
        const data = node.data as GraphNodeData;
        if (data.kind !== attributeType) {
          return node;
        }
        const detail = currentData.byId[data.remId];
        if (!detail) {
          return node;
        }
        const ownerNode = graph.nodes.find((n) => n.id === detail.ownerNodeId);
        if (!ownerNode) {
          return node;
        }
        const storedOffset = hiddenAttributeOffsetsRef.current.get(data.remId);
        if (storedOffset) {
          const newPos = {
            x: ownerNode.position.x + storedOffset.dx,
            y: ownerNode.position.y + storedOffset.dy,
          };
          return {
            ...node,
            position: newPos,
          };
        }
        return node;
      });
    }
    const updatedEdges = await addMissingRemEdges(plugin, displayNodes, graph.edges);
    setHiddenAttributes(nextHidden);
    setHiddenVirtualAttributes(nextHiddenVirtual);
    setNodes(displayNodes);
    storePositions(displayNodes);
    setEdges(updatedEdges);
  }, [
    attributeType,
    propertyData,
    interfaceData,
    hiddenAttributes,
    hiddenVirtualAttributes,
    loadedRemId,
    loadedRemName,
    ancestorTrees,
    descendantTrees,
    collapsedNodes,
    nodes,
    plugin,
    storePositions
  ]);

  const handleSwitchAttributes = useCallback(async () => {
    if (!loadedRemId) {
      return;
    }
    const oldType = attributeType;
    const oldData = oldType === 'property' ? propertyData : interfaceData;
    if (hiddenAttributes.size === 0 && oldData) {
      nodes.forEach((node) => {
        const data = node.data as GraphNodeData;
        if (data?.kind === oldType) {
          const detail = oldData.byId[data.remId];
          if (detail) {
            const ownerNode = nodes.find((n) => n.id === detail.ownerNodeId);
            if (ownerNode) {
              const dx = node.position.x - ownerNode.position.x;
              const dy = node.position.y - ownerNode.position.y;
              hiddenAttributeOffsetsRef.current.set(data.remId, { dx, dy });
            }
          }
        }
      });
    }
    const newType = attributeType === 'property' ? 'interface' : 'property';
    setAttributeType(newType);
    const nextHidden = new Set<string>();
    const nextHiddenVirtual = new Set<string>();
    setHiddenAttributes(nextHidden);
    setHiddenVirtualAttributes(nextHiddenVirtual);
    const newData = newType === 'property' ? propertyData : interfaceData;
    if (!newData) return;
    const graph = await createGraphData(
      plugin,
      loadedRemId,
      loadedRemName || "(Untitled Rem)",
      ancestorTrees,
      descendantTrees,
      collapsedNodes,
      newData,
      nextHidden,
      nextHiddenVirtual,
      nodePositionsRef.current,
      newType
    );
    const displayNodes = graph.nodes.map((node) => {
      const data = node.data as GraphNodeData;
      if (data.kind !== newType) {
        return node;
      }
      const detail = newData.byId[data.remId];
      if (!detail) {
        return node;
      }
      const ownerNode = graph.nodes.find((n) => n.id === detail.ownerNodeId);
      if (!ownerNode) {
        return node;
      }
      const storedOffset = hiddenAttributeOffsetsRef.current.get(data.remId);
      if (storedOffset) {
        const newPos = {
          x: ownerNode.position.x + storedOffset.dx,
          y: ownerNode.position.y + storedOffset.dy,
        };
        return {
          ...node,
          position: newPos,
        };
      }
      return node;
    });
    const updatedEdges = await addMissingRemEdges(plugin, displayNodes, graph.edges);
    setNodes(displayNodes);
    storePositions(displayNodes);
    setEdges(updatedEdges);
  }, [
    attributeType,
    propertyData,
    interfaceData,
    hiddenAttributes,
    loadedRemId,
    loadedRemName,
    ancestorTrees,
    descendantTrees,
    collapsedNodes,
    nodes,
    plugin,
    storePositions
  ]);

  const handleToggleCollapseAll = useCallback(async () => {
    if (!loadedRemId) return;

    // Only collect IDs of REM nodes that have children
    const collectIdsWithChildren = (trees: HierarchyNode[]): string[] => {
      const ids: string[] = [];
      for (const node of trees) {
        // Only add this node if it has children
        if (node.children && node.children.length > 0) {
          ids.push(node.id);
        }
        // Recursively check children
        ids.push(...collectIdsWithChildren(node.children));
      }
      return ids;
    };

    const currentData = attributeType === 'property' ? propertyData : interfaceData;

    if (collapsedNodes.size > 0) {
      // Expand all: clear collapsed nodes
      setCollapsedNodes(new Set<string>());
    } else {
      // Collapse all: add only REM nodes that have children, and attribute nodes with children
      const allIds = new Set<string>([
        ...collectIdsWithChildren(ancestorTrees),
        ...collectIdsWithChildren(descendantTrees),
      ]);
      if (currentData) {
        for (const detail of Object.values(currentData.byId)) {
          if (detail.hasChildren) {
            allIds.add(detail.id);
          }
        }
      }
      setCollapsedNodes(allIds);
    }
    // Note: updateGraph() is called automatically by the useEffect that depends on collapsedNodes
  }, [
    ancestorTrees,
    descendantTrees,
    collapsedNodes,
    loadedRemId,
    propertyData,
    interfaceData,
    attributeType,
  ]);

  const handleNodeClick = useCallback(
    (event: React.MouseEvent, node: GraphNode) => {
      event.preventDefault();
      event.stopPropagation();
      if (!loadedRemId) return;

      const data = (node.data ?? undefined) as GraphNodeData | undefined;
      const targetId = data?.remId ?? node.id;

      // Center node: keep current behavior, but don't call updateGraph() directly
      if (targetId === loadedRemId) {
        // const collectImmediateChildren = (trees: HierarchyNode[]): string[] => {
        //   const ids: string[] = [];
        //   for (const tree of trees) {
        //     ids.push(tree.id);
        //     ids.push(...tree.children.map((c) => c.id));
        //   }
        //   return ids;
        // };
        // const immediateDescendantIds = collectImmediateChildren(descendantTrees);
        // setCollapsedNodes(new Set(immediateDescendantIds));
        return;
      }

      // Helpers
      const collectIds = (trees: HierarchyNode[]) => {
        const ids: string[] = [];
        const stack = [...trees];
        while (stack.length) {
          const n = stack.pop()!;
          ids.push(n.id);
          if (n.children?.length) stack.push(...n.children);
        }
        return ids;
      };
      const collectSubtreeIds = (root: HierarchyNode) => {
        const ids: string[] = [];
        const stack = [root];
        while (stack.length) {
          const n = stack.pop()!;
          ids.push(n.id);
          if (n.children?.length) stack.push(...n.children);
        }
        return ids;
      };

      // REM nodes: default = per-node toggle; Shift = rest-of-side
      if (!data || data.kind === "rem") {
        // Center node special-case unchanged
        if (targetId === loadedRemId) {
          // const collectImmediateChildren = (trees: HierarchyNode[]): string[] => {
          //   const ids: string[] = [];
          //   for (const tree of trees) {
          //     ids.push(tree.id);
          //     ids.push(...tree.children.map((c) => c.id));
          //   }
          //   return ids;
          // };
          // const immediateDescendantIds = collectImmediateChildren(descendantTrees);
          // setCollapsedNodes(new Set(immediateDescendantIds));
          return;
        }

        // Default: per-node toggle
        const t = findNodeById(ancestorTrees, targetId) ?? findNodeById(descendantTrees, targetId);
        const hasChildren = !!t?.children?.length;
        if (!hasChildren) return;
        const next = new Set(collapsedNodes);
        next.has(targetId) ? next.delete(targetId) : next.add(targetId);
        setCollapsedNodes(next);
        return;
      }

      // Attribute nodes: keep simple per-node toggle
      let hasChildren = false;
      if (data?.kind === "property" || data?.kind === "interface") {
        const currentData = data.kind === "property" ? propertyData : interfaceData;
        const detail = currentData?.byId[targetId];
        hasChildren = !!detail?.hasChildren;
      } else {
        const t = findNodeById(ancestorTrees, targetId) ?? findNodeById(descendantTrees, targetId);
        hasChildren = !!t?.children?.length;
      }
      if (!hasChildren) return;

      const next = new Set(collapsedNodes);
      next.has(targetId) ? next.delete(targetId) : next.add(targetId);
      setCollapsedNodes(next);
    },
    [loadedRemId, ancestorTrees, descendantTrees, collapsedNodes, propertyData, interfaceData]
  );

  const handleContextMenuClose = useCallback(() => {
    setContextMenu(null);
    setVirtualContextMenu(null);
  }, []);

  const handleOpenContextRem = useCallback(async () => {
    if (!contextMenu?.remId) return;
    const rem = (await plugin.rem.findOne(contextMenu.remId)) as PluginRem | null;
    if (rem) {
      void plugin.window.openRem(rem);
    }
    handleContextMenuClose();
  }, [contextMenu, plugin, handleContextMenuClose]);

  const handleCopyContextRem = useCallback(async () => {
    if (!contextMenu?.remId) return;
    const rem = (await plugin.rem.findOne(contextMenu.remId)) as PluginRem | null;
    if (rem) {
      await rem.copyReferenceToClipboard();
    }
    handleContextMenuClose();
  }, [contextMenu, plugin, handleContextMenuClose]);

  const handleImplementVirtualProperty = useCallback(async () => {
    if (!virtualContextMenu) return;
    
    try {
      // Get the owner REM and source property
      const ownerRem = await plugin.rem.findOne(virtualContextMenu.ownerRemId);
      const sourceProperty = await plugin.rem.findOne(virtualContextMenu.sourcePropertyId);
      
      if (!ownerRem || !sourceProperty) {
        setError("Could not find required REMs");
        handleContextMenuClose();
        return;
      }
      
      // Create new child REM with same name
      const newRem = await plugin.rem.createRem();
      if (!newRem) {
        setError("Failed to create new REM");
        handleContextMenuClose();
        return;
      }
      
      // Set the text to match the source property
      const sourceText = sourceProperty.text;
      if (sourceText) {
        await newRem.setText(sourceText);
      }
      
      // Set parent to owner REM
      await newRem.setParent(ownerRem);
      
      // Make it a document (property)
      await newRem.setIsDocument(true);
      
      // Create extends relationship to source property
      // This requires creating an "extends" descriptor child
      const extendsDesc = await plugin.rem.createRem();
      if (extendsDesc) {
        await extendsDesc.setText(["extends"]);
        await extendsDesc.setParent(newRem);
        await extendsDesc.setType(SetRemType.DESCRIPTOR);
        
        // Add reference to source property
        const refChild = await plugin.rem.createRem();
        if (refChild) {
          await refChild.setText([{ i: "q", _id: sourceProperty._id }]);
          await refChild.setParent(extendsDesc);
        }
      }
      
      // Update descendant properties that extend the same source property
      // to now extend this newly created property instead.
      // This ensures the inheritance chain is properly maintained regardless
      // of the order in which properties are implemented.
      const updatedCount = await updateDescendantPropertyReferences(plugin, newRem, ownerRem, sourceProperty);
      
      // Show toast message if any descendant properties were updated
      if (updatedCount > 0) {
        await plugin.app.toast(
          `Updated ${updatedCount} descendant ${updatedCount === 1 ? 'property' : 'properties'} to extend the new property.`
        );
      }
      
      // Reload the hierarchy to reflect changes
      if (loadedRemId) {
        await loadHierarchy(loadedRemId);
      }
    } catch (err) {
      console.error("Failed to create implementing property:", err);
      setError("Failed to create property");
    }
    
    handleContextMenuClose();
  }, [virtualContextMenu, plugin, loadHierarchy, loadedRemId, handleContextMenuClose]);

  const collectAttributeIds = useCallback((attrs: AttributeNodeInfo[]): string[] => {
    const ids: string[] = [];
    for (const attr of attrs) {
      ids.push(attr.id);
      ids.push(...collectAttributeIds(attr.children));
    }
    return ids;
  }, []);

  // Collect virtual attribute IDs for a given REM from the current nodes (for hiding)
  const collectVirtualAttributeIdsFromNodes = useCallback((remId: string): string[] => {
    return nodes
      .filter(node => {
        const data = node.data as GraphNodeData;
        return (data.kind === 'virtualProperty' || data.kind === 'virtualInterface') && data.ownerRemId === remId;
      })
      .map(node => node.id);
  }, [nodes]);

  // Collect hidden virtual attribute IDs for a given REM from hiddenVirtualAttributes set (for showing)
  const collectHiddenVirtualAttributeIds = useCallback((remId: string): string[] => {
    const prefix = `virtual:${remId}:`;
    return [...hiddenVirtualAttributes].filter(id => id.startsWith(prefix));
  }, [hiddenVirtualAttributes]);

  const handleHideProperties = useCallback(async () => {
    if (!contextMenu?.remId || !propertyData) return;
    const attrs = propertyData.byOwner[contextMenu.remId];
    const idsToToggle = attrs ? collectAttributeIds(attrs) : [];
    
    // Collect virtual property IDs - from nodes if visible, from hiddenVirtualAttributes if hidden
    const visibleVirtualIds = collectVirtualAttributeIdsFromNodes(contextMenu.remId);
    const hiddenVirtualIds = collectHiddenVirtualAttributeIds(contextMenu.remId);
    const allVirtualIds = [...new Set([...visibleVirtualIds, ...hiddenVirtualIds])];
    
    const allRegularHidden = idsToToggle.length === 0 || idsToToggle.every(id => hiddenAttributes.has(id));
    const allVirtualHidden = allVirtualIds.length === 0 || allVirtualIds.every(id => hiddenVirtualAttributes.has(id));
    const allHidden = allRegularHidden && allVirtualHidden;
    
    const nextHidden: Set<string> = new Set(hiddenAttributes);
    const nextHiddenVirtual: Set<string> = new Set(hiddenVirtualAttributes);
    
    if (allHidden) {
      // Show them: remove from hidden
      idsToToggle.forEach(id => nextHidden.delete(id));
      allVirtualIds.forEach(id => nextHiddenVirtual.delete(id));
    } else {
      // Hide them: add to hidden
      idsToToggle.forEach(id => nextHidden.add(id));
      allVirtualIds.forEach(id => nextHiddenVirtual.add(id));
    }
    const graph = await createGraphData(
      plugin,
      loadedRemId,
      loadedRemName || "(Untitled Rem)",
      ancestorTrees,
      descendantTrees,
      collapsedNodes,
      propertyData,
      nextHidden,
      nextHiddenVirtual,
      nodePositionsRef.current,
      'property'
    );
    const updatedEdges = await addMissingRemEdges(plugin, graph.nodes, graph.edges);
    setHiddenAttributes(nextHidden);
    setHiddenVirtualAttributes(nextHiddenVirtual);
    setNodes(graph.nodes);
    storePositions(graph.nodes);
    setEdges(updatedEdges);
    handleContextMenuClose();
  }, [
    contextMenu,
    propertyData,
    hiddenAttributes,
    hiddenVirtualAttributes,
    loadedRemId,
    loadedRemName,
    ancestorTrees,
    descendantTrees,
    collapsedNodes,
    plugin,
    storePositions,
    collectAttributeIds,
    collectVirtualAttributeIdsFromNodes,
    collectHiddenVirtualAttributeIds,
    handleContextMenuClose
  ]);

  const handleHideVirtualProperties = useCallback(async () => {
    if (!contextMenu?.remId || !propertyData) return;
    
    // Collect virtual property IDs - from nodes if visible, from hiddenVirtualAttributes if hidden
    const visibleVirtualIds = collectVirtualAttributeIdsFromNodes(contextMenu.remId);
    const hiddenVirtualIds = collectHiddenVirtualAttributeIds(contextMenu.remId);
    const allVirtualIds = [...new Set([...visibleVirtualIds, ...hiddenVirtualIds])];
    
    if (allVirtualIds.length === 0) {
      handleContextMenuClose();
      return;
    }
    
    const allHidden = allVirtualIds.every(id => hiddenVirtualAttributes.has(id));
    const nextHiddenVirtual: Set<string> = new Set(hiddenVirtualAttributes);
    
    if (allHidden) {
      // Show them: remove from hidden
      allVirtualIds.forEach(id => nextHiddenVirtual.delete(id));
    } else {
      // Hide them: add to hidden
      allVirtualIds.forEach(id => nextHiddenVirtual.add(id));
    }
    const graph = await createGraphData(
      plugin,
      loadedRemId,
      loadedRemName || "(Untitled Rem)",
      ancestorTrees,
      descendantTrees,
      collapsedNodes,
      propertyData,
      hiddenAttributes,
      nextHiddenVirtual,
      nodePositionsRef.current,
      'property'
    );
    const updatedEdges = await addMissingRemEdges(plugin, graph.nodes, graph.edges);
    setHiddenVirtualAttributes(nextHiddenVirtual);
    setNodes(graph.nodes);
    storePositions(graph.nodes);
    setEdges(updatedEdges);
    handleContextMenuClose();
  }, [
    contextMenu,
    propertyData,
    hiddenAttributes,
    hiddenVirtualAttributes,
    loadedRemId,
    loadedRemName,
    ancestorTrees,
    descendantTrees,
    collapsedNodes,
    plugin,
    storePositions,
    collectVirtualAttributeIdsFromNodes,
    collectHiddenVirtualAttributeIds,
    handleContextMenuClose
  ]);

  const handleGotoContextRem = useCallback(() => {
    if (!contextMenu?.remId) return;

    if (loadedRemId && loadedRemId !== contextMenu.remId) {
      setHistoryStack((prev) => [...prev, loadedRemId]);
    }
    nodePositionsRef.current = new Map();
    loadHierarchy(contextMenu.remId);
    handleContextMenuClose();
  }, [contextMenu, loadHierarchy, handleContextMenuClose]);

  const handleRefresh = useCallback(async () => {
    if (loadedRemId) {
      nodePositionsRef.current = new Map();
      await updateGraph();
    }
  }, [loadedRemId, updateGraph]);

  const handleGoBack = useCallback(() => {
    if (historyStack.length === 0) return;
    const previousId = historyStack[historyStack.length - 1];
    setHistoryStack((prev) => prev.slice(0, -1));
    nodePositionsRef.current = new Map();
    loadHierarchy(previousId);
    handleContextMenuClose();
  }, [historyStack, loadHierarchy, handleContextMenuClose]);

  const handleNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: GraphNode) => {
      event.preventDefault();
      event.stopPropagation();
      const nodeData = (node.data ?? undefined) as GraphNodeData | undefined;
      if (!nodeData) return;

      const label = (nodeData.label ?? "").trim();

      // Check if this is a virtual property/interface node
      if ((nodeData.kind === 'virtualProperty' || nodeData.kind === 'virtualInterface') && nodeData.sourcePropertyId && nodeData.ownerRemId) {
        setVirtualContextMenu({
          x: event.clientX,
          y: event.clientY,
          nodeId: node.id,
          label: label.length > 0 ? label : '(Untitled)',
          sourcePropertyId: nodeData.sourcePropertyId,
          ownerRemId: nodeData.ownerRemId,
        });
        return;
      }

      // Regular node context menu
      const remId = nodeData.remId ?? node.id;
      if (!remId) return;

      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        remId,
        label: label.length > 0 ? label : '(Untitled Rem)'
      });
    },
    []
  );

  const showPlaceholder = nodes.length === 0;

  return (
    <div style={{ padding: 12, fontFamily: "Inter, sans-serif", fontSize: 14, height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <button
          style={{
            padding: "6px 12px",
            background: !focusedRemId || loading ? "#cbd5f5" : "#2563eb",
            color: !focusedRemId || loading ? "#475569" : "#ffffff",
            border: "none",
            borderRadius: 4,
            cursor: !focusedRemId || loading ? "not-allowed" : "pointer",
            fontWeight: 600,
          }}
          onClick={handleLoad}
          disabled={!focusedRemId || loading}
        >
          {loading ? "Refreshing..." : "Load Current Rem"}
        </button>

        <button
          style={{
            padding: '6px 12px',
            background: '#4b5563',
            color: '#ffffff',
            border: 'none',
            borderRadius: 4,
            cursor: !loadedRemId ? 'not-allowed' : 'pointer',
            fontWeight: 600,
          }}
          onClick={handleToggleCollapseAll}
          disabled={!loadedRemId}
        >
          {collapsedNodes.size > 0 ? 'Expand All' : 'Collapse All'}
        </button>
        <button
          style={{
            padding: '6px 12px',
            background: '#1f2937',
            color: '#ffffff',
            border: 'none',
            borderRadius: 4,
            cursor: !loadedRemId || (!propertyData && !interfaceData) ? 'not-allowed' : 'pointer',
            fontWeight: 600,
          }}
          onClick={handleToggleAttributes}
          disabled={!loadedRemId || (!propertyData && !interfaceData)}
        >
          Toggle {attributeType.charAt(0).toUpperCase() + attributeType.slice(1)}
        </button>
        <button
          style={{
            padding: '6px 12px',
            background: '#1f2937',
            color: '#ffffff',
            border: 'none',
            borderRadius: 4,
            cursor: !loadedRemId || (!propertyData && !interfaceData) ? 'not-allowed' : 'pointer',
            fontWeight: 600,
          }}
          onClick={handleSwitchAttributes}
          disabled={!loadedRemId || (!propertyData && !interfaceData)}
        >
          Switch to {attributeType === 'property' ? 'Interfaces' : 'Properties'}
        </button>
        <button
          style={{
            padding: "6px 12px",
            background: !loadedRemId || loading ? "#cbd5f5" : "#2563eb",
            color: !loadedRemId || loading ? "#475569" : "#ffffff",
            border: "none",
            borderRadius: 4,
            cursor: !loadedRemId || loading ? "not-allowed" : "pointer",
            fontWeight: 600,
          }}
          onClick={handleRefresh}
          disabled={!loadedRemId}
        >
          Reposition
        </button>
        <button
          style={{
            padding: "6px 12px",
            background: historyStack.length === 0 || loading ? "#cbd5f5" : "#2563eb",
            color: historyStack.length === 0 || loading ? "#475569" : "#ffffff",
            border: "none",
            borderRadius: 4,
            cursor: historyStack.length === 0 || loading ? "not-allowed" : "pointer",
            fontWeight: 600,
          }}
          onClick={handleGoBack}
          disabled={historyStack.length === 0}
        >
          Back
        </button>
      </div>

      {error && <div style={{ color: "#dc2626", marginBottom: 8 }}>{error}</div>}

      <div
        style={{
          height: "calc(100% - 60px)",
          minHeight: 300,
          border: "1px solid #e2e8f0",
          borderRadius: 8,
          background: "#f8fafc",
          position: "relative",
          color: "#0f172a"
        }}
        onClick={handleContextMenuClose}
      >
        {showPlaceholder ? (
          <div style={{ padding: 24, color: "#64748b" }}>
            {focusedRemId
              ? "Press Reposition to load the inheritance hierarchy."
              : "Focus a rem, then press Reposition to load the hierarchy."}
          </div>
        ) : (
          <ReactFlowProvider>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={NODE_TYPES}
              edgeTypes={EDGE_TYPES}
              onInit={setReactFlowInstance}
              onNodeClick={handleNodeClick}
              onNodeContextMenu={handleNodeContextMenu}
              onNodesChange={handleNodesChange}
              nodesDraggable
              nodesConnectable={false}
              elementsSelectable={false}
              panOnDrag
              zoomOnScroll
              proOptions={{ hideAttribution: true }}
              fitView
              minZoom={0.3}
              maxZoom={1.4}
              style={{ background: "transparent" }}
            >
              <Background gap={24} color="#e2e8f0" />
              <Controls position="bottom-right" showInteractive={false} />
            </ReactFlow>
          </ReactFlowProvider>
        )}
        {contextMenu && (
          <div
            style={{
              position: 'fixed',
              left: contextMenu.x,
              top: contextMenu.y,
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 4,
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
              zIndex: 1000,
              minWidth: 160,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              style={{
                padding: '8px 12px',
                background: 'none',
                border: 'none',
                width: '100%',
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: 14,
                color: '#374151',
              }}
              onClick={handleGotoContextRem}
            >
              Open Rem
            </button>
            <button
              style={{
                padding: '8px 12px',
                background: 'none',
                border: 'none',
                width: '100%',
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: 14,
                color: '#374151',
              }}
              onClick={handleHideProperties}
            >
              Toggle Properties
            </button>
            <button
              style={{
                padding: '8px 12px',
                background: 'none',
                border: 'none',
                width: '100%',
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: 14,
                color: '#374151',
              }}
              onClick={handleHideVirtualProperties}
            >
              Toggle Virtual Properties
            </button>
            <button
              style={{
                padding: '8px 12px',
                background: 'none',
                border: 'none',
                width: '100%',
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: 14,
                color: '#374151',
                borderTop: '1px solid #e2e8f0',
              }}
              onClick={handleOpenContextRem}
            >
              Edit Rem
            </button>
            <button
              style={{
                padding: '8px 12px',
                background: 'none',
                border: 'none',
                width: '100%',
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: 14,
                color: '#374151',
              }}
              onClick={handleCopyContextRem}
            >
              Copy Rem
            </button>
          </div>
        )}
        {virtualContextMenu && (
          <div
            style={{
              position: 'fixed',
              left: virtualContextMenu.x,
              top: virtualContextMenu.y,
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 4,
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
              zIndex: 1000,
              minWidth: 160,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              style={{
                padding: '8px 12px',
                background: 'none',
                border: 'none',
                width: '100%',
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: 14,
                color: '#374151',
              }}
              onClick={handleImplementVirtualProperty}
            >
              Implement
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

renderWidget(MindmapWidget);
