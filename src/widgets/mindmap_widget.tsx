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
import { renderWidget, usePlugin, useTracker, Rem, RNPlugin, RemType } from "@remnote/plugin-sdk";

import { getRemText, getParentClass, getExtendsChildren, getCleanChildren, getExtendsParents } from "../utils/utils";

type HierarchyNode = {
  id: string;
  name: string;
  remRef: Rem;
  children: HierarchyNode[];
};

type GraphNodeData = {
  label: string;
  remId: string;
  kind: "rem" | "property";
};

const HORIZONTAL_SPACING = 180;
const VERTICAL_SPACING = 140;

const DEFAULT_NODE_STYLE: React.CSSProperties = {
  padding: "6px 10px",
  background: "#ffffff",
  border: "1px solid #cbd5f5",
  borderRadius: 6,
  fontSize: 13,
  textAlign: "center",
  minWidth: 140,
};

const CENTER_NODE_STYLE: React.CSSProperties = {
  ...DEFAULT_NODE_STYLE,
  border: "2px solid #1d4ed8",
  background: "#dbeafe",
  fontWeight: 600,
};

type PropertyNodeInfo = {
  id: string;
  label: string;
  extends: string[];
};

type PropertyDetail = PropertyNodeInfo & {
  ownerId: string;
};

type PropertyData = {
  byOwner: Record<string, PropertyNodeInfo[]>;
  byId: Record<string, PropertyDetail>;
};

type GraphNode = Node<GraphNodeData>;
type GraphEdge = Edge;

const PROPERTY_HORIZONTAL_OFFSET = 220;
const PROPERTY_VERTICAL_SPACING = 40;

const PROPERTY_NODE_STYLE: React.CSSProperties = {
  padding: "6px 10px",
  background: "#fefce8",
  border: "1px solid #facc15",
  borderRadius: 6,
  fontSize: 12,
  minWidth: 160,
  textAlign: "left",
};

const REM_SOURCE_BOTTOM_HANDLE = "rem-source-bottom";
const REM_TARGET_TOP_HANDLE = "rem-target-top";
const REM_SOURCE_RIGHT_HANDLE = "rem-source-right";
const PROPERTY_TARGET_LEFT_HANDLE = "property-target-left";
const PROPERTY_SOURCE_RIGHT_HANDLE = "property-source-right";
const PROPERTY_TARGET_RIGHT_HANDLE = "property-target-right";

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

const PROPERTY_CONTAINER_STYLE: React.CSSProperties = {
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

function RemFlowNode({ data }: NodeProps<GraphNodeData>) {
  return (
    <div style={NODE_CONTAINER_STYLE}>
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
      <span>{data.label}</span>
    </div>
  );
}

function PropertyFlowNode({ data }: NodeProps<GraphNodeData>) {
  return (
    <div style={PROPERTY_CONTAINER_STYLE}>
      <Handle
        type="target"
        position={Position.Left}
        id={PROPERTY_TARGET_LEFT_HANDLE}
        style={{ ...HANDLE_COMMON_STYLE, ...LEFT_HANDLE_STYLE }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id={PROPERTY_SOURCE_RIGHT_HANDLE}
        style={{ ...HANDLE_COMMON_STYLE, ...RIGHT_HANDLE_STYLE }}
      />
      <Handle
        type="target"
        position={Position.Right}
        id={PROPERTY_TARGET_RIGHT_HANDLE}
        style={{ ...HANDLE_COMMON_STYLE, ...RIGHT_TARGET_HANDLE_STYLE }}
      />
      <span style={{ width: '100%' }}>{data.label}</span>
    </div>
  );
}

const NODE_TYPES = {
  remNode: RemFlowNode,
  propertyNode: PropertyFlowNode,
};

async function buildAncestorNodes(
  plugin: RNPlugin,
  rem: Rem,
  visited: Set<string>
): Promise<HierarchyNode[]> {
  const parents = await getParentClass(plugin, rem);
  const uniqueParents = new Map<string, Rem>();
  for (const parent of parents) {
    if (!parent) continue;
    if (parent._id === rem._id) continue;
    if (!uniqueParents.has(parent._id)) {
      uniqueParents.set(parent._id, parent);
    }
  }

  const result: HierarchyNode[] = [];
  for (const parent of uniqueParents.values()) {
    if (visited.has(parent._id)) continue;
    const nextVisited = new Set(visited);
    nextVisited.add(parent._id);
    const [name, ancestors] = await Promise.all([
      getRemText(plugin, parent),
      buildAncestorNodes(plugin, parent, nextVisited),
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

async function getStructuralDescendantChildren(plugin: RNPlugin, rem: Rem): Promise<Rem[]> {
  const children = await getCleanChildren(plugin, rem);
  const meta = await Promise.all(
    children.map(async (child) => {
      const [isDoc, type] = await Promise.all([child.isDocument(), child.getType()]);
      return { child, isDoc, type };
    })
  );
  return meta
    .filter(({ isDoc, type }) => !isDoc && type !== RemType.DESCRIPTOR)
    .map(({ child }) => child);
}

async function buildDescendantNodes(
  plugin: RNPlugin,
  rem: Rem,
  visited: Set<string>
): Promise<HierarchyNode[]> {
  const [extendsChildren, structuralChildren] = await Promise.all([
    getExtendsChildren(plugin, rem),
    getStructuralDescendantChildren(plugin, rem),
  ]);

  const childMap = new Map<string, Rem>();
  for (const child of [...extendsChildren, ...structuralChildren]) {
    if (!child) continue;
    if (child._id === rem._id) continue;
    if (!childMap.has(child._id)) {
      childMap.set(child._id, child);
    }
  }

  const result: HierarchyNode[] = [];
  for (const child of childMap.values()) {
    if (visited.has(child._id)) continue;
    const nextVisited = new Set(visited);
    nextVisited.add(child._id);
    const [name, descendants] = await Promise.all([
      getRemText(plugin, child),
      buildDescendantNodes(plugin, child, nextVisited),
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

function measureSubtree(
  node: HierarchyNode,
  cache: Map<string, number>,
  collapsed: Set<string>
): number {
  if (cache.has(node.id)) return cache.get(node.id)!;
  if (collapsed.has(node.id) || !node.children || node.children.length === 0) {
    cache.set(node.id, 1);
    return 1;
  }
  let total = 0;
  for (const child of node.children) {
    total += measureSubtree(child, cache, collapsed);
  }
  const value = Math.max(total, 1);
  cache.set(node.id, value);
  return value;
}

function layoutForest(
  forest: HierarchyNode[],
  direction: "up" | "down",
  parentId: string,
  nodeStyle: React.CSSProperties,
  nodes: GraphNode[],
  edges: GraphEdge[],
  existingNodeIds: Set<string>,
  collapsed: Set<string>
) {
  if (forest.length === 0) return;

  const widthCache = new Map<string, number>();
  let totalWidth = 0;
  for (const tree of forest) {
    totalWidth += measureSubtree(tree, widthCache, collapsed);
  }

  let cursor = -totalWidth / 2;
  for (const tree of forest) {
    const width = widthCache.get(tree.id) ?? 1;
    layoutTree(
      tree,
      cursor,
      width,
      1,
      direction,
      parentId,
      nodeStyle,
      nodes,
      edges,
      existingNodeIds,
      widthCache,
      collapsed
    );
    cursor += width;
  }
}

function layoutTree(
  node: HierarchyNode,
  startUnit: number,
  widthUnits: number,
  level: number,
  direction: "up" | "down",
  parentId: string,
  nodeStyle: React.CSSProperties,
  nodes: GraphNode[],
  edges: GraphEdge[],
  existingNodeIds: Set<string>,
  widthCache: Map<string, number>,
  collapsed: Set<string>
) {
  const centerUnit = startUnit + widthUnits / 2;
  const x = centerUnit * HORIZONTAL_SPACING;
  const yMultiplier = direction === "up" ? -1 : 1;
  const y = level * VERTICAL_SPACING * yMultiplier;

  if (!existingNodeIds.has(node.id)) {
    const style = collapsed.has(node.id)
      ? { ...nodeStyle, background: "#e2e8f0" }
      : nodeStyle;
    nodes.push({
      id: node.id,
      position: { x, y },
      data: { label: node.name, remId: node.id, kind: "rem" },
      style,
      draggable: true,
      selectable: true,
      type: "remNode",
    });
    existingNodeIds.add(node.id);
  }

  const edgeSource = direction === "up" ? node.id : parentId;
  const edgeTarget = direction === "up" ? parentId : node.id;
  edges.push({
    id: `${edgeSource}->${edgeTarget}`,
    source: edgeSource,
    target: edgeTarget,
    sourceHandle: REM_SOURCE_BOTTOM_HANDLE,
    targetHandle: REM_TARGET_TOP_HANDLE,
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
  });

  if (collapsed.has(node.id) || !node.children || node.children.length === 0) {
    return;
  }

  let childCursor = startUnit;
  for (const child of node.children) {
    const childWidth = widthCache.get(child.id) ?? 1;
    layoutTree(
      child,
      childCursor,
      childWidth,
      level + 1,
      direction,
      node.id,
      nodeStyle,
      nodes,
      edges,
      existingNodeIds,
      widthCache,
      collapsed
    );
    childCursor += childWidth;
  }
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

function createGraphData(
  centerId: string,
  centerLabel: string,
  ancestors: HierarchyNode[],
  descendants: HierarchyNode[],
  collapsed: Set<string>,
  propertyData?: PropertyData,
  hiddenProperties?: Set<string>
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [
    {
      id: centerId,
      position: { x: 0, y: 0 },
      data: { label: centerLabel, remId: centerId, kind: "rem" },
      style: CENTER_NODE_STYLE,
      draggable: true,
      selectable: true,
      type: "remNode",
    },
  ];
  const edges: GraphEdge[] = [];
  const existingIds = new Set<string>([centerId]);

  layoutForest(
    ancestors,
    "up",
    centerId,
    DEFAULT_NODE_STYLE,
    nodes,
    edges,
    existingIds,
    collapsed
  );
  layoutForest(
    descendants,
    "down",
    centerId,
    DEFAULT_NODE_STYLE,
    nodes,
    edges,
    existingIds,
    collapsed
  );

  return integratePropertyGraph(nodes, edges, propertyData, hiddenProperties);
}

function propertyNodeId(propertyId: string): string {
  return `property:${propertyId}`;
}

function layoutPropertiesForOwner(
  ownerNode: GraphNode,
  properties: PropertyNodeInfo[],
  nodes: GraphNode[],
  edges: GraphEdge[],
  existingNodeIds: Set<string>,
  existingEdgeIds: Set<string>,
  hiddenProperties?: Set<string>
) {
  if (properties.length === 0) {
    return;
  }

  const visible = hiddenProperties
    ? properties.filter((info) => !hiddenProperties.has(info.id))
    : properties;

  if (visible.length === 0) {
    return;
  }

  const sorted = [...visible].sort((a, b) => a.label.localeCompare(b.label));
  const count = sorted.length;
  const startOffset = ((count - 1) / 2) * PROPERTY_VERTICAL_SPACING;
  const baseX = ownerNode.position.x + PROPERTY_HORIZONTAL_OFFSET;

  sorted.forEach((info, index) => {
    const nodeId = propertyNodeId(info.id);
    if (!existingNodeIds.has(nodeId)) {
      const y = ownerNode.position.y + index * PROPERTY_VERTICAL_SPACING - startOffset;
      nodes.push({
        id: nodeId,
        position: { x: baseX, y },
        data: { label: info.label, remId: info.id, kind: "property" },
        style: PROPERTY_NODE_STYLE,
        draggable: true,
        selectable: true,
        type: "propertyNode",
      });
      existingNodeIds.add(nodeId);
    }

    const edgeId = `prop-link:${ownerNode.id}->${info.id}`;
    if (!existingEdgeIds.has(edgeId)) {
      edges.push({
        id: edgeId,
        source: ownerNode.id,
        target: nodeId,
        sourceHandle: REM_SOURCE_RIGHT_HANDLE,
        targetHandle: PROPERTY_TARGET_LEFT_HANDLE,
        type: "smoothstep",
        markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
      });
      existingEdgeIds.add(edgeId);
    }
  });
}

function integratePropertyGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  propertyData?: PropertyData,
  hiddenProperties?: Set<string>
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  if (!propertyData) {
    return { nodes, edges };
  }

  const existingNodeIds = new Set(nodes.map((node) => node.id));
  const existingEdgeIds = new Set(edges.map((edge) => edge.id));
  const baseNodeMap = new Map(
    nodes.filter((node) => node.data.kind === "rem").map((node) => [node.id, node])
  );

  for (const [ownerId, propertyList] of Object.entries(propertyData.byOwner)) {
    const ownerNode = baseNodeMap.get(ownerId);
    if (!ownerNode || propertyList.length === 0) {
      continue;
    }
    layoutPropertiesForOwner(
      ownerNode,
      propertyList,
      nodes,
      edges,
      existingNodeIds,
      existingEdgeIds,
      hiddenProperties
    );
  }

  for (const detail of Object.values(propertyData.byId)) {
    if (hiddenProperties?.has(detail.id)) {
      continue;
    }
    const childNodeId = propertyNodeId(detail.id);
    if (!existingNodeIds.has(childNodeId)) {
      continue;
    }
    for (const parentId of detail.extends) {
      if (hiddenProperties?.has(parentId)) {
        continue;
      }
      const parentNodeId = propertyNodeId(parentId);
      if (!existingNodeIds.has(parentNodeId)) {
        continue;
      }
      const edgeId = `prop-ext:${parentId}->${detail.id}`;
      if (existingEdgeIds.has(edgeId)) {
        continue;
      }
      edges.push({
        id: edgeId,
        source: parentNodeId,
        target: childNodeId,
        sourceHandle: PROPERTY_SOURCE_RIGHT_HANDLE,
        targetHandle: PROPERTY_TARGET_RIGHT_HANDLE,
        type: "smoothstep",
        markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
      });
      existingEdgeIds.add(edgeId);
    }
  }

  return { nodes, edges };
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
  center: Rem,
  ancestors: HierarchyNode[],
  descendants: HierarchyNode[]
): Rem[] {
  const remMap = new Map<string, Rem>();
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

async function buildPropertyData(plugin: RNPlugin, rems: Rem[]): Promise<PropertyData> {
  const byOwner: Record<string, PropertyNodeInfo[]> = {};
  const byId: Record<string, PropertyDetail> = {};
  const uniqueRems = new Map<string, Rem>();
  for (const rem of rems) {
    if (rem && !uniqueRems.has(rem._id)) {
      uniqueRems.set(rem._id, rem);
    }
  }

  const remList = Array.from(uniqueRems.values());

  const results = await Promise.all(
    remList.map(async (rem) => {
      const properties: PropertyNodeInfo[] = [];
      try {
        const children = await getCleanChildren(plugin, rem);
        const docFlags = await Promise.all(children.map((child) => child.isDocument()));
        for (let i = 0; i < children.length; i++) {
          if (!docFlags[i]) {
            continue;
          }
          const property = children[i];
          const labelRaw = await getRemText(plugin, property);
          let extendsIds: string[] = [];
          try {
            const parentRems = await getExtendsParents(plugin, property);
            extendsIds = Array.from(new Set(parentRems.map((parent) => parent._id)));
          } catch (_) {
            extendsIds = [];
          }
          const label = (labelRaw ?? "").trim() || "(Untitled Property)";
          properties.push({ id: property._id, label, extends: extendsIds });
        }
        properties.sort((a, b) => a.label.localeCompare(b.label));
      } catch (_) {
        // Ignore property gathering errors for this Rem.
      }
      return { ownerId: rem._id, properties };
    })
  );

  for (const { ownerId, properties } of results) {
    if (!properties || properties.length === 0) {
      continue;
    }
    byOwner[ownerId] = properties;
    for (const entry of properties) {
      byId[entry.id] = { ...entry, ownerId };
    }
  }

  return { byOwner, byId };
}

function SampleWidget() {
  const plugin = usePlugin();

  const focusedRem = useTracker(async (reactPlugin) => {
    return await reactPlugin.focus.getFocusedRem();
  });

  const [focusedRemName, setFocusedRemName] = useState<string>("");
  const [loadedRemName, setLoadedRemName] = useState<string>("");
  const [loadedRemId, setLoadedRemId] = useState<string>("");
  const [editRemName, setEditRemName] = useState<string>("");
  const [editRemId, setEditRemId] = useState<string>("");
  const [ancestorTrees, setAncestorTrees] = useState<HierarchyNode[]>([]);
  const [descendantTrees, setDescendantTrees] = useState<HierarchyNode[]>([]);
  const [descendantOwnerMap, setDescendantOwnerMap] = useState<Record<string, string>>({});
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(() => new Set<string>());
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [propertyData, setPropertyData] = useState<PropertyData | null>(null);
  const [hiddenProperties, setHiddenProperties] = useState<Set<string>>(() => new Set<string>());
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);

  const hasFitViewRef = useRef(false);
  const nodePositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  const applyStoredPositions = useCallback((nodeList: GraphNode[]): GraphNode[] => {
    return nodeList.map((node) => {
      const saved = nodePositionsRef.current.get(node.id);
      if (!saved) {
        return node;
      }
      if (saved.x === node.position.x && saved.y === node.position.y) {
        return node;
      }
      return {
        ...node,
        position: {
          x: saved.x,
          y: saved.y,
        },
      };
    });
  }, []);

  const storePositions = useCallback((nodeList: GraphNode[]) => {
    for (const node of nodeList) {
      nodePositionsRef.current.set(node.id, {
        x: node.position.x,
        y: node.position.y,
      });
    }
  }, []);


  const focusedRemId = focusedRem?._id;

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

  const loadHierarchy = useCallback(
    async (remId: string) => {
      setLoading(true);
      setError(null);
      setPropertyData(null);
      setHiddenProperties(new Set<string>());
      try {
        const rem = await plugin.rem.findOne(remId);
        if (!rem) {
          throw new Error("Unable to load the selected rem.");
        }

        const [name, ancestorTreesResult, descendantTreesResult] = await Promise.all([
          getRemText(plugin, rem),
          buildAncestorNodes(plugin, rem, new Set([rem._id])),
          buildDescendantNodes(plugin, rem, new Set([rem._id])),
        ]);

        const centerLabel = name || "(Untitled Rem)";
        const collapsed = new Set<string>();
        const remsForProperties = collectRemsForProperties(
          rem,
          ancestorTreesResult,
          descendantTreesResult
        );
        const properties = await buildPropertyData(plugin, remsForProperties);
        const hidden = new Set<string>();
        const graph = createGraphData(
          rem._id,
          centerLabel,
          ancestorTreesResult,
          descendantTreesResult,
          collapsed,
          properties,
          hidden
        );

        setAncestorTrees(ancestorTreesResult);
        setDescendantTrees(descendantTreesResult);
        setDescendantOwnerMap(buildDescendantOwnerMap(descendantTreesResult));
        setCollapsedNodes(collapsed);
        hasFitViewRef.current = false;
        nodePositionsRef.current = new Map<string, { x: number; y: number }>();
        setNodes(graph.nodes);
        storePositions(graph.nodes);
        setEdges(graph.edges);
        setPropertyData(properties);
        setHiddenProperties(hidden);
        setLoadedRemId(rem._id);
        setLoadedRemName(centerLabel);
      } catch (err) {
        console.error(err);
        setError("Failed to build inheritance hierarchy.");
      } finally {
        setLoading(false);
      }
    },
    [plugin, storePositions]
  );

  const handleRefresh = useCallback(() => {
    if (!focusedRemId) {
      setError("Focus a rem before refreshing.");
      return;
    }
    void loadHierarchy(focusedRemId);
  }, [focusedRemId, loadHierarchy]);

  const openStoredRem = useCallback(async () => {
    if (!editRemId) return;
    const rem = (await plugin.rem.findOne(editRemId)) as Rem | null;
    if (rem) {
      void plugin.window.openRem(rem);
    }
  }, [plugin, editRemId]);

  const gotoStoredRem = useCallback(() => {
    if (!editRemId) return;
    void loadHierarchy(editRemId);
  }, [editRemId, loadHierarchy]);

  const handleShowAll = useCallback(() => {
    if (!loadedRemId || !propertyData || hiddenProperties.size === 0) {
      return;
    }
    const cleared = new Set<string>();
    const graph = createGraphData(
      loadedRemId,
      loadedRemName || "(Untitled Rem)",
      ancestorTrees,
      descendantTrees,
      collapsedNodes,
      propertyData,
      cleared
    );
    const nodesWithPositions = applyStoredPositions(graph.nodes);
    setHiddenProperties(cleared);
    setNodes(nodesWithPositions);
    storePositions(nodesWithPositions);
    setEdges(graph.edges);
  }, [
    ancestorTrees,
    collapsedNodes,
    descendantTrees,
    hiddenProperties,
    loadedRemId,
    loadedRemName,
    propertyData,
    applyStoredPositions,
    storePositions
  ]);



  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (changes.length === 0) {
        return;
      }
      setNodes((current) => {
        if (current.length === 0) {
          return current;
        }

        const deltas = new Map<string, { dx: number; dy: number }>();
        for (const change of changes) {
          if (change.type === 'position' && change.position) {
            const previous = current.find((node) => node.id === change.id);
            if (!previous) continue;
            const dx = change.position.x - previous.position.x;
            const dy = change.position.y - previous.position.y;
            if (dx !== 0 || dy !== 0) {
              deltas.set(change.id, { dx, dy });
            }
          }
        }

        const updated = applyNodeChanges(changes, current);
        if (deltas.size === 0) {
          storePositions(updated);
          return updated;
        }

        const deltaCache = new Map<string, { dx: number; dy: number } | null>();
        const getAccumulatedDelta = (remId: string): { dx: number; dy: number } | null => {
          if (deltas.has(remId)) {
            return deltas.get(remId)!;
          }
          if (deltaCache.has(remId)) {
            return deltaCache.get(remId)!;
          }
          const parentId = descendantOwnerMap[remId];
          if (!parentId) {
            deltaCache.set(remId, null);
            return null;
          }
          const inherited = getAccumulatedDelta(parentId);
          deltaCache.set(remId, inherited);
          return inherited;
        };

        let mutated = false;
        const adjusted = updated.map((node) => {
          const data = node.data as GraphNodeData | undefined;
          if (!data) {
            return node;
          }

          if (data.kind === 'property') {
            if (!propertyData) {
              return node;
            }
            const detail = propertyData.byId[data.remId];
            if (!detail) {
              return node;
            }
            const ownerDirect = deltas.get(detail.ownerId);
            const ownerDelta = ownerDirect ?? getAccumulatedDelta(detail.ownerId);
            if (!ownerDelta) {
              return node;
            }
            mutated = true;
            return {
              ...node,
              position: {
                x: node.position.x + ownerDelta.dx,
                y: node.position.y + ownerDelta.dy,
              },
            };
          }

          if (data.kind === 'rem') {
            if (deltas.has(node.id)) {
              return node;
            }
            const inherited = getAccumulatedDelta(node.id);
            if (!inherited) {
              return node;
            }
            mutated = true;
            return {
              ...node,
              position: {
                x: node.position.x + inherited.dx,
                y: node.position.y + inherited.dy,
              },
            };
          }

          return node;
        });

        const finalNodes = mutated ? adjusted : updated;
        storePositions(finalNodes);
        return finalNodes;
      });
    },
    [descendantOwnerMap, propertyData, storePositions]
  );

  const toggleCollapseAll = useCallback(() => {
    if (!loadedRemId) return;

    const collectIds = (trees: HierarchyNode[]): string[] => {
      const ids: string[] = [];
      for (const node of trees) {
        ids.push(node.id);
        ids.push(...collectIds(node.children));
      }
      return ids;
    };

    const assignGraphPositions = (graphNodes: GraphNode[]) => {
      const nextPositions = new Map<string, { x: number; y: number }>();
      for (const node of graphNodes) {
        nextPositions.set(node.id, { x: node.position.x, y: node.position.y });
      }
      nodePositionsRef.current = nextPositions;
    };

    if (collapsedNodes.size > 0) {
      const next = new Set<string>();
      const graph = createGraphData(
        loadedRemId,
        loadedRemName || "(Untitled Rem)",
        ancestorTrees,
        descendantTrees,
        next,
        propertyData ?? undefined,
        hiddenProperties
      );
      assignGraphPositions(graph.nodes);
      setCollapsedNodes(next);
      setNodes(graph.nodes);
      setEdges(graph.edges);
    } else {
      const allIds = new Set<string>([
        ...collectIds(ancestorTrees),
        ...collectIds(descendantTrees),
      ]);
      const graph = createGraphData(
        loadedRemId,
        loadedRemName || "(Untitled Rem)",
        ancestorTrees,
        descendantTrees,
        allIds,
        propertyData ?? undefined,
        hiddenProperties
      );
      assignGraphPositions(graph.nodes);
      setCollapsedNodes(allIds);
      setNodes(graph.nodes);
      setEdges(graph.edges);
    }
  }, [
    ancestorTrees,
    descendantTrees,
    collapsedNodes,
    loadedRemId,
    loadedRemName,
    propertyData,
    hiddenProperties
  ]);



  const handleNodeClick = useCallback(
    (event: React.MouseEvent, node: GraphNode) => {
      event.preventDefault();
      event.stopPropagation();
      if (!loadedRemId) return;

      const nodeData = (node.data ?? undefined) as GraphNodeData | undefined;
      if (nodeData?.kind === "property") {
        if (!propertyData) {
          return;
        }
        const propertyId = nodeData.remId;
        if (!propertyId) {
          return;
        }
        const nextHidden = new Set<string>(hiddenProperties);
        if (nextHidden.has(propertyId)) {
          return;
        }
        nextHidden.add(propertyId);
        const graph = createGraphData(
          loadedRemId,
          loadedRemName || "(Untitled Rem)",
          ancestorTrees,
          descendantTrees,
          collapsedNodes,
          propertyData,
          nextHidden
        );
        const nodesWithPositions = applyStoredPositions(graph.nodes);
        setHiddenProperties(nextHidden);
        setNodes(nodesWithPositions);
        storePositions(nodesWithPositions);
        setEdges(graph.edges);
        return;
      }

      const targetId = nodeData?.remId ?? node.id;
      if (targetId === loadedRemId) return;
      const target =
        findNodeById(ancestorTrees, targetId) ?? findNodeById(descendantTrees, targetId);
      if (!target || !target.children || target.children.length === 0) {
        return;
      }
      const next = new Set<string>(collapsedNodes);
      if (next.has(targetId)) {
        next.delete(targetId);
      } else {
        next.add(targetId);
      }
      const graph = createGraphData(
        loadedRemId,
        loadedRemName || "(Untitled Rem)",
        ancestorTrees,
        descendantTrees,
        next,
        propertyData ?? undefined,
        hiddenProperties
      );
      const nodesWithPositions = applyStoredPositions(graph.nodes);
      setCollapsedNodes(next);
      setNodes(nodesWithPositions);
      storePositions(nodesWithPositions);
      setEdges(graph.edges);
    },
    [
      ancestorTrees,
      descendantTrees,
      collapsedNodes,
      loadedRemId,
      loadedRemName,
      propertyData,
      hiddenProperties,
      applyStoredPositions,
      storePositions
    ]
  );

  const handleNodeContextMenu = useCallback(
    async (event: React.MouseEvent, node: GraphNode) => {
      event.preventDefault();
      event.stopPropagation();
      const nodeData = (node.data ?? undefined) as GraphNodeData | undefined;
      const remId = nodeData?.remId ?? node.id;
      if (!remId) return;

      const rem = (await plugin.rem.findOne(remId)) as Rem | null;
      if (!rem) return;

      const label = (nodeData?.label ?? "").trim();
      setEditRemId(rem._id);
      setEditRemName(label.length > 0 ? label : '(Untitled Rem)');
    },
    [plugin]
  );

  const showPlaceholder = nodes.length === 0;

  return (
    <div style={{ padding: 12, color: "#0f172a", fontFamily: "Inter, sans-serif", fontSize: 14, height: "100%" }}>
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 12, textTransform: "uppercase", color: "#64748b", letterSpacing: 0.5 }}>
          Focused Rem
        </div>
        <div style={{ fontWeight: 600, marginTop: 2 }}>
          {focusedRemId ? focusedRemName || "(Untitled Rem)" : "No rem focused"}
        </div>
        <div style={{ marginTop: 6, fontSize: 12, color: "#475569" }}>
          Loaded hierarchy: {loadedRemId ? loadedRemName : "Not loaded"}
        </div>
      </div>

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
          onClick={handleRefresh}
          disabled={!focusedRemId || loading}
        >
          {loading ? "Refreshing..." : "Refresh"}
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
          onClick={toggleCollapseAll}
          disabled={!loadedRemId}
        >
          {collapsedNodes.size > 0 ? 'Expand All' : 'Collapse All'}
        </button>
        <button
          style={{
            padding: '6px 12px',
            background: hiddenProperties.size === 0 ? '#cbd5f5' : '#1f2937',
            color: hiddenProperties.size === 0 ? '#475569' : '#ffffff',
            border: 'none',
            borderRadius: 4,
            cursor: !loadedRemId || hiddenProperties.size === 0 || !propertyData ? 'not-allowed' : 'pointer',
            fontWeight: 600,
          }}
          onClick={handleShowAll}
          disabled={!loadedRemId || !propertyData || hiddenProperties.size === 0}
        >
          Show All
        </button>
        {editRemId && editRemName && (
          <>
            <button
              style={{
                padding: '6px 12px',
                background: '#10b981',
                color: '#ffffff',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                fontWeight: 600,
              }}
              onClick={() => void openStoredRem()}
            >
              Open Rem in Pane
            </button>
            <button
              style={{
                padding: '6px 12px',
                background: '#f97316',
                color: '#ffffff',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                fontWeight: 600,
              }}
              onClick={() => gotoStoredRem()}
            >
              Go To Rem
            </button>
          </>
        )}
      </div>

      {error && <div style={{ color: "#dc2626", marginBottom: 8 }}>{error}</div>}

      <div
        style={{
          height: "calc(100% - 120px)",
          minHeight: 300,
          border: "1px solid #e2e8f0",
          borderRadius: 8,
          background: "#f8fafc",
          position: "relative",
        }}
      >
        {showPlaceholder ? (
          <div style={{ padding: 24, color: "#64748b" }}>
            {focusedRemId
              ? "Press Refresh to load the inheritance hierarchy."
              : "Focus a rem, then press Refresh to load the hierarchy."}
          </div>
        ) : (
          <ReactFlowProvider>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={NODE_TYPES}
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
      </div>
    </div>
  );
}

renderWidget(SampleWidget);



















