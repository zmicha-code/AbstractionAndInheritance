import { MarkerType } from "reactflow";
import { PluginRem, RNPlugin, RichTextInterface } from "@remnote/plugin-sdk";
import { getNodeStyle } from "../components/Nodes";
import { getExtendsChildren } from "../utils/utils";
import {
  HierarchyNode,
  GraphNode,
  GraphEdge,
  AttributeData,
  LoadComputationContext,
  VirtualAttributeData,
} from "./types";
import { TimeoutSignal } from "./timeout";
import { createLoadComputationContext, findRemCached, buildCompleteChildToParentsMap } from "./cache";
import { layoutForestHorizontal } from "./remLayout";
import { integrateAttributeGraph } from "./attributeLayout";
import { buildVirtualAttributeData } from "./virtualData";
import { getStructuralDescendantChildren } from "./hierarchy";
import {
  REM_SOURCE_RIGHT_HANDLE,
  REM_TARGET_LEFT_HANDLE,
  REM_SOURCE_LEFT_HANDLE,
  REM_TARGET_RIGHT_HANDLE,
  getColorForNode,
} from "./constants";

export async function createGraphData(
  plugin: RNPlugin,
  centerId: string,
  centerLabel: string,
  centerRichText: RichTextInterface | undefined,
  ancestors: HierarchyNode[],
  descendants: HierarchyNode[],
  collapsed: Set<string>,
  attributeData: AttributeData | undefined,
  hiddenAttributes: Set<string>,
  hiddenVirtualAttributes: Set<string>,
  nodePositions: Map<string, { x: number; y: number }>,
  kind: "property" | "interface" | "directProperty",
  secondaryAttributeData?: AttributeData,
  secondaryKind?: "property" | "interface" | "directProperty",
  computationContext?: LoadComputationContext,
  signal?: TimeoutSignal
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const context = computationContext ?? createLoadComputationContext();
  const centerStored = nodePositions?.get(centerId);
  const isCenterCollapsed = collapsed.has(centerId);
  const centerGraphNode: GraphNode = {
    id: centerId,
    position: centerStored ? { ...centerStored } : { x: 0, y: 0 },
    data: { label: centerLabel, richText: centerRichText, remId: centerId, kind: "rem" },
    style: getNodeStyle("rem", isCenterCollapsed, true),
    draggable: true,
    selectable: true,
    type: "remNode",
  };

  const nodes: GraphNode[] = [centerGraphNode];
  const edges: GraphEdge[] = [];
  const existingIds = new Set<string>([centerId]);

  let virtualData: VirtualAttributeData | undefined;
  if (attributeData) {
    virtualData = context.virtualDataByKind[kind];
    if (!virtualData) {
      const childToParentsMap = await buildCompleteChildToParentsMap(
        plugin,
        centerId,
        ancestors,
        descendants,
        context,
        signal
      );
      virtualData = buildVirtualAttributeData(attributeData, centerId, ancestors, descendants, kind, childToParentsMap, new Set([centerId]));
      context.virtualDataByKind[kind] = virtualData;
    }
  }

  if (!isCenterCollapsed) {
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
  }

  let result = { nodes, edges };
  if (secondaryAttributeData && secondaryKind) {
    result = await integrateAttributeGraph(plugin, result.nodes, result.edges, secondaryAttributeData, hiddenAttributes, hiddenVirtualAttributes, collapsed, nodePositions, secondaryKind, centerId, ancestors, descendants, context, signal);
  }
  result = await integrateAttributeGraph(plugin, result.nodes, result.edges, attributeData, hiddenAttributes, hiddenVirtualAttributes, collapsed, nodePositions, kind, centerId, ancestors, descendants, context, signal);
  return result;
}

export async function addMissingRemEdges(
  plugin: RNPlugin,
  nodes: GraphNode[],
  edges: GraphEdge[],
  childToParentsMap?: Record<string, Set<string>>,
  computationContext?: LoadComputationContext
): Promise<GraphEdge[]> {
  const visibleRemIds = new Set(nodes.filter((n) => n.type === "remNode").map((n) => n.id));
  const edgeMap = new Map(edges.map((e) => [`${e.source}->${e.target}`, e.id]));
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const context = computationContext;
  const newEdges: GraphEdge[] = [];

  const addEdgeIfMissing = (sourceId: string, targetId: string) => {
    const edgeId = `${sourceId}->${targetId}`;
    if (edgeMap.has(edgeId)) return;
    const sourceNode = nodeMap.get(sourceId);
    const targetNode = nodeMap.get(targetId);
    let sourceHandle = REM_SOURCE_RIGHT_HANDLE;
    let targetHandle = REM_TARGET_LEFT_HANDLE;
    if (sourceNode && targetNode && sourceNode.position.x > targetNode.position.x) {
      sourceHandle = REM_SOURCE_LEFT_HANDLE;
      targetHandle = REM_TARGET_RIGHT_HANDLE;
    }
    newEdges.push({
      id: edgeId,
      source: sourceId,
      target: targetId,
      sourceHandle,
      targetHandle,
      type: "randomOffset",
      markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
      style: { stroke: getColorForNode(sourceId) },
    });
    edgeMap.set(edgeId, edgeId);
  };

  if (childToParentsMap) {
    for (const childId of visibleRemIds) {
      const parents = childToParentsMap[childId];
      if (!parents) continue;
      for (const parentId of parents) {
        if (!visibleRemIds.has(parentId)) continue;
        addEdgeIfMissing(parentId, childId);
      }
    }
    return [...edges, ...newEdges];
  }

  for (const remId of visibleRemIds) {
    const rem = context
      ? await findRemCached(plugin, remId, context)
      : await plugin.rem.findOne(remId);
    if (!rem) continue;
    const [extendsC, structuralC] = await Promise.all([
      getExtendsChildren(plugin, rem),
      getStructuralDescendantChildren(plugin, rem),
    ]);
    const childrenIds = [...new Set([...extendsC, ...structuralC].filter((c) => c).map((c) => c._id).filter((id) => visibleRemIds.has(id)))];
    for (const childId of childrenIds) {
      addEdgeIfMissing(rem._id, childId);
    }
  }
  return [...edges, ...newEdges];
}
