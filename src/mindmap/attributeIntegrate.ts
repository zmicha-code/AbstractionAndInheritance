import { MarkerType } from "reactflow";
import { PluginRem, RNPlugin } from "@remnote/plugin-sdk";
import { getExtendsParents } from "../utils/utils";
import {
  GraphNode,
  GraphEdge,
  GraphNodeData,
  AttributeData,
  HierarchyNode,
  LoadComputationContext,
} from "./types";
import { TimeoutSignal } from "./timeout";
import {
  ATTRIBUTE_SOURCE_RIGHT_HANDLE,
  ATTRIBUTE_TARGET_LEFT_HANDLE,
  REM_TARGET_LEFT_HANDLE,
  getColorForNode,
} from "./constants";
import { attributeNodeId } from "./attributeData";
import { findRemCached, buildCompleteChildToParentsMap, createLoadComputationContext } from "./cache";
import { buildVirtualAttributeData } from "./virtualData";
import { layoutVirtualAttributes } from "./virtualLayout";
import { layoutAttributeTree } from "./attributeTrees";

export async function integrateAttributeGraph(
  plugin: RNPlugin,
  nodes: GraphNode[],
  edges: GraphEdge[],
  attributeData?: AttributeData,
  hiddenAttributes?: Set<string>,
  hiddenVirtualAttributes?: Set<string>,
  collapsed?: Set<string>,
  nodePositions?: Map<string, { x: number; y: number }>,
  kind?: "property" | "interface" | "directProperty",
  centerId?: string,
  ancestors?: HierarchyNode[],
  descendants?: HierarchyNode[],
  computationContext?: LoadComputationContext,
  signal?: TimeoutSignal
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  if (!attributeData || !collapsed || !kind) {
    return { nodes, edges };
  }

  const context = computationContext ?? createLoadComputationContext();
  const existingNodeIds = new Set(nodes.map((node) => node.id));
  const existingEdgeIds = new Set(edges.map((edge) => edge.id));
  const baseNodeMap = new Map(
    nodes.filter((node) => node.data.kind === "rem").map((node) => [node.id, node])
  );

  const countAttributeNodesForOwner = (ownerId: string): number => {
    let count = 0;
    for (const node of nodes) {
      const data = node.data as GraphNodeData;
      if (data.kind === "rem" || data.kind === "virtualInterfaceGroup") continue;
      if (data.ownerRemId === ownerId) {
        count++;
        continue;
      }
      const hasOwnerEdge = edges.some(
        (e) =>
          e.source === ownerId &&
          (e.id === `attr-link:${ownerId}->${data.remId}` || e.id === `vattr-link:${ownerId}->${node.id}`)
      );
      if (hasOwnerEdge) count++;
    }
    return count;
  };

  const collectAllIdsFromForest = (forest: HierarchyNode[]): string[] => {
    const ids: string[] = [];
    const stack = [...forest];
    while (stack.length > 0) {
      const node = stack.pop()!;
      ids.push(node.id);
      if (node.children?.length) stack.push(...node.children);
    }
    return ids;
  };

  if (kind === "property" || kind === "directProperty") {
    for (const [ownerId, attributeList] of Object.entries(attributeData.byOwner)) {
      const ownerNode = baseNodeMap.get(ownerId);
      if (!ownerNode || attributeList.length === 0) continue;
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
        nodePositions,
        countAttributeNodesForOwner(ownerId)
      );
    }
  } else if (kind === "interface" && ancestors && descendants && centerId) {
    const ancestorIds = collectAllIdsFromForest(ancestors);
    const descendantIds = collectAllIdsFromForest(descendants);
    const ancestorIdSet = new Set(ancestorIds);
    const allHierarchyRemIds = new Set([centerId, ...ancestorIds, ...descendantIds]);
    for (const [ownerId, attributeList] of Object.entries(attributeData.byOwner)) {
      if (!ancestorIdSet.has(ownerId)) continue;
      const ownerNode = baseNodeMap.get(ownerId);
      if (!ownerNode || attributeList.length === 0) continue;
      const actualInterfaces = attributeList.filter((attr) => !allHierarchyRemIds.has(attr.id));
      if (actualInterfaces.length === 0) continue;
      layoutAttributeTree(
        ownerNode,
        actualInterfaces,
        nodes,
        edges,
        existingNodeIds,
        existingEdgeIds,
        hiddenAttributes,
        attributeData,
        collapsed,
        kind,
        nodePositions,
        countAttributeNodesForOwner(ownerId)
      );
    }
  }

  if (centerId && ancestors && descendants) {
    let virtualData = context.virtualDataByKind[kind];
    if (!virtualData) {
      const childToParentsMap = await buildCompleteChildToParentsMap(
        plugin,
        centerId,
        ancestors,
        descendants,
        context,
        signal
      );
      virtualData = buildVirtualAttributeData(
        attributeData,
        centerId,
        ancestors,
        descendants,
        kind,
        childToParentsMap,
        new Set([centerId])
      );
      context.virtualDataByKind[kind] = virtualData;
    }
    for (const [ownerId, virtualAttrs] of Object.entries(virtualData.byOwner)) {
      const ownerNode = baseNodeMap.get(ownerId);
      if (!ownerNode || virtualAttrs.length === 0) continue;
      const visibleVirtualAttrs = hiddenVirtualAttributes
        ? virtualAttrs.filter((v) => !hiddenVirtualAttributes.has(v.id))
        : virtualAttrs;
      if (visibleVirtualAttrs.length === 0) continue;
      layoutVirtualAttributes(
        ownerNode,
        visibleVirtualAttrs,
        countAttributeNodesForOwner(ownerId),
        nodes,
        edges,
        existingNodeIds,
        existingEdgeIds,
        kind,
        collapsed,
        nodePositions
      );
    }
  }

  async function findClosestVisibleAncestor(
    attributeId: string,
    existingNodeIds: Set<string>,
    kind: "property" | "interface" | "directProperty"
  ): Promise<string | null> {
    const visited = new Set<string>();
    const queue: string[] = [attributeId];
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);
      const nodeId = attributeNodeId(kind, currentId);
      if (existingNodeIds.has(nodeId)) return currentId;
      let currentRem: PluginRem | null = null;
      try {
        currentRem = await findRemCached(plugin, currentId, context);
      } catch {
        currentRem = null;
      }
      if (!currentRem) continue;
      try {
        const [parentRem, isDoc] = await Promise.all([currentRem.getParentRem(), currentRem.isDocument()]);
        if (!isDoc && parentRem && !visited.has(parentRem._id)) queue.push(parentRem._id);
      } catch {
        // ignore
      }
      let parents: PluginRem[] = [];
      try {
        parents = await getExtendsParents(plugin, currentRem);
      } catch {
        parents = [];
      }
      for (const parent of parents) {
        if (!visited.has(parent._id)) queue.push(parent._id);
      }
    }
    return null;
  }

  for (const detail of Object.values(attributeData.byId)) {
    const childNodeId = attributeNodeId(kind, detail.id);
    if (!existingNodeIds.has(childNodeId)) continue;
    for (const parentId of detail.extends) {
      let visibleSourceId: string | null = parentId;
      if (!existingNodeIds.has(attributeNodeId(kind, parentId)) || hiddenAttributes?.has(parentId)) {
        visibleSourceId = await findClosestVisibleAncestor(parentId, existingNodeIds, kind);
      }
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
            style: { stroke: getColorForNode(sourceNodeId), strokeDasharray: "4 2" },
          });
          existingEdgeIds.add(edgeId);
        }
      }
    }
  }

  if (kind === "interface") {
    const remNodes = nodes.filter((n) => n.type === "remNode");
    const interfaceNodeIds = new Set(
      nodes.filter((n) => n.type === "interfaceNode").map((n) => (n.data as GraphNodeData).remId)
    );
    for (const remNode of remNodes) {
      const remId = remNode.id;
      if (existingNodeIds.has(attributeNodeId(kind, remId))) continue;
      let rem: PluginRem | null = null;
      try {
        rem = await findRemCached(plugin, remId, context);
      } catch {
        continue;
      }
      if (!rem) continue;
      let extendsParents: PluginRem[] = [];
      try {
        extendsParents = await getExtendsParents(plugin, rem);
      } catch {
        continue;
      }
      for (const parent of extendsParents) {
        if (existingNodeIds.has(parent._id)) continue;
        let visibleInterfaceId: string | null = parent._id;
        const directInterfaceNodeId = attributeNodeId(kind, parent._id);
        if (!existingNodeIds.has(directInterfaceNodeId) || hiddenAttributes?.has(parent._id)) {
          visibleInterfaceId = await findClosestVisibleAncestor(parent._id, existingNodeIds, kind);
        }
        if (visibleInterfaceId && interfaceNodeIds.has(visibleInterfaceId)) {
          const interfaceNodeId = attributeNodeId(kind, visibleInterfaceId);
          if (existingNodeIds.has(interfaceNodeId)) {
            const edgeId = `interface-to-rem:${visibleInterfaceId}->${remId}`;
            const attrExtEdgeId = `attr-ext:${visibleInterfaceId}->${remId}`;
            if (!existingEdgeIds.has(edgeId) && !existingEdgeIds.has(attrExtEdgeId)) {
              edges.push({
                id: edgeId,
                source: interfaceNodeId,
                target: remId,
                sourceHandle: ATTRIBUTE_SOURCE_RIGHT_HANDLE,
                targetHandle: REM_TARGET_LEFT_HANDLE,
                type: "randomOffset",
                markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
                style: { stroke: getColorForNode(interfaceNodeId), strokeDasharray: "4 2" },
              });
              existingEdgeIds.add(edgeId);
            }
          }
        }
      }
    }
  }

  return { nodes, edges };
}
