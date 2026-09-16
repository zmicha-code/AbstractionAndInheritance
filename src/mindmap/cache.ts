import { PluginRem, RNPlugin } from "@remnote/plugin-sdk";
import { getParentClass, getExtendsChildren } from "../utils/utils";
import { HierarchyNode, LoadComputationContext } from "./types";
import { TimeoutSignal, isTimedOut } from "./timeout";

export function createLoadComputationContext(): LoadComputationContext {
  return {
    virtualDataByKind: {},
    parentClassCache: new Map<string, PluginRem[]>(),
    remLookupCache: new Map<string, PluginRem | null>(),
    extendsChildrenCache: new Map<string, PluginRem[]>(),
  };
}

export function collectRemRefs(forest: HierarchyNode[]): Map<string, PluginRem> {
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
}

export async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<void>,
  signal?: TimeoutSignal
): Promise<void> {
  if (items.length === 0) return;
  let index = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));

  const worker = async () => {
    while (index < items.length) {
      if (signal && isTimedOut(signal)) return;
      const currentIndex = index;
      index += 1;
      await mapper(items[currentIndex], currentIndex);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, worker));
}

export async function getParentClassCached(
  plugin: RNPlugin,
  rem: PluginRem,
  context: LoadComputationContext
): Promise<PluginRem[]> {
  const cached = context.parentClassCache.get(rem._id);
  if (cached) {
    return cached;
  }
  const parents = await getParentClass(plugin, rem);
  context.parentClassCache.set(rem._id, parents);
  return parents;
}

export async function getExtendsChildrenCached(
  plugin: RNPlugin,
  rem: PluginRem,
  context: LoadComputationContext
): Promise<PluginRem[]> {
  const cached = context.extendsChildrenCache.get(rem._id);
  if (cached) {
    return cached;
  }
  const children = await getExtendsChildren(plugin, rem);
  context.extendsChildrenCache.set(rem._id, children);
  return children;
}

export async function findRemCached(
  plugin: RNPlugin,
  remId: string,
  context: LoadComputationContext
): Promise<PluginRem | null> {
  if (context.remLookupCache.has(remId)) {
    return context.remLookupCache.get(remId) ?? null;
  }
  const rem = (await plugin.rem.findOne(remId)) as PluginRem | null;
  context.remLookupCache.set(remId, rem);
  return rem;
}

export async function buildCompleteChildToParentsMap(
  plugin: RNPlugin,
  centerId: string,
  ancestors: HierarchyNode[],
  descendants: HierarchyNode[],
  context: LoadComputationContext,
  signal?: TimeoutSignal
): Promise<Record<string, Set<string>>> {
  if (context.childToParentsMap) {
    return context.childToParentsMap;
  }

  const childToParentsMap: Record<string, Set<string>> = {};
  const ancestorRemRefs = collectRemRefs(ancestors);
  const descendantRemRefs = collectRemRefs(descendants);

  const populateParents = async (entries: Array<[string, PluginRem]>) => {
    await mapWithConcurrency(entries, 10, async ([remId, remRef]) => {
      if (signal && isTimedOut(signal)) return;
      const parents = await getParentClassCached(plugin, remRef, context);
      childToParentsMap[remId] = new Set(
        parents.filter((p) => p).map((p) => p._id)
      );
    }, signal);
  };

  await populateParents([...ancestorRemRefs.entries()]);
  childToParentsMap[centerId] = new Set(ancestors.map((a) => a.id));
  await populateParents([...descendantRemRefs.entries()]);

  let newParentIds = new Set<string>();
  for (const parentIds of Object.values(childToParentsMap)) {
    for (const parentId of parentIds) {
      if (!childToParentsMap[parentId]) {
        newParentIds.add(parentId);
      }
    }
  }

  while (newParentIds.size > 0 && !(signal && isTimedOut(signal))) {
    const toResolve = [...newParentIds];
    newParentIds = new Set();

    await mapWithConcurrency(toResolve, 10, async (parentId) => {
      if (signal && isTimedOut(signal)) return;
      if (childToParentsMap[parentId]) return;

      const parentRem = await findRemCached(plugin, parentId, context);
      if (!parentRem) {
        childToParentsMap[parentId] = new Set();
        return;
      }

      const grandparents = await getParentClassCached(plugin, parentRem, context);
      childToParentsMap[parentId] = new Set(
        grandparents.filter((p) => p).map((p) => p._id)
      );

      for (const gp of grandparents) {
        if (gp && !childToParentsMap[gp._id]) {
          newParentIds.add(gp._id);
        }
      }
    }, signal);
  }

  context.childToParentsMap = childToParentsMap;
  return childToParentsMap;
}
