import { PluginRem, RNPlugin, RemType } from "@remnote/plugin-sdk";
import { getRemText, getExtendsChildren, getCleanChildren, getExtendsParents, hasTag, isPropertyDescriptor } from "../utils/utils";
import { AttributeData, AttributeNodeInfo, AttributeDetail, LoadComputationContext } from "./types";
import { TimeoutSignal, isTimedOut } from "./timeout";
import { getExtendsChildrenCached, mapWithConcurrency } from "./cache";
import { getStructuralDescendantChildren } from "./hierarchy";
import { compareByHierarchyThenLabel } from "./constants";

export function attributeNodeId(kind: "property" | "interface" | "directProperty", attributeId: string): string {
  return `${kind}:${attributeId}`;
}

export async function buildAttributeData(
  plugin: RNPlugin,
  rems: PluginRem[],
  topLevelIsDocument: boolean,
  skipTopLevelForId?: string,
  signal?: TimeoutSignal,
  hierarchyRemIds?: Set<string>,
  context?: LoadComputationContext
): Promise<AttributeData> {
  const byOwner: Record<string, AttributeNodeInfo[]> = {};
  const byId: Record<string, AttributeDetail> = {};
  const MAX_ATTRIBUTE_DEPTH = 3;

  async function collectAttributes(
    owner: PluginRem,
    ownerNodeId: string,
    isSubAttribute: boolean = false,
    parentId?: string,
    parentHierarchyLevel: number = -1,
    depth: number = 0
  ): Promise<AttributeNodeInfo[]> {
    if (signal && isTimedOut(signal)) {
      return [];
    }
    if (depth >= MAX_ATTRIBUTE_DEPTH) {
      const ownerLabel = await getRemText(plugin, owner).catch(() => owner._id);
      console.log(`[depth-limit] depth=${depth}/${MAX_ATTRIBUTE_DEPTH} rem=${owner._id} ("${ownerLabel}") parent=${parentId ?? "none"}`);
      return [];
    }
    if (!isSubAttribute && skipTopLevelForId && owner._id === skipTopLevelForId) {
      return [];
    }
    if (await owner.getType() === RemType.PORTAL) {
      return [];
    }
    let childrenRems: PluginRem[];
    if (!isSubAttribute) {
      const children = await getCleanChildren(plugin, owner);
      if (topLevelIsDocument) {
        childrenRems = children;
      } else {
        const [structuralChildren, extendsChildren] = await Promise.all([
          getStructuralDescendantChildren(plugin, owner),
          context ? getExtendsChildrenCached(plugin, owner, context) : getExtendsChildren(plugin, owner),
        ]);
        const merged = new Map<string, PluginRem>(structuralChildren.map((r) => [r._id, r]));
        for (const r of extendsChildren) {
          if (!merged.has(r._id) && !(hierarchyRemIds?.has(r._id))) {
            merged.set(r._id, r);
          }
        }
        childrenRems = Array.from(merged.values());
      }
    } else {
      const [structuralChildren, extendsChildren] = await Promise.all([
        getStructuralDescendantChildren(plugin, owner),
        context ? getExtendsChildrenCached(plugin, owner, context) : getExtendsChildren(plugin, owner),
      ]);
      const merged = new Map<string, PluginRem>(structuralChildren.map((r) => [r._id, r]));
      for (const r of extendsChildren) {
        if (!merged.has(r._id) && !(hierarchyRemIds?.has(r._id))) {
          merged.set(r._id, r);
        }
      }
      childrenRems = Array.from(merged.values());
    }
    if (signal && isTimedOut(signal)) {
      return [];
    }
    const metaResults = await Promise.all(
      childrenRems.map(async (attr) => {
        const [type, labelRaw, parentRems, isPrivate, isDescriptorProperty, hasExportTag, isDoc] = await Promise.all([
          attr.getType(),
          getRemText(plugin, attr),
          getExtendsParents(plugin, attr).catch(() => [] as PluginRem[]),
          hasTag(plugin, attr, "Private"),
          isPropertyDescriptor(plugin, attr),
          hasTag(plugin, attr, "Export"),
          attr.isDocument(),
        ]);
        return { attr, type, labelRaw, parentRems, isPrivate, isDescriptorProperty, hasExportTag, isDoc };
      })
    );
    const filteredMeta = metaResults.filter(({ attr, type, isDescriptorProperty, hasExportTag, isDoc }) => {
      if (skipTopLevelForId && attr._id === skipTopLevelForId) return false;
      if (type === RemType.PORTAL) return false;
      if (!isSubAttribute && topLevelIsDocument && !isDoc && !isDescriptorProperty) return false;
      const isExported = topLevelIsDocument || isDescriptorProperty || hasExportTag;
      if (isSubAttribute && !topLevelIsDocument && !isExported) return false;
      return true;
    });
    const attrs: AttributeNodeInfo[] = await Promise.all(
      filteredMeta.map(async ({ attr, type, labelRaw, parentRems, isPrivate, isDescriptorProperty, hasExportTag, isDoc }) => {
        const label = (labelRaw ?? "").trim() || "(Untitled Attribute)";
        const extendsIds = [...new Set(parentRems.map((p) => p._id))];
        const isExported = topLevelIsDocument || isDescriptorProperty || hasExportTag;
        const hierarchyLevel = isSubAttribute ? parentHierarchyLevel : -1;
        const subChildren = isDescriptorProperty
          ? []
          : await collectAttributes(
              attr,
              attributeNodeId(topLevelIsDocument ? "property" : "interface", attr._id),
              true,
              attr._id,
              hierarchyLevel,
              depth + 1
            );
        return {
          id: attr._id,
          label,
          richText: attr.text,
          hierarchyLevel,
          extends: extendsIds,
          children: subChildren,
          isPrivate,
          isDescriptorProperty,
          isExported,
          isDepthCutoff: !isDescriptorProperty && depth + 1 >= MAX_ATTRIBUTE_DEPTH,
        } as AttributeNodeInfo;
      })
    );
    attrs.sort(compareByHierarchyThenLabel);
    attrs.forEach((p) => {
      const detail = {
        id: p.id,
        label: p.label,
        hierarchyLevel: p.hierarchyLevel,
        extends: p.extends,
        ownerNodeId,
        hasChildren: p.children.length > 0,
        parentId,
        isPrivate: p.isPrivate,
        isDescriptorProperty: p.isDescriptorProperty,
        isExported: p.isExported,
        isDepthCutoff: p.isDepthCutoff,
      };
      if (!byId[p.id]) {
        byId[p.id] = detail;
      }
    });
    return attrs;
  }

  const uniqueRems = [...new Map(rems.map((r) => [r._id, r])).values()];
  await mapWithConcurrency(uniqueRems, 4, async (rem) => {
    if (signal && isTimedOut(signal)) return;
    if (await rem.getType() === RemType.PORTAL) return;
    const tRem = performance.now();
    const attrs = await collectAttributes(rem, rem._id);
    const elapsed = performance.now() - tRem;
    if (elapsed > 300) {
      console.warn(`[perf] slow collectAttributes rem=${rem._id}: ${elapsed.toFixed(0)}ms (${attrs.length} attrs)`);
    }
    if (attrs.length > 0) byOwner[rem._id] = attrs;
  }, signal);

  console.log(`[perf] buildAttributeData done: uniqueRems=${uniqueRems.length} ownersWithAttrs=${Object.keys(byOwner).length} uniqueAttrIds=${Object.keys(byId).length} maxDepth=${MAX_ATTRIBUTE_DEPTH}`);
  return { byOwner, byId };
}

export function splitInterfaceData(interfaceData: AttributeData): { regularInterfaces: AttributeData; directProperties: AttributeData } {
  const regularByOwner: Record<string, AttributeNodeInfo[]> = {};
  const regularById: Record<string, AttributeDetail> = {};
  const directByOwner: Record<string, AttributeNodeInfo[]> = {};
  const directById: Record<string, AttributeDetail> = {};

  const filterAttributes = (attrs: AttributeNodeInfo[], forDirect: boolean): AttributeNodeInfo[] => {
    return attrs
      .filter((attr) => (forDirect ? attr.isDescriptorProperty : !attr.isDescriptorProperty))
      .map((attr) => ({
        ...attr,
        children: forDirect ? [] : filterAttributes(attr.children, false),
      }));
  };

  for (const [ownerId, attrs] of Object.entries(interfaceData.byOwner)) {
    const regularAttrs = filterAttributes(attrs, false);
    const directAttrs = filterAttributes(attrs, true);
    if (regularAttrs.length > 0) regularByOwner[ownerId] = regularAttrs;
    if (directAttrs.length > 0) directByOwner[ownerId] = directAttrs;
  }
  for (const [id, detail] of Object.entries(interfaceData.byId)) {
    if (detail.isDescriptorProperty) directById[id] = detail;
    else regularById[id] = detail;
  }
  return {
    regularInterfaces: { byOwner: regularByOwner, byId: regularById },
    directProperties: { byOwner: directByOwner, byId: directById },
  };
}

export function filterExportedInterfaces(interfaceData: AttributeData): AttributeData {
  const filteredByOwner: Record<string, AttributeNodeInfo[]> = {};
  const filteredById: Record<string, AttributeDetail> = {};
  for (const [ownerId, attrs] of Object.entries(interfaceData.byOwner)) {
    const filtered = attrs.filter((attr) => attr.isExported);
    if (filtered.length > 0) filteredByOwner[ownerId] = filtered;
  }
  for (const [id, detail] of Object.entries(interfaceData.byId)) {
    filteredById[id] = detail;
  }
  return { byOwner: filteredByOwner, byId: filteredById };
}
