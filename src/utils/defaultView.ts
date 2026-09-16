export type CollapsibleHierarchyNode = {
  id: string;
  children?: CollapsibleHierarchyNode[];
};

function collapseHierarchy(
  collapsed: Set<string>,
  nodes: CollapsibleHierarchyNode[]
): void {
  for (const node of nodes) {
    if (node.children?.length) {
      collapsed.add(node.id);
      collapseHierarchy(collapsed, node.children);
    }
  }
}

export function makeDefaultView(
  collapsed: Set<string>,
  ancestors: CollapsibleHierarchyNode[],
  descendants: CollapsibleHierarchyNode[]
): void {
  collapseHierarchy(collapsed, ancestors);
  collapseHierarchy(collapsed, descendants);
}
