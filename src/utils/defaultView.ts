export type CollapsibleHierarchyNode = {
  id: string;
  children?: CollapsibleHierarchyNode[];
};

/** Collapse first-sphere parent and child rem nodes (forest roots with further hierarchy). */
export function makeDefaultView(
  collapsed: Set<string>,
  ancestors: CollapsibleHierarchyNode[],
  descendants: CollapsibleHierarchyNode[]
): void {
  for (const node of ancestors) {
    if (node.children?.length) {
      collapsed.add(node.id);
    }
  }
  for (const node of descendants) {
    if (node.children?.length) {
      collapsed.add(node.id);
    }
  }
}
