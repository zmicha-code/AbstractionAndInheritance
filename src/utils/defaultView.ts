export type CollapsibleHierarchyNode = {
  id: string;
  children?: CollapsibleHierarchyNode[];
};

export function collapseHierarchy(
  collapsed: Set<string>,
  nodes: CollapsibleHierarchyNode[] | undefined
): void {
  if (!nodes?.length) return;
  for (const node of nodes) {
    if (node.children?.length) {
      collapsed.add(node.id);
      collapseHierarchy(collapsed, node.children);
    }
  }
}

export function collapseAttributeForests(
  collapsed: Set<string>,
  forests: Array<Record<string, CollapsibleHierarchyNode[]> | null | undefined>
): void {
  for (const byOwner of forests) {
    if (!byOwner) continue;
    for (const attrs of Object.values(byOwner)) {
      collapseHierarchy(collapsed, attrs);
    }
  }
}

/** Collapse every rem and attribute node that has further hierarchy. */
export function makeDefaultView(
  collapsed: Set<string>,
  ancestors: CollapsibleHierarchyNode[],
  descendants: CollapsibleHierarchyNode[],
  attributeForests: Array<Record<string, CollapsibleHierarchyNode[]> | null | undefined> = []
): void {
  collapseHierarchy(collapsed, ancestors);
  collapseHierarchy(collapsed, descendants);
  collapseAttributeForests(collapsed, attributeForests);
}

export function findInAttributeForest<T extends CollapsibleHierarchyNode>(
  byOwner: Record<string, T[]> | undefined,
  id: string
): T | null {
  if (!byOwner) return null;
  const stack: T[] = [];
  for (const attrs of Object.values(byOwner)) {
    stack.push(...attrs);
  }
  while (stack.length) {
    const node = stack.pop()!;
    if (node.id === id) return node;
    if (node.children?.length) {
      stack.push(...(node.children as T[]));
    }
  }
  return null;
}
