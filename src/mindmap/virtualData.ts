import { HierarchyNode, AttributeData, AttributeNodeInfo, VirtualAttributeData, VirtualAttributeInfo } from "./types";

export function buildVirtualAttributeData(
  attributeData: AttributeData,
  centerId: string,
  ancestors: HierarchyNode[],
  descendants: HierarchyNode[],
  kind: "property" | "interface" | "directProperty",
  childToParentsMap: Record<string, Set<string>>,
  allowedOwnerIds?: Set<string>
): VirtualAttributeData {
  const byOwner: Record<string, VirtualAttributeInfo[]> = {};
  const ancestorIdToName: Record<string, string> = {};
  const buildAncestorNameMap = (nodes: HierarchyNode[]) => {
    for (const node of nodes) {
      ancestorIdToName[node.id] = node.name;
      if (node.children?.length) buildAncestorNameMap(node.children);
    }
  };
  buildAncestorNameMap(ancestors);
  buildAncestorNameMap(descendants);

  const propertyExtendsMap: Record<string, string[]> = {};
  for (const detail of Object.values(attributeData.byId)) {
    propertyExtendsMap[detail.id] = detail.extends;
  }

  const computeRootProperty = (propId: string): string => {
    let current = propId;
    const visited = new Set<string>();
    while (true) {
      visited.add(current);
      const parents = propertyExtendsMap[current];
      if (parents && parents.length > 0) {
        const next = parents[0];
        if (!visited.has(next)) {
          current = next;
          continue;
        }
      }
      const structParent = attributeData.byId[current]?.parentId;
      if (structParent && !visited.has(structParent) && attributeData.byId[structParent]) {
        current = structParent;
        continue;
      }
      return current;
    }
  };

  const getPropertyAncestors = (propId: string): Set<string> => {
    const result = new Set<string>();
    const stack = [...(propertyExtendsMap[propId] || [])];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (result.has(current)) continue;
      result.add(current);
      stack.push(...(propertyExtendsMap[current] || []));
    }
    return result;
  };

  const getChildrenForOwnerFromById = (ownerId: string): AttributeNodeInfo[] => {
    const children: AttributeNodeInfo[] = [];
    for (const detail of Object.values(attributeData.byId)) {
      if (detail.ownerNodeId === ownerId) {
        children.push({
          id: detail.id,
          label: "",
          hierarchyLevel: detail.hierarchyLevel,
          extends: detail.extends,
          children: [],
          isPrivate: detail.isPrivate,
          isDescriptorProperty: detail.isDescriptorProperty,
          isExported: detail.isExported,
        });
      }
    }
    return children;
  };

  const buildVirtualChildren = (
    children: AttributeNodeInfo[],
    ownerRemId: string,
    sourceRemId: string,
    sourceRemLabel: string,
    parentHierarchyLevel: number
  ): VirtualAttributeInfo[] => {
    return children.map((child) => ({
      id: `virtual:${ownerRemId}:${child.id}`,
      label: child.label,
      richText: child.richText,
      hierarchyLevel: parentHierarchyLevel,
      sourcePropertyId: child.id,
      ownerRemId,
      sourceRemId,
      sourceRemLabel,
      children: buildVirtualChildren(child.children, ownerRemId, sourceRemId, sourceRemLabel, parentHierarchyLevel),
      extendsVirtualIds: [],
      isDescriptorProperty: child.isDescriptorProperty,
      isDepthCutoff: child.isDepthCutoff,
    }));
  };

  const implementedByOwner: Record<string, Set<string>> = {};
  const collectImplementedIds = (attrs: AttributeNodeInfo[]): Set<string> => {
    const result = new Set<string>();
    for (const attr of attrs) {
      result.add(attr.id);
      for (const extId of attr.extends) {
        result.add(extId);
        getPropertyAncestors(extId).forEach((id) => result.add(id));
      }
      collectImplementedIds(attr.children).forEach((id) => result.add(id));
    }
    return result;
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

  const allAncestorIds = collectAllIdsFromForest(ancestors);
  const allDescendantIds = collectAllIdsFromForest(descendants);
  const allHierarchyRemIds = new Set([centerId, ...allAncestorIds, ...allDescendantIds]);

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
          if (!visited.has(parent)) stack.push(parent);
        }
      }
    }
    return result;
  };

  const allOwnerIds = new Set(Object.values(attributeData.byId).map((d) => d.ownerNodeId));
  for (const ownerId of allOwnerIds) {
    const attrs = getChildrenForOwnerFromById(ownerId).filter((attr) => !allHierarchyRemIds.has(attr.id));
    implementedByOwner[ownerId] = collectImplementedIds(attrs);
  }

  const allRemIds = [centerId, ...allAncestorIds, ...allDescendantIds];
  for (const remId of allRemIds) {
    if (!implementedByOwner[remId]) implementedByOwner[remId] = new Set();
    for (const ancestorId of computeTransitiveAncestors(remId)) {
      implementedByOwner[remId].add(ancestorId);
    }
  }

  const remAncestorMap: Record<string, string[]> = {};
  for (const ancestorId of allAncestorIds) remAncestorMap[ancestorId] = [...computeTransitiveAncestors(ancestorId)];
  remAncestorMap[centerId] = [...computeTransitiveAncestors(centerId)];
  for (const descendantId of allDescendantIds) remAncestorMap[descendantId] = [...computeTransitiveAncestors(descendantId)];

  const parentToChildrenMap: Record<string, Set<string>> = {};
  for (const [childId, parentIds] of Object.entries(childToParentsMap)) {
    for (const parentId of parentIds) {
      if (!parentToChildrenMap[parentId]) parentToChildrenMap[parentId] = new Set();
      parentToChildrenMap[parentId].add(childId);
    }
  }

  const computeTransitiveDescendants = (nodeId: string): Set<string> => {
    const result = new Set<string>();
    const visited = new Set<string>();
    const stack = [...(parentToChildrenMap[nodeId] || [])];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      result.add(current);
      const children = parentToChildrenMap[current];
      if (children) {
        for (const child of children) {
          if (!visited.has(child)) stack.push(child);
        }
      }
    }
    return result;
  };

  const ancestorDistanceCache = new Map<string, Map<string, number>>();
  const getAncestorDistanceMap = (nodeId: string): Map<string, number> => {
    const cached = ancestorDistanceCache.get(nodeId);
    if (cached) return cached;
    const distances = new Map<string, number>();
    distances.set(nodeId, 0);
    const queue: Array<{ id: string; depth: number }> = [{ id: nodeId, depth: 0 }];
    while (queue.length > 0) {
      const current = queue.shift() as { id: string; depth: number };
      const parents = childToParentsMap[current.id];
      if (!parents || parents.size === 0) continue;
      for (const parentId of parents) {
        const nextDepth = current.depth + 1;
        const prev = distances.get(parentId);
        if (prev !== undefined && prev <= nextDepth) continue;
        distances.set(parentId, nextDepth);
        queue.push({ id: parentId, depth: nextDepth });
      }
    }
    ancestorDistanceCache.set(nodeId, distances);
    return distances;
  };

  const getHierarchyLevel = (ownerRemId: string, sourceRemId: string): number => {
    if (ownerRemId === sourceRemId) return -1;
    const ownerDistances = getAncestorDistanceMap(ownerRemId);
    const sourceDistances = getAncestorDistanceMap(sourceRemId);
    let minSharedDepth = Number.POSITIVE_INFINITY;
    for (const sharedId of sourceDistances.keys()) {
      const depthFromOwner = ownerDistances.get(sharedId);
      if (depthFromOwner === undefined || depthFromOwner <= 0) continue;
      if (depthFromOwner < minSharedDepth) minSharedDepth = depthFromOwner;
    }
    if (!Number.isFinite(minSharedDepth)) return 0;
    return Math.max(0, minSharedDepth - 1);
  };

  for (const [remId, ancestorIds] of Object.entries(remAncestorMap)) {
    if (allowedOwnerIds && !allowedOwnerIds.has(remId)) continue;
    if (attributeData.byId[remId]?.isDescriptorProperty) continue;

    const implemented = implementedByOwner[remId] || new Set<string>();
    const candidateVirtualAttrs: VirtualAttributeInfo[] = [];
    const remAncestorSet = new Set(ancestorIds);
    const remDescendantSet = computeTransitiveDescendants(remId);

    const implementedBaseInterfaces = new Set<string>();
    for (const child of getChildrenForOwnerFromById(remId)) {
      for (const extId of child.extends) {
        implementedBaseInterfaces.add(extId);
        getPropertyAncestors(extId).forEach((id) => implementedBaseInterfaces.add(id));
      }
    }

    for (const ancestorId of ancestorIds) {
      for (const prop of attributeData.byOwner[ancestorId] || []) {
        if (prop.id === remId) continue;
        if (!prop.isExported) continue;
        if (prop.isPrivate) continue;
        if (remAncestorSet.has(prop.id)) continue;
        if (remDescendantSet.has(prop.id)) continue;
        if (implementedBaseInterfaces.has(prop.id)) continue;
        if (implemented.has(prop.id)) continue;
        if (candidateVirtualAttrs.some((v) => v.sourcePropertyId === prop.id)) continue;
        const sourceRemLabel = ancestorIdToName[ancestorId] || ancestorId;
        const hierarchyLevel = getHierarchyLevel(remId, ancestorId);
        const baseTypeId = computeRootProperty(prop.id);
        candidateVirtualAttrs.push({
          id: `virtual:${remId}:${prop.id}`,
          label: prop.label,
          richText: prop.richText,
          hierarchyLevel,
          sourcePropertyId: prop.id,
          ownerRemId: remId,
          sourceRemId: ancestorId,
          sourceRemLabel,
          children: prop.isDescriptorProperty ? [] : buildVirtualChildren(prop.children, remId, ancestorId, sourceRemLabel, hierarchyLevel),
          isDescriptorProperty: prop.isDescriptorProperty,
          extendsVirtualIds: [],
          isDepthCutoff: prop.isDepthCutoff,
          baseTypeId,
          baseTypeLabel: attributeData.byId[baseTypeId]?.label ?? prop.label,
        });
      }
    }

    const candidateSourceIds = new Set(candidateVirtualAttrs.map((c) => c.sourcePropertyId));
    const ancestorSourceIds = new Set<string>();
    for (const candidate of candidateVirtualAttrs) {
      for (const ancestorId of getPropertyAncestors(candidate.sourcePropertyId)) {
        if (candidateSourceIds.has(ancestorId)) ancestorSourceIds.add(ancestorId);
      }
    }

    if (kind === "interface") {
      for (const candidate of candidateVirtualAttrs) {
        if (ancestorSourceIds.has(candidate.sourcePropertyId)) {
          candidate.label = `(${candidate.label})`;
          candidate.richText = undefined;
        }
      }
      if (candidateVirtualAttrs.length > 0) byOwner[remId] = candidateVirtualAttrs;
    } else {
      const filtered = candidateVirtualAttrs.filter((c) => !ancestorSourceIds.has(c.sourcePropertyId));
      if (filtered.length > 0) byOwner[remId] = filtered;
    }
  }

  return { byOwner };
}
