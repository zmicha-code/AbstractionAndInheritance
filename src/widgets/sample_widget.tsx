import React, { useCallback, useEffect, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Node,
  Edge,
  MarkerType,
  ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { renderWidget, usePlugin, useTracker, Rem, RNPlugin, RemType } from "@remnote/plugin-sdk";

import { getRemText, getParentClass, getExtendsChildren, getCleanChildren } from "../utils/utils";

type HierarchyNode = {
  id: string;
  name: string;
  remRef: Rem;
  children: HierarchyNode[];
};

type GraphNodeData = {
  label: string;
  rem?: Rem;
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
  nodes: Node[],
  edges: Edge[],
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
  nodes: Node[],
  edges: Edge[],
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
      data: { label: node.name },
      style,
      draggable: false,
      selectable: true,
      type: "default",
      sourcePosition: "bottom",
      targetPosition: "top",
    });
    existingNodeIds.add(node.id);
  }

  const edgeSource = direction === "up" ? node.id : parentId;
  const edgeTarget = direction === "up" ? parentId : node.id;
  edges.push({
    id: `${edgeSource}->${edgeTarget}`,
    source: edgeSource,
    target: edgeTarget,
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
  collapsed: Set<string>
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [
    {
      id: centerId,
      position: { x: 0, y: 0 },
      data: { label: centerLabel },
      style: CENTER_NODE_STYLE,
      draggable: false,
      selectable: true,
      type: "default",
      sourcePosition: "bottom",
      targetPosition: "top",
    },
  ];
  const edges: Edge[] = [];
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

  return { nodes, edges };
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
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(() => new Set<string>());
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);

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
        const graph = createGraphData(
          rem._id,
          centerLabel,
          ancestorTreesResult,
          descendantTreesResult,
          collapsed
        );

        setAncestorTrees(ancestorTreesResult);
        setDescendantTrees(descendantTreesResult);
        setCollapsedNodes(collapsed);
        setNodes(graph.nodes);
        setEdges(graph.edges);
        setLoadedRemId(rem._id);
        setLoadedRemName(centerLabel);
      } catch (err) {
        console.error(err);
        setError("Failed to build inheritance hierarchy.");
      } finally {
        setLoading(false);
      }
    },
    [plugin]
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

    if (collapsedNodes.size > 0) {
      const next = new Set<string>();
      const graph = createGraphData(
        loadedRemId,
        loadedRemName || "(Untitled Rem)",
        ancestorTrees,
        descendantTrees,
        next
      );
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
        allIds
      );
      setCollapsedNodes(allIds);
      setNodes(graph.nodes);
      setEdges(graph.edges);
    }
  }, [ancestorTrees, descendantTrees, collapsedNodes, loadedRemId, loadedRemName]);


  const handleNodeClick = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.preventDefault();
      event.stopPropagation();
      if (!loadedRemId) return;
      if (node.id === loadedRemId) return;
      const target =
        findNodeById(ancestorTrees, node.id) ?? findNodeById(descendantTrees, node.id);
      if (!target || !target.children || target.children.length === 0) {
        return;
      }
      const next = new Set<string>(collapsedNodes);
      if (next.has(node.id)) {
        next.delete(node.id);
      } else {
        next.add(node.id);
      }
      const graph = createGraphData(
        loadedRemId,
        loadedRemName || "(Untitled Rem)",
        ancestorTrees,
        descendantTrees,
        next
      );
      setCollapsedNodes(next);
      setNodes(graph.nodes);
      setEdges(graph.edges);
    },
    [ancestorTrees, descendantTrees, collapsedNodes, loadedRemId, loadedRemName]
  );

  const handleNodeContextMenu = useCallback(
    async (event: React.MouseEvent, node: Node) => {
      event.preventDefault();
      event.stopPropagation();
      if (!node?.id) return;

      const rem = (await plugin.rem.findOne(node.id)) as Rem | null;
      if (!rem) return;

      const label = typeof (node as any)?.data?.label === 'string' ? (node as any).data.label : '';
      const trimmedLabel = label.trim();
      setEditRemId(rem._id);
      setEditRemName(trimmedLabel.length > 0 ? trimmedLabel : '(Untitled Rem)');

      //void plugin.window.openRem(rem);
    },
    [plugin]
  );

  useEffect(() => {
    if (reactFlowInstance && nodes.length > 0) {
      reactFlowInstance.fitView({ padding: 0.25, duration: 300 });
    }
  }, [reactFlowInstance, nodes]);

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
              onInit={setReactFlowInstance}
              onNodeClick={handleNodeClick}
              onNodeContextMenu={handleNodeContextMenu}
              nodesDraggable={false}
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













