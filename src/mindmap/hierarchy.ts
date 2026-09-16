import { PluginRem, RNPlugin, RemType } from "@remnote/plugin-sdk";
import { getRemText, getParentClass, getExtendsChildren, getCleanChildren, hasTag, isPropertyDescriptor } from "../utils/utils";
import { HierarchyNode, LoadComputationContext } from "./types";
import { TimeoutSignal, isTimedOut } from "./timeout";
import { getParentClassCached } from "./cache";

export async function buildAncestorNodes(
  plugin: RNPlugin,
  rem: PluginRem,
  visited: Set<string>,
  computationContext?: LoadComputationContext,
  signal?: TimeoutSignal
): Promise<HierarchyNode[]> {
  if (signal && isTimedOut(signal)) {
    return [];
  }

  const parents = computationContext
    ? await getParentClassCached(plugin, rem, computationContext)
    : await getParentClass(plugin, rem);
  const uniqueParents = new Map<string, PluginRem>();
  for (const parent of parents) {
    const skip = !parent || parent._id === rem._id || visited.has(parent._id);
    if (skip) continue;
    uniqueParents.set(parent._id, parent);
  }

  const result: HierarchyNode[] = [];
  for (const parent of uniqueParents.values()) {
    if (signal && isTimedOut(signal)) {
      break;
    }

    visited.add(parent._id);
    const [name, ancestors, isExported] = await Promise.all([
      getRemText(plugin, parent),
      buildAncestorNodes(plugin, parent, visited, computationContext, signal),
      hasTag(plugin, parent, "Export"),
    ]);
    result.push({
      id: parent._id,
      name: name || "(Untitled Rem)",
      richText: parent.text,
      remRef: parent,
      children: ancestors,
      isExported,
    });
  }

  return result;
}

export async function getStructuralDescendantChildren(plugin: RNPlugin, rem: PluginRem): Promise<PluginRem[]> {
  const children = await getCleanChildren(plugin, rem);
  const meta = await Promise.all(
    children.map(async (child) => {
      const [isDoc, type] = await Promise.all([child.isDocument(), child.getType()]);
      const isPropDesc = type === RemType.DESCRIPTOR ? await isPropertyDescriptor(plugin, child) : false;
      return { child, isDoc, type, isPropDesc };
    })
  );
  return meta
    .filter(({ isDoc, type, isPropDesc }) => !isDoc && (type !== RemType.DESCRIPTOR || isPropDesc))
    .map(({ child }) => child);
}

export async function buildDescendantNodes(
  plugin: RNPlugin,
  rem: PluginRem,
  visited: Set<string>,
  signal?: TimeoutSignal
): Promise<HierarchyNode[]> {
  if (signal && isTimedOut(signal)) {
    return [];
  }

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
    if (signal && isTimedOut(signal)) {
      break;
    }
    if (await isPropertyDescriptor(plugin, child)) continue;

    visited.add(child._id);
    const [name, descendants, isExported] = await Promise.all([
      getRemText(plugin, child),
      buildDescendantNodes(plugin, child, visited, signal),
      hasTag(plugin, child, "Export"),
    ]);
    result.push({
      id: child._id,
      name: name || "(Untitled Rem)",
      richText: child.text,
      remRef: child,
      children: descendants,
      isExported,
    });
  }

  return result;
}

export function findNodeById(forest: HierarchyNode[], id: string): HierarchyNode | null {
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

export const buildDescendantOwnerMap = (descendants: HierarchyNode[]): Record<string, string> => {
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

export function collectRemsForProperties(
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

export function buildHierarchyRemIdSet(centerId: string, ancestors: HierarchyNode[], descendants: HierarchyNode[]): Set<string> {
  const ids = new Set<string>([centerId]);
  const stack: HierarchyNode[] = [...ancestors, ...descendants];
  while (stack.length > 0) {
    const hn = stack.pop()!;
    ids.add(hn.id);
    if (hn.children && hn.children.length > 0) {
      stack.push(...hn.children);
    }
  }
  return ids;
}
