import React, { useCallback, useEffect, useState, useRef } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Node,
  Edge,
  MarkerType,
  ReactFlowInstance,
  Handle,
  Position,
  NodeProps,
  applyNodeChanges,
  NodeChange,
} from "reactflow";
import "reactflow/dist/style.css";
import { renderWidget, usePlugin, useTrackerPlugin, PluginRem, RNPlugin, RemType, SetRemType } from "@remnote/plugin-sdk";

import { getRemText, getParentClass, getExtendsChildren, getCleanChildren, getCleanChildrenAll, getExtendsParents, updateDescendantPropertyReferences, updateDescendantInterfaceReferences, hasTag, getTag, isPropertyDescriptor, getClassProperties, getClassDescriptors, getAncestorLineageStrings } from "../utils/utils";
import { RichTextLabel } from "../utils/richText";
import { RichTextInterface } from "@remnote/plugin-sdk";
import { EDGE_TYPES } from "../components/Edges";
import {
  REM_NODE_STYLE,
  REM_NODE_STYLE_COLLAPSED,
  REM_NODE_STYLE_CENTER,
  PROPERTY_NODE_STYLE,
  PROPERTY_NODE_STYLE_COLLAPSED,
  INTERFACE_NODE_STYLE,
  INTERFACE_NODE_STYLE_COLLAPSED,
  getNodeStyle,
} from "../components/Nodes";

type HierarchyNode = {
  id: string;
  name: string;
  richText?: RichTextInterface;  // Rich text for formatted rendering
  remRef: PluginRem;
  children: HierarchyNode[];
  isExported?: boolean;  // Whether this rem has the "Export" tag
};

type GraphNodeData = {
  label: string;
  richText?: RichTextInterface;  // Rich text for formatted rendering (LaTeX, bold, etc.)
  remId: string;
  kind: "rem" | "property" | "interface" | "virtualProperty" | "virtualInterface" | "directProperty" | "virtualDirectProperty" | "virtualInterfaceGroup";
  sourcePropertyId?: string;  // For virtual nodes: the ancestor property this inherits from
  ownerRemId?: string;        // For virtual nodes: the REM that should implement this
  sourceRemLabel?: string;    // For virtual nodes: the label of the ancestor REM that owns the source property (for hover display)
  isDescriptorProperty?: boolean; // For virtual interfaces: whether the source has the "Interface" tag
  isExported?: boolean;  // Whether this rem has the "Export" tag (for thicker border display)
  isDepthCutoff?: boolean;  // true if this attribute node had children truncated by MAX_ATTRIBUTE_DEPTH
};

// Vertical Space Between Different Ancestor or Descendant REM Nodes
const VERTICAL_SPACING = 150; // 35
// Horizontal Space Between Ancestor and Descendant REM Nodes
const REM_HORIZONTAL_SPACING = 110; // 220
const REM_CHILD_GAP_UNITS = 0.5;
const REM_UNIT_HEIGHT_PX = VERTICAL_SPACING;
const REM_NODE_HEIGHT_ESTIMATE = 46;
const ATTRIBUTE_NODE_HEIGHT_ESTIMATE = 40;
// Vertical Space Between Rem Node and Property Nodes
const ATTRIBUTE_VERTICAL_MARGIN = 12; // 24
// Horizontal Space Between Ancestor and Descendant Property Nodes
const ATTRIBUTE_HORIZONTAL_SPACING = 47; // 160
// Vertical Space Between Different Property Nodes of One REM Node
const ATTRIBUTE_VERTICAL_SPACING = 50; // 55
// Factor to reduce attribute height contribution to subtree spacing (0 = ignore attributes, 1 = full height)
const ATTRIBUTE_HEIGHT_SPACING_FACTOR = 1;
const ATTRIBUTE_HEIGHT_SPACING_OFFSET = -1;

// Node styles are now imported from ../components/Nodes

type AttributeNodeInfo = {
  id: string;
  label: string;
  richText?: RichTextInterface;  // Rich text for formatted rendering
  hierarchyLevel?: number;       // -1 for owner direct attributes, >=0 for inherited branches
  extends: string[];
  children: AttributeNodeInfo[];
  isPrivate: boolean;
  isDescriptorProperty: boolean;
  isExported: boolean;  // Whether this interface has the "Export" tag (for interface filtering)
  isDepthCutoff?: boolean;  // true if children were truncated by MAX_ATTRIBUTE_DEPTH
};

type AttributeDetail = Omit<AttributeNodeInfo, 'children'> & {
  ownerNodeId: string;
  hasChildren: boolean;
  parentId?: string;
};

type AttributeData = {
  byOwner: Record<string, AttributeNodeInfo[]>;
  byId: Record<string, AttributeDetail>;
};

type VirtualAttributeInfo = {
  id: string;                    // Unique virtual ID (e.g., "virtual:ownerRemId:sourcePropertyId")
  label: string;                 // Same label as source property
  richText?: RichTextInterface;  // Rich text for formatted rendering
  hierarchyLevel?: number;       // Derived from owner/source hierarchy relation
  sourcePropertyId: string;      // The ancestor property this inherits from
  ownerRemId: string;            // The REM that should implement this
  sourceRemId: string;           // The ancestor REM that owns the source property
  sourceRemLabel: string;        // The label of the ancestor REM (for hover display)
  children: VirtualAttributeInfo[];  // Children from the source property (for expandable virtual interfaces)
  isDescriptorProperty: boolean;    // Whether the source attribute has the "Interface" tag
  extendsVirtualIds: string[];   // IDs of parent virtual attrs that this one extends (for same owner REM)
  isDepthCutoff?: boolean;       // true if children were truncated by MAX_ATTRIBUTE_DEPTH
  baseTypeId?: string;           // Ultimate root ancestor ID of sourceRemId (for grouping virtual properties)
  baseTypeLabel?: string;        // Label of the ultimate root ancestor
};

type VirtualAttributeData = {
  byOwner: Record<string, VirtualAttributeInfo[]>;
};

// Timeout signal for graceful early termination of long-running loads
type TimeoutSignal = {
  startTime: number;
  timeoutMs: number;
  timedOut: boolean;
};

const LOAD_TIMEOUT_MS = 60000; // 30 seconds

function createTimeoutSignal(timeoutMs: number = LOAD_TIMEOUT_MS): TimeoutSignal {
  return {
    startTime: Date.now(),
    timeoutMs,
    timedOut: false,
  };
}

function isTimedOut(signal: TimeoutSignal): boolean {
  if (signal.timedOut) return true;
  if (Date.now() - signal.startTime > signal.timeoutMs) {
    signal.timedOut = true;
    return true;
  }
  return false;
}

type GraphNode = Node<GraphNodeData>;
type GraphEdge = Edge;

type AttributeKind = 'property' | 'interface' | 'directProperty';

type VirtualDataByKind = Partial<Record<AttributeKind, VirtualAttributeData>>;

type LoadComputationContext = {
  childToParentsMap?: Record<string, Set<string>>;
  virtualDataByKind: VirtualDataByKind;
  parentClassCache: Map<string, PluginRem[]>;
  remLookupCache: Map<string, PluginRem | null>;
  extendsChildrenCache: Map<string, PluginRem[]>;
};

function createLoadComputationContext(): LoadComputationContext {
  return {
    virtualDataByKind: {},
    parentClassCache: new Map<string, PluginRem[]>(),
    remLookupCache: new Map<string, PluginRem | null>(),
    extendsChildrenCache: new Map<string, PluginRem[]>(),
  };
}

function collectRemRefs(forest: HierarchyNode[]): Map<string, PluginRem> {
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

async function mapWithConcurrency<T>(
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

async function getParentClassCached(
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

async function getExtendsChildrenCached(
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

async function findRemCached(
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

async function buildCompleteChildToParentsMap(
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
        parents
          .filter((p) => p)
          .map((p) => p._id)
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
        grandparents
          .filter((p) => p)
          .map((p) => p._id)
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

const MINDMAP_STATE_KEY = "mindmap_widget_state";

// Testing flag: set to false to clear saved state instead of restoring
const restoreFromSynced = false;

type MindMapState = {
  loadedRemId: string;
  attributeType: 'property' | 'interface';
  historyStack: string[];
};

// Export metadata for each rem (pre-fetched for XML export)
type ExportMetadata = {
  isProperty: boolean;     // true if descriptor or document type
  isExported: boolean;     // true if should be exported (document, descriptor, or has Export tag)
  extendsNames: string[];  // names of parent rems (via extends descriptor)
};

// Property and Interface node styles are now imported from ../components/Nodes

const REM_SOURCE_BOTTOM_HANDLE = "rem-source-bottom";
const REM_TARGET_TOP_HANDLE = "rem-target-top";
const REM_SOURCE_RIGHT_HANDLE = "rem-source-right";
const REM_SOURCE_LEFT_HANDLE = "rem-source-left";
const REM_TARGET_LEFT_HANDLE = "rem-target-left";
const REM_TARGET_RIGHT_HANDLE = "rem-target-right";
const ATTRIBUTE_TARGET_LEFT_HANDLE = "attribute-target-left";
const ATTRIBUTE_SOURCE_RIGHT_HANDLE = "attribute-source-right";
const ATTRIBUTE_SOURCE_BOTTOM_HANDLE = "attribute-source-bottom";
const ATTRIBUTE_TARGET_TOP_HANDLE = "attribute-target-top";
const ATTRIBUTE_TARGET_RIGHT_HANDLE = "attribute-target-right";

const NODE_CONTAINER_STYLE: React.CSSProperties = {
  width: '100%',
  height: '100%',
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'inherit',
  fontWeight: 'inherit',
};

const ATTRIBUTE_CONTAINER_STYLE: React.CSSProperties = {
  ...NODE_CONTAINER_STYLE,
  justifyContent: 'flex-start',
};

const HANDLE_COMMON_STYLE: React.CSSProperties = {
  width: 6,
  height: 6,
};

const NODE_VERTICAL_PADDING = 6;
const NODE_HORIZONTAL_PADDING = 10;

const TOP_HANDLE_STYLE: React.CSSProperties = {
  top: -NODE_VERTICAL_PADDING,
  left: '50%',
  transform: 'translate(-50%, -50%)',
};

const BOTTOM_HANDLE_STYLE: React.CSSProperties = {
  bottom: -NODE_VERTICAL_PADDING,
  left: '50%',
  transform: 'translate(-50%, 50%)',
};

const RIGHT_HANDLE_STYLE: React.CSSProperties = {
  right: -NODE_HORIZONTAL_PADDING,
  top: '50%',
  transform: 'translate(50%, -50%)',
};

const LEFT_HANDLE_STYLE: React.CSSProperties = {
  left: -NODE_HORIZONTAL_PADDING,
  top: '50%',
  transform: 'translate(-50%, -50%)',
};

const RIGHT_TARGET_HANDLE_STYLE: React.CSSProperties = {
  right: -NODE_HORIZONTAL_PADDING,
  top: '50%',
  transform: 'translate(50%, -50%)',
};

const BOTTOM_SOURCE_HANDLE_STYLE: React.CSSProperties = {
  bottom: -NODE_VERTICAL_PADDING,
  left: '50%',
  transform: 'translate(-50%, 50%)',
};

// Curated palette of visually distinct colors for edge coloring
const EDGE_COLOR_PALETTE = [
  "#e63946", // Red
  "#f4a261", // Orange
  "#e9c46a", // Yellow
  "#2a9d8f", // Teal
  "#264653", // Dark blue
  "#9b5de5", // Purple
  "#00bbf9", // Cyan
  "#00f5d4", // Mint
  "#f15bb5", // Pink
  "#fee440", // Bright yellow
  "#8338ec", // Violet
  "#3a86ff", // Blue
  "#ff006e", // Magenta
  "#fb5607", // Bright orange
  "#06d6a0", // Green
];

/**
 * Returns a deterministic color for a given node ID.
 * All edges leaving the same node will have the same color.
 */
function getColorForNode(nodeId: string): string {
  let hash = 0;
  for (let i = 0; i < nodeId.length; i++) {
    hash = ((hash << 5) - hash) + nodeId.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }
  const index = Math.abs(hash) % EDGE_COLOR_PALETTE.length;
  return EDGE_COLOR_PALETTE[index];
}

function estimateNodeWidth(label: string, kind: 'rem' | 'property' | 'interface' | 'virtualProperty' | 'virtualInterface' | 'directProperty' | 'virtualDirectProperty' | 'virtualInterfaceGroup'): number {
  const fontSize = kind === 'rem' ? 13 : 12;
  const avgCharWidth = fontSize * 0.6;
  const textWidth = label.length * avgCharWidth;
  const padding = 2 * 10;
  const minWidth = kind === 'rem' ? 140 : 160;
  return Math.max(minWidth, textWidth + padding);
}

function compareByHierarchyThenLabel<T extends { label: string; hierarchyLevel?: number }>(a: T, b: T): number {
  const levelA = a.hierarchyLevel ?? 0;
  const levelB = b.hierarchyLevel ?? 0;
  if (levelA !== levelB) {
    return levelA - levelB;
  }
  return a.label.localeCompare(b.label);
}

function RemFlowNode({ data }: NodeProps<GraphNodeData>) {
  return (
    <div style={{ ...NODE_CONTAINER_STYLE, cursor: 'pointer' }}>
      <Handle
        type="target"
        position={Position.Top}
        id={REM_TARGET_TOP_HANDLE}
        style={{ ...HANDLE_COMMON_STYLE, ...TOP_HANDLE_STYLE }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id={REM_SOURCE_BOTTOM_HANDLE}
        style={{ ...HANDLE_COMMON_STYLE, ...BOTTOM_HANDLE_STYLE }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id={REM_SOURCE_RIGHT_HANDLE}
        style={{ ...HANDLE_COMMON_STYLE, ...RIGHT_HANDLE_STYLE }}
      />
      <Handle
        type="source"
        position={Position.Left}
        id={REM_SOURCE_LEFT_HANDLE}
        style={{ ...HANDLE_COMMON_STYLE, ...LEFT_HANDLE_STYLE }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id={REM_TARGET_LEFT_HANDLE}
        style={{ ...HANDLE_COMMON_STYLE, ...LEFT_HANDLE_STYLE }}
      />
      <Handle
        type="target"
        position={Position.Right}
        id={REM_TARGET_RIGHT_HANDLE}
        style={{ ...HANDLE_COMMON_STYLE, ...RIGHT_TARGET_HANDLE_STYLE }}
      />
      <RichTextLabel richText={data.richText} fallback={data.label} />
    </div>
  );
}

function PropertyFlowNode({ data }: NodeProps<GraphNodeData>) {
  return (
    <div style={{ ...ATTRIBUTE_CONTAINER_STYLE, cursor: 'pointer' }}>
      <Handle
        type="target"
        position={Position.Left}
        id={ATTRIBUTE_TARGET_LEFT_HANDLE}
        style={{ ...HANDLE_COMMON_STYLE, ...LEFT_HANDLE_STYLE }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id={ATTRIBUTE_SOURCE_RIGHT_HANDLE}
        style={{ ...HANDLE_COMMON_STYLE, ...RIGHT_HANDLE_STYLE }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id={ATTRIBUTE_SOURCE_BOTTOM_HANDLE}
        style={{ ...HANDLE_COMMON_STYLE, ...BOTTOM_SOURCE_HANDLE_STYLE }}
      />
      <Handle
        type="target"
        position={Position.Right}
        id={ATTRIBUTE_TARGET_RIGHT_HANDLE}
        style={{ ...HANDLE_COMMON_STYLE, ...RIGHT_TARGET_HANDLE_STYLE }}
      />
      <Handle
        type="target"
        position={Position.Top}
        id={ATTRIBUTE_TARGET_TOP_HANDLE}
        style={{ ...HANDLE_COMMON_STYLE, ...TOP_HANDLE_STYLE }}
      />
      <RichTextLabel richText={data.richText} fallback={data.label} style={{ width: '100%' }} />
    </div>
  );
}

function InterfaceFlowNode({ data }: NodeProps<GraphNodeData>) {
  return (
    <div style={{ ...ATTRIBUTE_CONTAINER_STYLE, cursor: 'pointer' }}>
      <Handle
        type="target"
        position={Position.Left}
        id={ATTRIBUTE_TARGET_LEFT_HANDLE}
        style={{ ...HANDLE_COMMON_STYLE, ...LEFT_HANDLE_STYLE }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id={ATTRIBUTE_SOURCE_RIGHT_HANDLE}
        style={{ ...HANDLE_COMMON_STYLE, ...RIGHT_HANDLE_STYLE }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id={ATTRIBUTE_SOURCE_BOTTOM_HANDLE}
        style={{ ...HANDLE_COMMON_STYLE, ...BOTTOM_SOURCE_HANDLE_STYLE }}
      />
      <Handle
        type="target"
        position={Position.Right}
        id={ATTRIBUTE_TARGET_RIGHT_HANDLE}
        style={{ ...HANDLE_COMMON_STYLE, ...RIGHT_TARGET_HANDLE_STYLE }}
      />
      <Handle
        type="target"
        position={Position.Top}
        id={ATTRIBUTE_TARGET_TOP_HANDLE}
        style={{ ...HANDLE_COMMON_STYLE, ...TOP_HANDLE_STYLE }}
      />
      <RichTextLabel richText={data.richText} fallback={data.label} style={{ width: '100%' }} />
    </div>
  );
}

function VirtualPropertyFlowNode({ data }: NodeProps<GraphNodeData>) {
  const hoverText = data.sourceRemLabel ? `${data.sourceRemLabel}` : undefined;
  return (
    <div style={{ ...ATTRIBUTE_CONTAINER_STYLE, cursor: 'pointer' }} title={hoverText}>
      <Handle
        type="target"
        position={Position.Top}
        id={ATTRIBUTE_TARGET_TOP_HANDLE}
        style={{ ...HANDLE_COMMON_STYLE, ...TOP_HANDLE_STYLE }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id={ATTRIBUTE_TARGET_LEFT_HANDLE}
        style={{ ...HANDLE_COMMON_STYLE, ...LEFT_HANDLE_STYLE }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id={ATTRIBUTE_SOURCE_RIGHT_HANDLE}
        style={{ ...HANDLE_COMMON_STYLE, ...RIGHT_HANDLE_STYLE }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id={ATTRIBUTE_SOURCE_BOTTOM_HANDLE}
        style={{ ...HANDLE_COMMON_STYLE, ...BOTTOM_HANDLE_STYLE }}
      />
      <RichTextLabel richText={data.richText} fallback={data.label} style={{ width: '100%', fontStyle: 'italic' }} prefix="⊕ " />
    </div>
  );
}

function VirtualInterfaceGroupFlowNode({ data }: NodeProps<GraphNodeData>) {
  return (
    <div style={{ ...ATTRIBUTE_CONTAINER_STYLE, cursor: 'pointer' }}>
      <Handle
        type="target"
        position={Position.Left}
        id={ATTRIBUTE_TARGET_LEFT_HANDLE}
        style={{ ...HANDLE_COMMON_STYLE, ...LEFT_HANDLE_STYLE }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id={ATTRIBUTE_SOURCE_RIGHT_HANDLE}
        style={{ ...HANDLE_COMMON_STYLE, ...RIGHT_HANDLE_STYLE }}
      />
      <RichTextLabel richText={data.richText} fallback={data.label} style={{ width: '100%' }} />
    </div>
  );
}

const NODE_TYPES = {
  remNode: RemFlowNode,
  propertyNode: PropertyFlowNode,
  interfaceNode: InterfaceFlowNode,
  directPropertyNode: InterfaceFlowNode,
  virtualPropertyNode: VirtualPropertyFlowNode,
  virtualInterfaceNode: VirtualPropertyFlowNode,
  virtualDirectPropertyNode: VirtualPropertyFlowNode,
  virtualInterfaceGroupNode: VirtualInterfaceGroupFlowNode,
};

async function buildAncestorNodes(
  plugin: RNPlugin,
  rem: PluginRem,
  visited: Set<string>,
  computationContext?: LoadComputationContext,
  signal?: TimeoutSignal
): Promise<HierarchyNode[]> {
  // Check timeout before starting work
  if (signal && isTimedOut(signal)) {
    return [];
  }
  
  const remName = await getRemText(plugin, rem);
  const parents = computationContext
    ? await getParentClassCached(plugin, rem, computationContext)
    : await getParentClass(plugin, rem);
  //console.log(`[buildAncestorNodes] Rem: "${remName}" (${rem._id}), parents:`, parents.map(p => p._id));
  const uniqueParents = new Map<string, PluginRem>();
  for (const parent of parents) {
    const parentName = parent ? await getRemText(plugin, parent) : "(null)";
    const skip = !parent || parent._id === rem._id || visited.has(parent._id);
    //console.log(`[buildAncestorNodes]   Checking parent "${parentName}" (${parent?._id}): skip=${skip}, self=${parent?._id === rem._id}, visited=${visited.has(parent?._id ?? "")}`);
    if (skip) continue;
    uniqueParents.set(parent._id, parent);
  }

  const result: HierarchyNode[] = [];
  for (const parent of uniqueParents.values()) {
    // Check timeout before each recursive call
    if (signal && isTimedOut(signal)) {
      break;
    }
    
    visited.add(parent._id);
    const [name, ancestors, isExported] = await Promise.all([
      getRemText(plugin, parent),
      buildAncestorNodes(plugin, parent, visited, computationContext, signal),
      hasTag(plugin, parent, "Export"),
    ]);
    //console.log(`[buildAncestorNodes]   Added parent "${name}" with ${ancestors.length} ancestors`);
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

async function getStructuralDescendantChildren(plugin: RNPlugin, rem: PluginRem): Promise<PluginRem[]> {
  const children = await getCleanChildren(plugin, rem);
  const meta = await Promise.all(
    children.map(async (child) => {
      const [isDoc, type] = await Promise.all([child.isDocument(), child.getType()]);
      // Check if this is a property descriptor (descriptor that's not a reserved keyword)
      const isPropDesc = type === RemType.DESCRIPTOR ? await isPropertyDescriptor(plugin, child) : false;
      return { child, isDoc, type, isPropDesc };
    })
  );
  return meta
    // Keep non-documents AND (non-descriptors OR property descriptors)
    .filter(({ isDoc, type, isPropDesc }) => !isDoc && (type !== RemType.DESCRIPTOR || isPropDesc))
    .map(({ child }) => child);
}

async function buildDescendantNodes(
  plugin: RNPlugin,
  rem: PluginRem,
  visited: Set<string>,
  signal?: TimeoutSignal
): Promise<HierarchyNode[]> {
  // Check timeout before starting work
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
    // Check timeout before each recursive call
    if (signal && isTimedOut(signal)) {
      break;
    }
    
    // Skip property descriptors - they should not appear in the graph as structural children
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

function measureSubtreeHeight(
  node: HierarchyNode,
  cache: Map<string, number>,
  collapsed: Set<string>,
  attributeData?: AttributeData,
  hiddenAttributes?: Set<string>,
  kind?: 'property' | 'interface' | 'directProperty',
  virtualAttributeData?: VirtualAttributeData,
  hiddenVirtualAttributes?: Set<string>
): number {
  if (cache.has(node.id)) return cache.get(node.id)!;
  let baseHeight = 1;
  if (collapsed.has(node.id) || !node.children?.length) {
    // baseHeight = 1;
  } else {
    let total = 0;
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      const childHeight = measureSubtreeHeight(child, cache, collapsed, attributeData, hiddenAttributes, kind, virtualAttributeData, hiddenVirtualAttributes);
      total += childHeight;
      if (i < node.children.length - 1) {
        total += REM_CHILD_GAP_UNITS;
      }
    }
    baseHeight = Math.max(1, total);
  }
  let attributeHeight = 0;
  if (attributeData && kind && attributeData.byOwner[node.id]) {
    const attrs = attributeData.byOwner[node.id];
    const visible = hiddenAttributes ? attrs.filter(a => !hiddenAttributes.has(a.id)) : attrs;
    attributeHeight = visible.length * (ATTRIBUTE_VERTICAL_SPACING / REM_UNIT_HEIGHT_PX);
  }
  // Also count visible virtual attributes
  let virtualAttributeHeight = 0;
  if (virtualAttributeData && virtualAttributeData.byOwner[node.id]) {
    const virtualAttrs = virtualAttributeData.byOwner[node.id];
    const visibleVirtual = hiddenVirtualAttributes 
      ? virtualAttrs.filter(v => !hiddenVirtualAttributes.has(v.id)) 
      : virtualAttrs;
    virtualAttributeHeight = visibleVirtual.length * (ATTRIBUTE_VERTICAL_SPACING / REM_UNIT_HEIGHT_PX);
  }
  // Apply reduction factor to attribute heights for tighter subtree spacing
  const totalAttributeHeight = (attributeHeight + virtualAttributeHeight) * ATTRIBUTE_HEIGHT_SPACING_FACTOR + ATTRIBUTE_HEIGHT_SPACING_OFFSET;
  const result = baseHeight + totalAttributeHeight;
  cache.set(node.id, result);
  return result;
}

function unitToY(unit: number): number {
  return unit * REM_UNIT_HEIGHT_PX;
}

function layoutSubtreeHorizontal(
  node: HierarchyNode,
  parentNode: GraphNode,
  orientation: "left" | "right",
  relation: "ancestor" | "descendant",
  centerUnit: number,
  nodes: GraphNode[],
  edges: GraphEdge[],
  existingNodeIds: Set<string>,
  heightCache: Map<string, number>,
  collapsed: Set<string>,
  nodePositions?: Map<string, { x: number; y: number }>,
  attributeData?: AttributeData,
  hiddenAttributes?: Set<string>,
  kind?: 'property' | 'interface' | 'directProperty',
  virtualAttributeData?: VirtualAttributeData,
  hiddenVirtualAttributes?: Set<string>
): GraphNode | null {
  //console.log(`[layoutSubtreeHorizontal] Node: "${node.name}" (${node.id}), orientation=${orientation}, relation=${relation}, existingNodeIds.has=${existingNodeIds.has(node.id)}`);
  if (existingNodeIds.has(node.id)) {
    //console.log(`[layoutSubtreeHorizontal]   SKIPPED - already exists`);
    return nodes.find((n) => n.id === node.id) ?? null;
  }

  const estWidth = estimateNodeWidth(node.name, 'rem');
  const parentData = parentNode.data as GraphNodeData;
  const parentStyleWidth = parentNode.style?.width;
  const parentWidth =
    typeof parentStyleWidth === "number"
      ? parentStyleWidth
      : estimateNodeWidth(parentData.label, parentData.kind);

  let x =
    orientation === "right"
      ? parentNode.position.x + parentWidth + REM_HORIZONTAL_SPACING
      : parentNode.position.x - REM_HORIZONTAL_SPACING - estWidth;
  let y = unitToY(centerUnit);

  const stored = nodePositions?.get(node.id);
  if (stored) {
    x = stored.x;
    y = stored.y;
  }

  const style = getNodeStyle('rem', collapsed.has(node.id), false, undefined, undefined, node.isExported);

  const graphNode: GraphNode = {
    id: node.id,
    position: { x, y },
    data: { label: node.name, richText: node.richText, remId: node.id, kind: "rem", isExported: node.isExported },
    style,
    draggable: true,
    selectable: true,
    type: "remNode",
  };

  nodes.push(graphNode);
  existingNodeIds.add(node.id);

  const parentId = parentNode.id;
  const edgeId =
    relation === "ancestor" ? `${node.id}->${parentId}` : `${parentId}->${node.id}`;

  let sourceHandle: string;
  let targetHandle: string;
  if (orientation === "right") {
    if (relation === "ancestor") {
      sourceHandle = REM_SOURCE_LEFT_HANDLE;
      targetHandle = REM_TARGET_RIGHT_HANDLE;
    } else {
      sourceHandle = REM_SOURCE_RIGHT_HANDLE;
      targetHandle = REM_TARGET_LEFT_HANDLE;
    }
  } else {
    if (relation === "ancestor") {
      sourceHandle = REM_SOURCE_RIGHT_HANDLE;
      targetHandle = REM_TARGET_LEFT_HANDLE;
    } else {
      sourceHandle = REM_SOURCE_LEFT_HANDLE;
      targetHandle = REM_TARGET_RIGHT_HANDLE;
    }
  }

  if (!edges.some((edge) => edge.id === edgeId)) {
    const sourceNodeId = relation === "ancestor" ? node.id : parentId;
    edges.push({
      id: edgeId,
      source: sourceNodeId,
      target: relation === "ancestor" ? parentId : node.id,
      sourceHandle,
      targetHandle,
      type: "randomOffset",
      markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
      style: { stroke: getColorForNode(sourceNodeId) }
    });
  }

  //console.log(`[layoutSubtreeHorizontal] Node: "${node.name}" checking children: collapsed=${collapsed.has(node.id)}, children.length=${node.children?.length}`);
  if (collapsed.has(node.id) || !node.children?.length) {
    //console.log(`[layoutSubtreeHorizontal]   NOT recursing into children`);
    return graphNode;
  }

  //console.log(`[layoutSubtreeHorizontal]   Recursing into ${node.children.length} children`);
  layoutChildrenHorizontal(
    node.children,
    graphNode,
    orientation,
    relation,
    nodes,
    edges,
    existingNodeIds,
    collapsed,
    nodePositions,
    heightCache,
    attributeData,
    hiddenAttributes,
    kind,
    virtualAttributeData,
    hiddenVirtualAttributes
  );

  return graphNode;
}

function layoutChildrenHorizontal(
  children: HierarchyNode[],
  parentNode: GraphNode,
  orientation: "left" | "right",
  relation: "ancestor" | "descendant",
  nodes: GraphNode[],
  edges: GraphEdge[],
  existingNodeIds: Set<string>,
  collapsed: Set<string>,
  nodePositions?: Map<string, { x: number; y: number }>,
  heightCache: Map<string, number> = new Map(),
  attributeData?: AttributeData,
  hiddenAttributes?: Set<string>,
  kind?: 'property' | 'interface' | 'directProperty',
  virtualAttributeData?: VirtualAttributeData,
  hiddenVirtualAttributes?: Set<string>
): void {
  if (children.length === 0) return;

  const parentUnit = parentNode.position.y / REM_UNIT_HEIGHT_PX;
  const heights = children.map((child) => measureSubtreeHeight(child, heightCache, collapsed, attributeData, hiddenAttributes, kind, virtualAttributeData, hiddenVirtualAttributes));
  const totalUnits =
    heights.reduce((sum, h) => sum + h, 0) + Math.max(0, children.length - 1) * REM_CHILD_GAP_UNITS;

  let currentUnit = parentUnit - totalUnits / 2;

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const childUnits = heights[i];
    const childCenterUnit = currentUnit + childUnits / 2;
    layoutSubtreeHorizontal(
      child,
      parentNode,
      orientation,
      relation,
      childCenterUnit,
      nodes,
      edges,
      existingNodeIds,
      heightCache,
      collapsed,
      nodePositions,
      attributeData,
      hiddenAttributes,
      kind,
      virtualAttributeData,
      hiddenVirtualAttributes
    );
    currentUnit += childUnits;
    if (i < children.length - 1) {
      currentUnit += REM_CHILD_GAP_UNITS;
    }
  }
}

function layoutForestHorizontal(
  forest: HierarchyNode[],
  parentNode: GraphNode,
  orientation: "left" | "right",
  relation: "ancestor" | "descendant",
  nodes: GraphNode[],
  edges: GraphEdge[],
  existingNodeIds: Set<string>,
  collapsed: Set<string>,
  nodePositions?: Map<string, { x: number; y: number }>,
  attributeData?: AttributeData,
  hiddenAttributes?: Set<string>,
  kind?: 'property' | 'interface' | 'directProperty',
  virtualAttributeData?: VirtualAttributeData,
  hiddenVirtualAttributes?: Set<string>
): void {
  if (forest.length === 0) return;
  const heightCache = new Map<string, number>();
  layoutChildrenHorizontal(
    forest,
    parentNode,
    orientation,
    relation,
    nodes,
    edges,
    existingNodeIds,
    collapsed,
    nodePositions,
    heightCache,
    attributeData,
    hiddenAttributes,
    kind,
    virtualAttributeData,
    hiddenVirtualAttributes
  );
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

async function createGraphData(
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
  kind: 'property' | 'interface' | 'directProperty',
  secondaryAttributeData?: AttributeData,
  secondaryKind?: 'property' | 'interface' | 'directProperty',
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
    style: getNodeStyle('rem', isCenterCollapsed, true),
    draggable: true,
    selectable: true,
    type: "remNode",
  };

  const nodes: GraphNode[] = [centerGraphNode];
  const edges: GraphEdge[] = [];
  const existingIds = new Set<string>([centerId]);

  // Pre-compute virtual attribute data for height calculations
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

  // Skip layout of ancestors/descendants when center node is collapsed
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

  // Always integrate attributes (even when center collapsed, show center's attributes)
  // For combined property view, lay out in order: directProperty, property, virtualDirectProperty, virtualProperty
  let result = { nodes, edges };
  // First integrate secondary (directProperty) data if provided
  if (secondaryAttributeData && secondaryKind) {
    result = await integrateAttributeGraph(plugin, result.nodes, result.edges, secondaryAttributeData, hiddenAttributes, hiddenVirtualAttributes, collapsed, nodePositions, secondaryKind, centerId, ancestors, descendants, context, signal);
  }
  
  // Then integrate primary attribute data (property or interface)
  result = await integrateAttributeGraph(plugin, result.nodes, result.edges, attributeData, hiddenAttributes, hiddenVirtualAttributes, collapsed, nodePositions, kind, centerId, ancestors, descendants, context, signal);
  
  return result;
}

function attributeNodeId(kind: 'property' | 'interface' | 'directProperty', attributeId: string): string {
  return `${kind}:${attributeId}`;
}

function layoutAttributeTree(
  ownerNode: GraphNode,
  attributes: AttributeNodeInfo[],
  nodes: GraphNode[],
  edges: GraphEdge[],
  existingNodeIds: Set<string>,
  existingEdgeIds: Set<string>,
  hiddenAttributes: Set<string> | undefined,
  attributeData: AttributeData,
  collapsed: Set<string>,
  kind: 'property' | 'interface' | 'directProperty',
  nodePositions?: Map<string, { x: number; y: number }>,
  existingAttrsCount: number = 0
) {
  const visible = hiddenAttributes ? attributes.filter((info) => !hiddenAttributes.has(info.id)) : attributes;
  if (visible.length === 0) return;
  const sorted = [...visible].sort(compareByHierarchyThenLabel);
  const ownerData = ownerNode.data as GraphNodeData;
  const ownerStyleWidth = ownerNode.style?.width;
  const ownerWidth =
    typeof ownerStyleWidth === "number"
      ? ownerStyleWidth
      : estimateNodeWidth(ownerData.label, ownerData.kind);
  const ownerStyleHeight = ownerNode.style?.height;
  const ownerHeight =
    typeof ownerStyleHeight === "number"
      ? ownerStyleHeight
      : ownerData.kind === "rem"
      ? REM_NODE_HEIGHT_ESTIMATE
      : ATTRIBUTE_NODE_HEIGHT_ESTIMATE;
  const baseY = ownerNode.position.y + ownerHeight + ATTRIBUTE_VERTICAL_MARGIN + existingAttrsCount * ATTRIBUTE_VERTICAL_SPACING;
  sorted.forEach((info, index) => {
    const nodeId = attributeNodeId(kind, info.id);
    if (existingNodeIds.has(nodeId)) return;
    const propertyWidth = estimateNodeWidth(info.label, kind);
    let posX = ownerNode.position.x + 150;
    let posY = baseY + index * ATTRIBUTE_VERTICAL_SPACING;
    const storedPos = nodePositions?.get(nodeId);
    if (storedPos) {
      posX = storedPos.x;
      posY = storedPos.y;
    }
    const nodeStyle = getNodeStyle(kind, collapsed.has(info.id), false);
    const finalStyle = info.isDepthCutoff ? { ...nodeStyle, borderColor: '#e63946', borderWidth: 2 } : nodeStyle;
    nodes.push({
      id: nodeId,
      position: { x: posX, y: posY },
      data: { label: info.label, richText: info.richText, remId: info.id, kind, isDepthCutoff: info.isDepthCutoff },
      style: finalStyle,
      draggable: true,
      selectable: true,
      type: `${kind}Node`,
    });
    existingNodeIds.add(nodeId);
    const attributeGraphNode = nodes[nodes.length - 1];

    const edgeId = `attr-link:${ownerNode.id}->${info.id}`;
    if (!existingEdgeIds.has(edgeId)) {
      edges.push({
        id: edgeId,
        source: ownerNode.id,
        target: nodeId,
        sourceHandle: ownerNode.type === "remNode" ? REM_SOURCE_BOTTOM_HANDLE : ATTRIBUTE_SOURCE_BOTTOM_HANDLE,
        targetHandle: ATTRIBUTE_TARGET_LEFT_HANDLE,
        type: "randomOffset",
        markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
      });
      existingEdgeIds.add(edgeId);
    }

    if (!collapsed.has(info.id) && info.children.length > 0) {
      layoutAttributeDescendants(
        attributeGraphNode,
        info.children,
        nodes,
        edges,
        existingNodeIds,
        existingEdgeIds,
        hiddenAttributes,
        attributeData,
        collapsed,
        kind,
        nodePositions
      );
    }
  });
}

function layoutAttributeDescendants(
  parentNode: GraphNode,
  children: AttributeNodeInfo[],
  nodes: GraphNode[],
  edges: GraphEdge[],
  existingNodeIds: Set<string>,
  existingEdgeIds: Set<string>,
  hiddenAttributes: Set<string> | undefined,
  attributeData: AttributeData,
  collapsed: Set<string>,
  kind: 'property' | 'interface' | 'directProperty',
  nodePositions?: Map<string, { x: number; y: number }>
) {
  const visibleChildren = hiddenAttributes
    ? children.filter((child) => !hiddenAttributes.has(child.id))
    : children;
  if (visibleChildren.length === 0) return;

  const sorted = [...visibleChildren].sort(compareByHierarchyThenLabel);
  const parentData = parentNode.data as GraphNodeData;
  const parentStyleWidth = parentNode.style?.width;
  const parentWidth =
    typeof parentStyleWidth === "number"
      ? parentStyleWidth
      : estimateNodeWidth(parentData.label, parentData.kind);
  const baseX = parentNode.position.x + parentWidth + ATTRIBUTE_HORIZONTAL_SPACING;
  const startOffset = ((sorted.length - 1) / 2) * ATTRIBUTE_VERTICAL_SPACING;

  sorted.forEach((info, index) => {
    const nodeId = attributeNodeId(kind, info.id);
    const attrWidth = estimateNodeWidth(info.label, kind);
    let posX = baseX;
    let posY = parentNode.position.y + index * ATTRIBUTE_VERTICAL_SPACING - startOffset;
    const storedPos = nodePositions?.get(nodeId);
    if (storedPos) {
      posX = storedPos.x;
      posY = storedPos.y;
    }

    const nodeStyle = getNodeStyle(kind, collapsed.has(info.id), false);
    const finalStyle = info.isDepthCutoff ? { ...nodeStyle, borderColor: '#e63946', borderWidth: 2 } : nodeStyle;

    let childNodeIndex = nodes.findIndex((n) => n.id === nodeId);
    let childNode = childNodeIndex >= 0 ? nodes[childNodeIndex] : null;
    const updatedData: GraphNodeData = {
      label: info.label,
      remId: info.id,
      kind,
      isDepthCutoff: info.isDepthCutoff,
    };

    if (!childNode) {
      childNode = {
        id: nodeId,
        position: { x: posX, y: posY },
        data: updatedData,
        style: finalStyle,
        draggable: true,
        selectable: true,
        type: `${kind}Node`,
      };
      nodes.push(childNode);
      existingNodeIds.add(nodeId);
      childNodeIndex = nodes.length - 1;
    } else {
      if (!storedPos) {
        childNode = {
          ...childNode,
          position: { x: posX, y: posY },
          data: updatedData,
          style: finalStyle,
        };
        nodes[childNodeIndex] = childNode;
      } else {
        childNode = {
          ...childNode,
          data: updatedData,
          style: finalStyle,
        };
        nodes[childNodeIndex] = childNode;
      }
    }

    existingNodeIds.add(nodeId);

    const linkEdgeId = `attr-child:${parentNode.id}->${info.id}`;
    if (!existingEdgeIds.has(linkEdgeId)) {
      edges.push({
        id: linkEdgeId,
        source: parentNode.id,
        target: nodeId,
        sourceHandle: ATTRIBUTE_SOURCE_RIGHT_HANDLE,
        targetHandle: ATTRIBUTE_TARGET_LEFT_HANDLE,
        type: "randomOffset",
        markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
        style: { stroke: getColorForNode(parentNode.id), strokeDasharray: "4 2" }
      });
      existingEdgeIds.add(linkEdgeId);
    }

    if (!collapsed.has(info.id) && info.children.length > 0) {
      layoutAttributeDescendants(
        childNode,
        info.children,
        nodes,
        edges,
        existingNodeIds,
        existingEdgeIds,
        hiddenAttributes,
        attributeData,
        collapsed,
        kind,
        nodePositions
      );
    }
  });
}

async function integrateAttributeGraph(
  plugin: RNPlugin,
  nodes: GraphNode[],
  edges: GraphEdge[],
  attributeData?: AttributeData,
  hiddenAttributes?: Set<string>,
  hiddenVirtualAttributes?: Set<string>,
  collapsed?: Set<string>,
  nodePositions?: Map<string, { x: number; y: number }>,
  kind?: 'property' | 'interface' | 'directProperty',
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

  // Helper to count existing attribute nodes for each owner (for proper vertical stacking)
  const countExistingAttrsForOwner = (ownerId: string): number => {
    // Count direct attribute edges from this owner to attribute nodes
    let count = 0;
    for (const edge of edges) {
      if (edge.source === ownerId && edge.id.startsWith('attr-link:')) {
        // Check if the target node exists and is an attribute
        const targetNode = nodes.find(n => n.id === edge.target || edge.id.includes(n.data?.remId));
        if (targetNode) {
          const nodeKind = (targetNode.data as GraphNodeData)?.kind;
          if (nodeKind === 'property' || nodeKind === 'directProperty' || 
              nodeKind === 'virtualProperty' || nodeKind === 'virtualDirectProperty') {
            count++;
          }
        }
      }
    }
    // Also count by looking at nodes directly if edges not yet created
    for (const node of nodes) {
      const data = node.data as GraphNodeData;
      if ((data.kind === 'property' || data.kind === 'directProperty') && !data.ownerRemId) {
        // Check if there's an edge from owner to this node
        const hasEdge = edges.some(e => e.source === ownerId && e.id === `attr-link:${ownerId}->${data.remId}`);
        if (hasEdge && !existingNodeIds.has(attributeNodeId(kind, data.remId))) {
          // Already counted via edge
        }
      }
      // Count virtual attributes owned by this REM
      if ((data.kind === 'virtualProperty' || data.kind === 'virtualDirectProperty') && data.ownerRemId === ownerId) {
        count++;
      }
    }
    return count;
  };

  // Alternative simpler approach: just scan nodes for attributes belonging to owner
  const countAttributeNodesForOwner = (ownerId: string): number => {
    let count = 0;
    for (const node of nodes) {
      const data = node.data as GraphNodeData;
      // Skip non-attribute nodes and group header nodes (they don't occupy vertical slots)
      if (data.kind === 'rem' || data.kind === 'virtualInterfaceGroup') continue;
      // For virtual nodes, check ownerRemId
      if (data.ownerRemId === ownerId) {
        count++;
        continue;
      }
      // For regular attribute nodes, check via edges
      const hasOwnerEdge = edges.some(e => 
        e.source === ownerId && 
        (e.id === `attr-link:${ownerId}->${data.remId}` || e.id === `vattr-link:${ownerId}->${node.id}`)
      );
      if (hasOwnerEdge) {
        count++;
      }
    }
    return count;
  };

  // Helper to collect all IDs from a forest (flattened)
  const collectAllIdsFromForest = (forest: HierarchyNode[]): string[] => {
    const ids: string[] = [];
    const stack = [...forest];
    while (stack.length > 0) {
      const node = stack.pop()!;
      ids.push(node.id);
      if (node.children?.length) {
        stack.push(...node.children);
      }
    }
    return ids;
  };

  // Show regular attributes for properties and directProperties
  // For interfaces, only show on ancestor nodes (interface definitions)
  if (kind === 'property' || kind === 'directProperty') {
    for (const [ownerId, attributeList] of Object.entries(attributeData.byOwner)) {
      const ownerNode = baseNodeMap.get(ownerId);
      if (!ownerNode || attributeList.length === 0) {
        continue;
      }
      const existingCount = countAttributeNodesForOwner(ownerId);
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
        existingCount
      );
    }
  } else if (kind === 'interface' && ancestors && descendants && centerId) {
    // For interface view, show interface DEFINITIONS on ancestor nodes
    // (descendants only get virtual/unimplemented interfaces)
    const ancestorIds = collectAllIdsFromForest(ancestors);
    const descendantIds = collectAllIdsFromForest(descendants);
    const ancestorIdSet = new Set(ancestorIds);
    // Build set of all hierarchy REM IDs to filter them out from interface lists
    const allHierarchyRemIds = new Set([centerId, ...ancestorIds, ...descendantIds]);
    
    for (const [ownerId, attributeList] of Object.entries(attributeData.byOwner)) {
      // Only show interfaces for ancestor nodes (these are interface definitions)
      if (!ancestorIdSet.has(ownerId)) continue;
      
      const ownerNode = baseNodeMap.get(ownerId);
      if (!ownerNode || attributeList.length === 0) continue;
      
      // Filter out interfaces that are actually hierarchy REMs (descendants appearing as structural children)
      const actualInterfaces = attributeList.filter(attr => !allHierarchyRemIds.has(attr.id));
      
      if (actualInterfaces.length === 0) continue;
      
      const existingCount = countAttributeNodesForOwner(ownerId);
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
        existingCount
      );
    }
  }

  // Build and layout virtual (unimplemented) attributes
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
      virtualData = buildVirtualAttributeData(attributeData, centerId, ancestors, descendants, kind, childToParentsMap, new Set([centerId]));
      context.virtualDataByKind[kind] = virtualData;
    }
    
    for (const [ownerId, virtualAttrs] of Object.entries(virtualData.byOwner)) {
      const ownerNode = baseNodeMap.get(ownerId);
      if (!ownerNode || virtualAttrs.length === 0) {
        continue;
      }
      
      // Filter out hidden virtual attributes
      const visibleVirtualAttrs = hiddenVirtualAttributes
        ? virtualAttrs.filter(v => !hiddenVirtualAttributes.has(v.id))
        : virtualAttrs;
      
      if (visibleVirtualAttrs.length === 0) {
        continue;
      }
      
      // Count ALL existing attribute nodes for this owner (across all kinds)
      // This ensures virtual properties appear below direct properties + virtual direct properties
      const visibleExistingCount = countAttributeNodesForOwner(ownerId);
      
      layoutVirtualAttributes(
        ownerNode,
        visibleVirtualAttrs,
        visibleExistingCount,
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

  async function findClosestVisibleAncestor(attributeId: string, existingNodeIds: Set<string>, kind: 'property' | 'interface' | 'directProperty'): Promise<string | null> {
    const visited = new Set<string>();
    const queue: string[] = [attributeId];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) {
        continue;
      }
      visited.add(currentId);

      const nodeId = attributeNodeId(kind, currentId);
      if (existingNodeIds.has(nodeId)) {
        return currentId;
      }

      let currentRem: PluginRem | null = null;
      try {
        currentRem = await findRemCached(plugin, currentId, context);
      } catch (_) {
        currentRem = null;
      }
      if (!currentRem) {
        continue;
      }

      // If this attribute rem is not a document, its structural parent is also a candidate ancestor.
      try {
        const [parentRem, isDoc] = await Promise.all([currentRem.getParentRem(), currentRem.isDocument()]);
        if (!isDoc && parentRem && !visited.has(parentRem._id)) {
          queue.push(parentRem._id);
        }
      } catch (_) {
        // Ignore parent lookup failures
      }

      let parents: PluginRem[] = [];
      try {
        parents = await getExtendsParents(plugin, currentRem);
      } catch (_) {
        parents = [];
      }
      for (const parent of parents) {
        if (!visited.has(parent._id)) {
          queue.push(parent._id);
        }
      }
    }

    return null;
  }

  for (const detail of Object.values(attributeData.byId)) {
      // Always process every attribute, even if hidden, to ensure edges skip hidden nodes
      const childNodeId = attributeNodeId(kind, detail.id);
      // Only create edges if the child node is visible
      if (!existingNodeIds.has(childNodeId)) {
        continue;
      }
      for (const parentId of detail.extends) {
        // Find the closest visible ancestor for the parentId
        let visibleSourceId: string | null = parentId;
        if (!existingNodeIds.has(attributeNodeId(kind, parentId)) || (hiddenAttributes?.has(parentId))) {
          visibleSourceId = await findClosestVisibleAncestor(parentId, existingNodeIds, kind);
        }
        // Only create edge if the visible ancestor is not the child itself and exists
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
              style: { stroke: getColorForNode(sourceNodeId), strokeDasharray: "4 2" }
            });
            existingEdgeIds.add(edgeId);
          }
        }
      }
  }

  // Create edges from interface nodes (green) to REM nodes (grey) that extend them
  // This connects ancestor interface definitions to descendant REMs that implement them
  if (kind === 'interface') {
    const remNodes = nodes.filter(n => n.type === "remNode");
    const interfaceNodeIds = new Set(
      nodes.filter(n => n.type === "interfaceNode").map(n => {
        // Extract the actual interface ID from the node ID (e.g., "interface:xyz" -> "xyz")
        const data = n.data as GraphNodeData;
        return data.remId;
      })
    );
    
    for (const remNode of remNodes) {
      const remId = remNode.id;
      
      // Skip if this REM is also rendered as an interface node (handled by attr-ext loop)
      if (existingNodeIds.has(attributeNodeId(kind, remId))) {
        continue;
      }
      
      let rem: PluginRem | null = null;
      try {
        rem = await findRemCached(plugin, remId, context);
      } catch (_) {
        continue;
      }
      if (!rem) continue;
      
      // Get what this REM extends
      let extendsParents: PluginRem[] = [];
      try {
        extendsParents = await getExtendsParents(plugin, rem);
      } catch (_) {
        continue;
      }
      
      for (const parent of extendsParents) {
        // If parent is visible as a REM node, skip creating interface-to-rem edge
        // The REM hierarchy edge already connects them, and the parent will have its own interface-to-rem edge if needed
        if (existingNodeIds.has(parent._id)) {
          continue;
        }
        
        // Check if this parent is visible as an interface node, or find closest visible ancestor
        let visibleInterfaceId: string | null = parent._id;
        const directInterfaceNodeId = attributeNodeId(kind, parent._id);
        
        if (!existingNodeIds.has(directInterfaceNodeId) || hiddenAttributes?.has(parent._id)) {
          // Parent interface is not visible, find closest visible ancestor
          visibleInterfaceId = await findClosestVisibleAncestor(parent._id, existingNodeIds, kind);
        }
        
        if (visibleInterfaceId && interfaceNodeIds.has(visibleInterfaceId)) {
          const interfaceNodeId = attributeNodeId(kind, visibleInterfaceId);
          if (existingNodeIds.has(interfaceNodeId)) {
            const edgeId = `interface-to-rem:${visibleInterfaceId}->${remId}`;
            // Also check if an attr-ext edge already exists for this connection
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
                style: { stroke: getColorForNode(interfaceNodeId), strokeDasharray: "4 2" }
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

async function addMissingRemEdges(
  plugin: RNPlugin,
  nodes: GraphNode[],
  edges: GraphEdge[],
  childToParentsMap?: Record<string, Set<string>>,
  computationContext?: LoadComputationContext
): Promise<GraphEdge[]> {
  const visibleRemIds = new Set(nodes.filter(n => n.type === "remNode").map(n => n.id));
  const edgeMap = new Map(edges.map(e => [`${e.source}->${e.target}`, e.id]));
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
      style: { stroke: getColorForNode(sourceId) }
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
      getStructuralDescendantChildren(plugin, rem)
    ]);
    const childrenIds = [...new Set([...extendsC, ...structuralC].filter(c => c).map(c => c._id).filter(id => visibleRemIds.has(id)))];
    for (const childId of childrenIds) {
      addEdgeIfMissing(rem._id, childId);
    }
  }
  return [...edges, ...newEdges];
}

const buildDescendantOwnerMap = (descendants: HierarchyNode[]): Record<string, string> => {
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

function collectRemsForProperties(
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

async function buildAttributeData(plugin: RNPlugin, rems: PluginRem[], topLevelIsDocument: boolean, skipTopLevelForId?: string, signal?: TimeoutSignal, hierarchyRemIds?: Set<string>, context?: LoadComputationContext): Promise<AttributeData> {
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
    // Check timeout before processing
    if (signal && isTimedOut(signal)) {
      return [];
    }
    // Depth limit: stop recursing beyond MAX_ATTRIBUTE_DEPTH
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
        const docFlags = await Promise.all(children.map((child) => child.isDocument()));
        childrenRems = children.filter((_, i) => docFlags[i]);
      } else {
        const [structuralChildren, extendsChildren] = await Promise.all([
          getStructuralDescendantChildren(plugin, owner),
          context ? getExtendsChildrenCached(plugin, owner, context) : getExtendsChildren(plugin, owner),
        ]);
        // Merge structural + extends children, deduplicated by id
        const merged = new Map<string, PluginRem>(structuralChildren.map((r) => [r._id, r]));
        for (const r of extendsChildren) {
          // Exclude hierarchy REMs (class descendants) so they aren't treated as interface attributes
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
    // Stage 1: check timeout before firing parallel fetches
    if (signal && isTimedOut(signal)) {
      return [];
    }

    // Stage 1: fetch all per-attribute metadata in parallel (6 calls per attr, all independent)
    const metaResults = await Promise.all(
      childrenRems.map(async (attr) => {
        const [type, labelRaw, parentRems, isPrivate, isDescriptorProperty, hasExportTag] = await Promise.all([
          attr.getType(),
          getRemText(plugin, attr),
          getExtendsParents(plugin, attr).catch(() => [] as PluginRem[]),
          hasTag(plugin, attr, "Private"),
          isPropertyDescriptor(plugin, attr),
          hasTag(plugin, attr, "Export"),
        ]);
        return { attr, type, labelRaw, parentRems, isPrivate, isDescriptorProperty, hasExportTag };
      })
    );

    // Stage 2: synchronous filter — apply the same skip conditions as before (no awaits needed)
    const filteredMeta = metaResults.filter(({ attr, type, isDescriptorProperty, hasExportTag }) => {
      if (skipTopLevelForId && attr._id === skipTopLevelForId) return false;
      if (type === RemType.PORTAL) return false;
      // Properties (documents) and direct properties (descriptors) are always exported
      // Regular interfaces require the Export tag
      const isExported = topLevelIsDocument || isDescriptorProperty || hasExportTag;
      // Skip non-exported sub-attributes (children of interfaces)
      if (isSubAttribute && !topLevelIsDocument && !isExported) return false;
      return true;
    });

    // Stage 3: recurse for sub-children in parallel, then assemble results
    const attrs: AttributeNodeInfo[] = await Promise.all(
      filteredMeta.map(async ({ attr, type, labelRaw, parentRems, isPrivate, isDescriptorProperty, hasExportTag }) => {
        const label = (labelRaw ?? "").trim() || "(Untitled Attribute)";
        const extendsIds = [...new Set(parentRems.map((p) => p._id))];
        const isExported = topLevelIsDocument || isDescriptorProperty || hasExportTag;
        const hierarchyLevel = isSubAttribute ? parentHierarchyLevel : -1;
        // Property descriptors should not have any children (they are terminal)
        const subChildren = isDescriptorProperty
          ? []
          : await collectAttributes(
              attr,
              attributeNodeId(topLevelIsDocument ? 'property' : 'interface', attr._id),
              true,
              attr._id,
              hierarchyLevel,
              depth + 1
            );
        return { id: attr._id, label, richText: attr.text, hierarchyLevel, extends: extendsIds, children: subChildren, isPrivate, isDescriptorProperty, isExported, isDepthCutoff: !isDescriptorProperty && depth + 1 >= MAX_ATTRIBUTE_DEPTH } as AttributeNodeInfo;
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

// Split interface data into two parts: regular interfaces (without Property tag) and direct properties (with Property tag)
function splitInterfaceData(interfaceData: AttributeData): { regularInterfaces: AttributeData; directProperties: AttributeData } {
  const regularByOwner: Record<string, AttributeNodeInfo[]> = {};
  const regularById: Record<string, AttributeDetail> = {};
  const directByOwner: Record<string, AttributeNodeInfo[]> = {};
  const directById: Record<string, AttributeDetail> = {};

  // Helper to filter attributes recursively
  const filterAttributes = (
    attrs: AttributeNodeInfo[],
    forDirect: boolean
  ): AttributeNodeInfo[] => {
    return attrs
      .filter(attr => forDirect ? attr.isDescriptorProperty : !attr.isDescriptorProperty)
      .map(attr => ({
        ...attr,
        // For direct properties, children are already empty (set in collectAttributes)
        // For regular interfaces, filter children recursively
        children: forDirect ? [] : filterAttributes(attr.children, false)
      }));
  };

  for (const [ownerId, attrs] of Object.entries(interfaceData.byOwner)) {
    const regularAttrs = filterAttributes(attrs, false);
    const directAttrs = filterAttributes(attrs, true);
    
    if (regularAttrs.length > 0) {
      regularByOwner[ownerId] = regularAttrs;
    }
    if (directAttrs.length > 0) {
      directByOwner[ownerId] = directAttrs;
    }
  }

  // Split byId based on isDescriptorProperty
  for (const [id, detail] of Object.entries(interfaceData.byId)) {
    if (detail.isDescriptorProperty) {
      directById[id] = detail;
    } else {
      regularById[id] = detail;
    }
  }

  return {
    regularInterfaces: { byOwner: regularByOwner, byId: regularById },
    directProperties: { byOwner: directByOwner, byId: directById }
  };
}

/**
 * Filters interface data to only include interfaces that have the Export tag.
 * Non-exported interfaces are kept in byId (for extends tracking) but removed from byOwner (for display).
 */
function filterExportedInterfaces(interfaceData: AttributeData): AttributeData {
  const filteredByOwner: Record<string, AttributeNodeInfo[]> = {};
  const filteredById: Record<string, AttributeDetail> = {};

  // Only keep exported interfaces for display
  for (const [ownerId, attrs] of Object.entries(interfaceData.byOwner)) {
    const filtered = attrs.filter(attr => attr.isExported);
    if (filtered.length > 0) {
      filteredByOwner[ownerId] = filtered;
    }
  }

  // Keep all interfaces in byId (needed for extends relationship tracking)
  for (const [id, detail] of Object.entries(interfaceData.byId)) {
    filteredById[id] = detail;
  }

  return { byOwner: filteredByOwner, byId: filteredById };
}

function buildVirtualAttributeData(
  attributeData: AttributeData,
  centerId: string,
  ancestors: HierarchyNode[],
  descendants: HierarchyNode[],
  kind: 'property' | 'interface' | 'directProperty',
  childToParentsMap: Record<string, Set<string>>,
  allowedOwnerIds?: Set<string>
): VirtualAttributeData {
  const byOwner: Record<string, VirtualAttributeInfo[]> = {};

  // Build a map from ancestorId to ancestorName by traversing the hierarchy trees
  const ancestorIdToName: Record<string, string> = {};
  const buildAncestorNameMap = (nodes: HierarchyNode[]) => {
    for (const node of nodes) {
      ancestorIdToName[node.id] = node.name;
      if (node.children?.length) {
        buildAncestorNameMap(node.children);
      }
    }
  };
  buildAncestorNameMap(ancestors);
  buildAncestorNameMap(descendants);

  // Helper to compute the ultimate root property ancestor by walking the property extends chain.
  // Must be placed after propertyExtendsMap is built — moved below.

  // First, build a map of property extends relationships for quick lookup
  // (moved up so we can use it in collectImplementedIds for transitive lookup)
  const propertyExtendsMap: Record<string, string[]> = {};
  for (const detail of Object.values(attributeData.byId)) {
    propertyExtendsMap[detail.id] = detail.extends;
  }

  // Walks propertyExtendsMap upward until a property with no parents is found.
  // O(depth of property hierarchy), no async calls.
  const computeRootProperty = (propId: string): string => {
    let current = propId;
    const visited = new Set<string>();
    while (true) {
      visited.add(current);
      // First try the property extends chain
      const parents = propertyExtendsMap[current];
      if (parents && parents.length > 0) {
        const next = parents[0];
        if (!visited.has(next)) {
          current = next;
          continue;
        }
      }
      // If no extends parent (or cycle), also try structural nesting (parentId from sub-attribute hierarchy)
      // e.g. "chemische umwandlungen" is a REM child of "umwandlungen" but doesn't extend it
      const structParent = attributeData.byId[current]?.parentId;
      if (structParent && !visited.has(structParent) && attributeData.byId[structParent]) {
        current = structParent;
        continue;
      }
      // No more parents — this is the root
      return current;
    }
  };
  
  // Helper to get all ancestors of a property (transitive)
  const getPropertyAncestors = (propId: string): Set<string> => {
    const ancestors = new Set<string>();
    const stack = [...(propertyExtendsMap[propId] || [])];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (ancestors.has(current)) continue;
      ancestors.add(current);
      const parents = propertyExtendsMap[current] || [];
      stack.push(...parents);
    }
    return ancestors;
  };

  // Helper to get all children for an owner from byId (includes non-exported interfaces)
  // This is used for implementation tracking - we need to see ALL children, not just exported ones
  const getChildrenForOwnerFromById = (ownerId: string): AttributeNodeInfo[] => {
    const children: AttributeNodeInfo[] = [];
    for (const detail of Object.values(attributeData.byId)) {
      if (detail.ownerNodeId === ownerId) {
        children.push({
          id: detail.id,
          label: '', // Not needed for implementation tracking
          hierarchyLevel: detail.hierarchyLevel,
          extends: detail.extends,
          children: [], // Not needed for implementation tracking
          isPrivate: detail.isPrivate,
          isDescriptorProperty: detail.isDescriptorProperty,
          isExported: detail.isExported,
        });
      }
    }
    return children;
  };

  // Helper to recursively build virtual children from AttributeNodeInfo children
  const buildVirtualChildren = (
    children: AttributeNodeInfo[],
    ownerRemId: string,
    sourceRemId: string,
    sourceRemLabel: string,
    parentHierarchyLevel: number
  ): VirtualAttributeInfo[] => {
    return children.map(child => ({
      id: `virtual:${ownerRemId}:${child.id}`,
      label: child.label,
      richText: child.richText,
      hierarchyLevel: parentHierarchyLevel,
      sourcePropertyId: child.id,
      ownerRemId: ownerRemId,
      sourceRemId: sourceRemId,
      sourceRemLabel: sourceRemLabel,
      children: buildVirtualChildren(child.children, ownerRemId, sourceRemId, sourceRemLabel, parentHierarchyLevel),
      extendsVirtualIds: [],  // Virtual children don't track extends for now
      isDescriptorProperty: child.isDescriptorProperty,
      isDepthCutoff: child.isDepthCutoff,
    }));
  };

  // Build a map of which properties each REM implements (directly or via extends)
  const implementedByOwner: Record<string, Set<string>> = {};
  
  // Helper to recursively collect all property IDs that a set of attributes "implements"
  // This now includes transitive ancestors of extended properties
  const collectImplementedIds = (attrs: AttributeNodeInfo[]): Set<string> => {
    const result = new Set<string>();
    for (const attr of attrs) {
      result.add(attr.id);
      // Also add all properties this extends from (including transitive ancestors)
      for (const extId of attr.extends) {
        result.add(extId);
        // Add transitive ancestors of extended properties
        const transitiveAncestors = getPropertyAncestors(extId);
        transitiveAncestors.forEach(id => result.add(id));
      }
      // Recursively collect from children
      const childIds = collectImplementedIds(attr.children);
      childIds.forEach(id => result.add(id));
    }
    return result;
  };

  // Helper to collect all IDs from a forest (flattened)
  const collectAllIdsFromForest = (forest: HierarchyNode[]): string[] => {
    const ids: string[] = [];
    const stack = [...forest];
    while (stack.length > 0) {
      const node = stack.pop()!;
      ids.push(node.id);
      if (node.children?.length) {
        stack.push(...node.children);
      }
    }
    return ids;
  };

  // Get ALL ancestor IDs (flattened from the entire forest)
  const allAncestorIds = collectAllIdsFromForest(ancestors);
  const allDescendantIds = collectAllIdsFromForest(descendants);

  // Build a set of ALL hierarchy REM IDs (ancestors + center + descendants)
  // This is used to distinguish actual interface attributes from hierarchy descendants
  // that appear as structural children in attributeData.byOwner
  const allHierarchyRemIds = new Set([centerId, ...allAncestorIds, ...allDescendantIds]);

  // Compute the TRANSITIVE ancestors for a given node using the pre-built parent map
  // This correctly handles the DAG structure where nodes may have multiple parents
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
          if (!visited.has(parent)) {
            stack.push(parent);
          }
        }
      }
    }
    
    return result;
  };

  // Build implementedByOwner: for each rem, collect what it "implements" through:
  // 1. Its structural children (interfaces) and their extends
  // 2. Its own extends relationships (what it directly inherits from via hierarchy/extends)
  // IMPORTANT: Use byId to get ALL children (including non-exported) for implementation tracking
  // IMPORTANT: Filter out hierarchy descendants (REMs in the tree) from attrs
  // because a child REM implementing an interface should NOT mark it as implemented for the parent
  const allOwnerIds = new Set(Object.values(attributeData.byId).map(d => d.ownerNodeId));
  for (const ownerId of allOwnerIds) {
    // Get ALL children from byId (includes non-exported interfaces)
    const attrs = getChildrenForOwnerFromById(ownerId);
    // Filter out any attrs that are actually hierarchy REMs (not interface attributes)
    const actualInterfaceAttrs = attrs.filter(attr => !allHierarchyRemIds.has(attr.id));
    implementedByOwner[ownerId] = collectImplementedIds(actualInterfaceAttrs);
  }
  
  // Also add each rem's transitive ancestors (via extends/hierarchy) to its implemented set
  // This ensures that if Crossbow extends Two-Handed Weapon, Crossbow "implements" Two-Handed Weapon
  const allRemIds = [centerId, ...allAncestorIds, ...allDescendantIds];
  for (const remId of allRemIds) {
    if (!implementedByOwner[remId]) {
      implementedByOwner[remId] = new Set();
    }
    const transitiveAncestors = computeTransitiveAncestors(remId);
    for (const ancestorId of transitiveAncestors) {
      implementedByOwner[remId].add(ancestorId);
    }
  }

  // Build ancestor chain for ALL REMs (ancestors, center, and descendants)
  const remAncestorMap: Record<string, string[]> = {};

  // Build remAncestorMap for all ancestor REMs using transitive closure
  for (const ancestorId of allAncestorIds) {
    remAncestorMap[ancestorId] = [...computeTransitiveAncestors(ancestorId)];
  }

  // Center REM gets all its transitive ancestors
  remAncestorMap[centerId] = [...computeTransitiveAncestors(centerId)];

  // For each descendant, build the ancestor chain using the proper childToParentsMap
  // This correctly handles multiple inheritance via "extends"
  for (const descendantId of allDescendantIds) {
    // Use computeTransitiveAncestors which properly follows all parent relationships
    // including both structural parents and "extends" relationships
    remAncestorMap[descendantId] = [...computeTransitiveAncestors(descendantId)];
  }

  // Build a parent-to-children map (inverse of childToParentsMap) for computing descendants
  const parentToChildrenMap: Record<string, Set<string>> = {};
  for (const [childId, parentIds] of Object.entries(childToParentsMap)) {
    for (const parentId of parentIds) {
      if (!parentToChildrenMap[parentId]) {
        parentToChildrenMap[parentId] = new Set();
      }
      parentToChildrenMap[parentId].add(childId);
    }
  }

  // Compute transitive descendants for a given node
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
          if (!visited.has(child)) {
            stack.push(child);
          }
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
    if (ownerRemId === sourceRemId) {
      return -1;
    }

    const ownerDistances = getAncestorDistanceMap(ownerRemId);
    const sourceDistances = getAncestorDistanceMap(sourceRemId);
    let minSharedDepth = Number.POSITIVE_INFINITY;

    for (const sharedId of sourceDistances.keys()) {
      const depthFromOwner = ownerDistances.get(sharedId);
      if (depthFromOwner === undefined || depthFromOwner <= 0) continue;
      if (depthFromOwner < minSharedDepth) {
        minSharedDepth = depthFromOwner;
      }
    }

    if (!Number.isFinite(minSharedDepth)) {
      return 0;
    }

    return Math.max(0, minSharedDepth - 1);
  };

  // Now for each REM, find which ancestor properties are NOT implemented
  // We need to only show the "closest" unimplemented property in the chain
  // (i.e., if ProbB extends ProbA and neither is implemented, only show ProbB)

  for (const [remId, ancestorIds] of Object.entries(remAncestorMap)) {
    // Skip rems that are not in the allowed owner scope (e.g. center-only mode)
    if (allowedOwnerIds && !allowedOwnerIds.has(remId)) continue;

    // Skip generating virtual attributes if this REM itself has the Property tag
    // (Property-tagged interfaces are terminal and don't need to implement virtual interfaces)
    const remDetail = attributeData.byId[remId];
    if (remDetail?.isDescriptorProperty) {
      continue;
    }
    
    const implemented = implementedByOwner[remId] || new Set<string>();
    const candidateVirtualAttrs: VirtualAttributeInfo[] = [];
    
    // Build a set of this rem's ancestors for quick lookup
    const remAncestorSet = new Set(ancestorIds);
    
    // Build a set of this rem's descendants
    const remDescendantSet = computeTransitiveDescendants(remId);

    // Helper: Get all base interfaces that are "covered" by a REM's direct interface children
    // These are interfaces that should NOT appear as virtual because they're already implemented
    // via an interface child that extends them (directly or transitively)
    // NOTE: Uses byId to include non-exported children in implementation tracking
    const getImplementedBaseInterfaces = (): Set<string> => {
      const implementedBases = new Set<string>();
      // Use byId-based lookup to include non-exported children
      const remChildren = getChildrenForOwnerFromById(remId);
      
      for (const child of remChildren) {
        // Add all interfaces this child extends (direct and transitive)
        for (const extId of child.extends) {
          implementedBases.add(extId);
          // Add transitive ancestors (InterfaceA' extends InterfaceA, InterfaceA extends InterfaceZ...)
          const transitiveAncestors = getPropertyAncestors(extId);
          for (const ancestorId of transitiveAncestors) {
            implementedBases.add(ancestorId);
          }
        }
      }
      
      return implementedBases;
    };

    // Compute implemented base interfaces once per REM
    const implementedBaseInterfaces = getImplementedBaseInterfaces();

    // First pass: collect all unimplemented properties as candidates
    for (const ancestorId of ancestorIds) {
      const ancestorProps = attributeData.byOwner[ancestorId] || [];
      
      // Only check top-level properties (documents under the ancestor), not their children
      for (const prop of ancestorProps) {
        // Skip the rem itself
        if (prop.id === remId) continue;
        
        // Skip non-exported interfaces - only exported ones create implementation requirements
        if (!prop.isExported) continue;
        
        // Skip if this property has the "Private" tag
        if (prop.isPrivate) continue;
        
        // Skip if this property's rem ID is an ancestor of the current rem
        // (a rem should not appear as a virtual interface if it's an ancestor through hierarchy or extends)
        if (remAncestorSet.has(prop.id)) continue;
        
        // Skip if this property's rem ID is a descendant of the current rem
        // (a rem should not implement its descendants as interfaces)
        if (remDescendantSet.has(prop.id)) continue;
        
        // Skip if this rem already has a child that extends this interface
        // (the interface is already implemented through the child)
        if (implementedBaseInterfaces.has(prop.id)) continue;
        
        // Check if this property (or something extending it) is implemented
        if (!implemented.has(prop.id)) {
          // Check if we already have a virtual node for this property on this REM
          const existingVirtual = candidateVirtualAttrs.find(v => v.sourcePropertyId === prop.id);
          if (!existingVirtual) {
            const sourceRemLabel = ancestorIdToName[ancestorId] || ancestorId;
            const hierarchyLevel = getHierarchyLevel(remId, ancestorId);
            const baseTypeId = computeRootProperty(prop.id);
            const baseTypeLabel = attributeData.byId[baseTypeId]?.label ?? prop.label;
            candidateVirtualAttrs.push({
              id: `virtual:${remId}:${prop.id}`,
              label: prop.label,
              richText: prop.richText,
              hierarchyLevel,
              sourcePropertyId: prop.id,
              ownerRemId: remId,
              sourceRemId: ancestorId,
              sourceRemLabel: sourceRemLabel,
              // Property-tagged interfaces should not have virtual children (they are "terminal")
              children: prop.isDescriptorProperty
                ? []
                : buildVirtualChildren(prop.children, remId, ancestorId, sourceRemLabel, hierarchyLevel),
              isDescriptorProperty: prop.isDescriptorProperty,
              extendsVirtualIds: [],  // Will be computed in second pass
              isDepthCutoff: prop.isDepthCutoff,
              baseTypeId,
              baseTypeLabel,
            });
          }
        }
      }
    }

    // Second pass: depends on kind
    // For interfaces: keep all candidates, but wrap ancestor labels in parentheses
    // For properties: filter out ancestor candidates (original behavior)
    if (kind === 'interface') {
      // Find which candidates are ancestors of other candidates
      const candidateSourceIds = new Set(candidateVirtualAttrs.map(c => c.sourcePropertyId));
      const ancestorSourceIds = new Set<string>();
      for (const candidate of candidateVirtualAttrs) {
        const ancestors = getPropertyAncestors(candidate.sourcePropertyId);
        for (const ancestorId of ancestors) {
          if (candidateSourceIds.has(ancestorId)) {
            ancestorSourceIds.add(ancestorId);
          }
        }
      }
      // Wrap ancestor labels in parentheses
      for (const candidate of candidateVirtualAttrs) {
        if (ancestorSourceIds.has(candidate.sourcePropertyId)) {
          candidate.label = `(${candidate.label})`;
          candidate.richText = undefined;  // Clear richText so label is used instead
        }
      }
      // Keep all candidates for interfaces
      if (candidateVirtualAttrs.length > 0) {
        byOwner[remId] = candidateVirtualAttrs;
      }
    } else {
      // For properties: filter out ancestor candidates (original behavior)
      // A candidate is an "ancestor" if another candidate's sourcePropertyId extends it
      const candidateSourceIds = new Set(candidateVirtualAttrs.map(c => c.sourcePropertyId));
      const ancestorSourceIds = new Set<string>();
      for (const candidate of candidateVirtualAttrs) {
        const ancestors = getPropertyAncestors(candidate.sourcePropertyId);
        for (const ancestorId of ancestors) {
          if (candidateSourceIds.has(ancestorId)) {
            ancestorSourceIds.add(ancestorId);
          }
        }
      }
      // Filter to keep only the most derived candidates
      const filteredVirtualAttrs = candidateVirtualAttrs.filter(
        c => !ancestorSourceIds.has(c.sourcePropertyId)
      );
      if (filteredVirtualAttrs.length > 0) {
        byOwner[remId] = filteredVirtualAttrs;
      }
    }
  }

  return { byOwner };
}

function layoutVirtualAttributeDescendants(
  parentNode: GraphNode,
  children: VirtualAttributeInfo[],
  nodes: GraphNode[],
  edges: GraphEdge[],
  existingNodeIds: Set<string>,
  existingEdgeIds: Set<string>,
  kind: 'property' | 'interface' | 'directProperty',
  collapsed: Set<string>,
  nodePositions?: Map<string, { x: number; y: number }>
) {
  if (children.length === 0) return;

  const sorted = [...children].sort(compareByHierarchyThenLabel);
  const parentData = parentNode.data as GraphNodeData;
  const parentStyleWidth = parentNode.style?.width;
  const parentWidth =
    typeof parentStyleWidth === "number"
      ? parentStyleWidth
      : estimateNodeWidth(parentData.label, parentData.kind);
  const baseX = parentNode.position.x + parentWidth + ATTRIBUTE_HORIZONTAL_SPACING;
  const startOffset = ((sorted.length - 1) / 2) * ATTRIBUTE_VERTICAL_SPACING;

  sorted.forEach((info, index) => {
    const nodeId = info.id;
    const virtualKind = kind === 'property' ? 'virtualProperty' : kind === 'interface' ? 'virtualInterface' : 'virtualDirectProperty';
    const hasChildren = info.children && info.children.length > 0;
    const isCollapsed = collapsed.has(info.id);
    const attrWidth = estimateNodeWidth(info.label, virtualKind);
    let posX = baseX;
    let posY = parentNode.position.y + index * ATTRIBUTE_VERTICAL_SPACING - startOffset;

    const storedPos = nodePositions?.get(nodeId);
    if (storedPos) {
      posX = storedPos.x;
      posY = storedPos.y;
    }

    const nodeStyle = getNodeStyle(virtualKind, hasChildren && isCollapsed, false, undefined, info.isDescriptorProperty);
    const finalStyle = info.isDepthCutoff ? { ...nodeStyle, borderColor: '#e63946', borderWidth: 2 } : nodeStyle;

    let childNodeIndex = nodes.findIndex((n) => n.id === nodeId);
    let childNode = childNodeIndex >= 0 ? nodes[childNodeIndex] : null;
    const updatedData: GraphNodeData = {
      label: info.label,
      remId: info.id,
      kind: virtualKind,
      sourcePropertyId: info.sourcePropertyId,
      ownerRemId: info.ownerRemId,
      sourceRemLabel: info.sourceRemLabel,
      isDescriptorProperty: info.isDescriptorProperty,
      isDepthCutoff: info.isDepthCutoff,
    };

    if (!childNode) {
      childNode = {
        id: nodeId,
        position: { x: posX, y: posY },
        data: updatedData,
        style: finalStyle,
        draggable: true,
        selectable: true,
        type: `${virtualKind}Node`,
      };
      nodes.push(childNode);
      existingNodeIds.add(nodeId);
      childNodeIndex = nodes.length - 1;
    } else {
      if (!storedPos) {
        childNode = {
          ...childNode,
          position: { x: posX, y: posY },
          data: updatedData,
          style: finalStyle,
        };
        nodes[childNodeIndex] = childNode;
      } else {
        childNode = {
          ...childNode,
          data: updatedData,
          style: finalStyle,
        };
        nodes[childNodeIndex] = childNode;
      }
    }

    existingNodeIds.add(nodeId);

    // Create edge from parent virtual node to child virtual node
    const linkEdgeId = `vattr-child:${parentNode.id}->${info.id}`;
    if (!existingEdgeIds.has(linkEdgeId)) {
      edges.push({
        id: linkEdgeId,
        source: parentNode.id,
        target: nodeId,
        sourceHandle: ATTRIBUTE_SOURCE_RIGHT_HANDLE,
        targetHandle: ATTRIBUTE_TARGET_LEFT_HANDLE,
        type: "randomOffset",
        markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
        style: { stroke: "#9ca3af", strokeDasharray: "4 2" }, // Grey dashed line for virtual children
      });
      existingEdgeIds.add(linkEdgeId);
    }

    // Recursively layout children if not collapsed
    if (hasChildren && !isCollapsed) {
      layoutVirtualAttributeDescendants(
        childNode,
        info.children,
        nodes,
        edges,
        existingNodeIds,
        existingEdgeIds,
        kind,
        collapsed,
        nodePositions
      );
    }
  });
}

function layoutVirtualAttributes(
  ownerNode: GraphNode,
  virtualAttrs: VirtualAttributeInfo[],
  existingAttrsCount: number,
  nodes: GraphNode[],
  edges: GraphEdge[],
  existingNodeIds: Set<string>,
  existingEdgeIds: Set<string>,
  kind: 'property' | 'interface' | 'directProperty',
  collapsed: Set<string>,
  nodePositions?: Map<string, { x: number; y: number }>
) {
  if (virtualAttrs.length === 0) return;

  const ownerData = ownerNode.data as GraphNodeData;
  const ownerStyleWidth = ownerNode.style?.width;
  const ownerWidth =
    typeof ownerStyleWidth === "number"
      ? ownerStyleWidth
      : estimateNodeWidth(ownerData.label, ownerData.kind);
  const ownerStyleHeight = ownerNode.style?.height;
  const ownerHeight =
    typeof ownerStyleHeight === "number"
      ? ownerStyleHeight
      : ownerData.kind === "rem"
      ? REM_NODE_HEIGHT_ESTIMATE
      : ATTRIBUTE_NODE_HEIGHT_ESTIMATE;

  const baseY =
    ownerNode.position.y +
    ownerHeight +
    ATTRIBUTE_VERTICAL_MARGIN +
    existingAttrsCount * ATTRIBUTE_VERTICAL_SPACING;

  // For virtualInterface kind: group by sourceRemId and render with group header nodes
  if (kind === 'interface') {
    // Build groups: Map<sourceRemId, { sourceRemLabel, minHierarchyLevel, items }>
    const groupMap = new Map<string, { sourceRemLabel: string; minHierarchyLevel: number; items: VirtualAttributeInfo[] }>();
    for (const info of virtualAttrs) {
      const existing = groupMap.get(info.sourceRemId);
      const level = info.hierarchyLevel ?? 0;
      if (existing) {
        existing.items.push(info);
        if (level < existing.minHierarchyLevel) existing.minHierarchyLevel = level;
      } else {
        groupMap.set(info.sourceRemId, {
          sourceRemLabel: info.sourceRemLabel,
          minHierarchyLevel: level,
          items: [info],
        });
      }
    }

    // Sort groups by minHierarchyLevel then by sourceRemLabel
    const sortedGroups = [...groupMap.entries()].sort(([, a], [, b]) => {
      if (a.minHierarchyLevel !== b.minHierarchyLevel) return a.minHierarchyLevel - b.minHierarchyLevel;
      return a.sourceRemLabel.localeCompare(b.sourceRemLabel);
    });

    let slotOffset = 0; // tracks vertical slots used so far (in ATTRIBUTE_VERTICAL_SPACING units)

    for (const [sourceRemId, group] of sortedGroups) {
      const groupNodeId = `vgroup:${ownerNode.id}:${sourceRemId}`;
      const sortedItems = [...group.items].sort(compareByHierarchyThenLabel);
      const groupSize = sortedItems.length;

      // The group header is vertically centered over its children
      const groupCenterSlot = slotOffset + (groupSize - 1) / 2;
      let groupX = ownerNode.position.x + 150;
      let groupY = baseY + groupCenterSlot * ATTRIBUTE_VERTICAL_SPACING;

      const storedGroupPos = nodePositions?.get(groupNodeId);
      if (storedGroupPos) {
        groupX = storedGroupPos.x;
        groupY = storedGroupPos.y;
      }

      const isGroupCollapsed = collapsed.has(groupNodeId);
      const groupStyle = getNodeStyle('virtualInterfaceGroup', isGroupCollapsed, false);
      let groupNode: GraphNode;
      if (!existingNodeIds.has(groupNodeId)) {
        groupNode = {
          id: groupNodeId,
          position: { x: groupX, y: groupY },
          data: {
            label: group.sourceRemLabel,
            remId: groupNodeId,
            kind: 'virtualInterfaceGroup',
            sourceRemLabel: group.sourceRemLabel,
            ownerRemId: ownerNode.id,
          },
          style: groupStyle,
          draggable: true,
          selectable: true,
          type: 'virtualInterfaceGroupNode',
        };
        nodes.push(groupNode);
        existingNodeIds.add(groupNodeId);
      } else {
        groupNode = nodes.find(n => n.id === groupNodeId)!;
      }

      // Edge: owner → group header (grey solid)
      const groupEdgeId = `vgroup-link:${ownerNode.id}->${groupNodeId}`;
      if (!existingEdgeIds.has(groupEdgeId)) {
        edges.push({
          id: groupEdgeId,
          source: ownerNode.id,
          target: groupNodeId,
          sourceHandle: ownerNode.type === "remNode" ? REM_SOURCE_BOTTOM_HANDLE : ATTRIBUTE_SOURCE_BOTTOM_HANDLE,
          targetHandle: ATTRIBUTE_TARGET_LEFT_HANDLE,
          type: "randomOffset",
          markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
          style: { stroke: "#9ca3af" },
        });
        existingEdgeIds.add(groupEdgeId);
      }

      // Lay out children to the right of group header (unless group is collapsed)
      if (!isGroupCollapsed) {
        const groupWidth =
          typeof groupNode.style?.width === "number"
            ? groupNode.style.width
            : estimateNodeWidth(group.sourceRemLabel, 'virtualInterfaceGroup');
        const childX = groupX + groupWidth + ATTRIBUTE_HORIZONTAL_SPACING;
        const startOffset = ((groupSize - 1) / 2) * ATTRIBUTE_VERTICAL_SPACING;

        sortedItems.forEach((info, childIndex) => {
          const nodeId = info.id;
          if (existingNodeIds.has(nodeId)) return;

          let posX = childX;
          let posY = groupY + childIndex * ATTRIBUTE_VERTICAL_SPACING - startOffset;

          const storedPos = nodePositions?.get(nodeId);
          if (storedPos) {
            posX = storedPos.x;
            posY = storedPos.y;
          }

          const hasChildren = info.children && info.children.length > 0;
          const isCollapsedItem = collapsed.has(info.id);
          const nodeStyle = getNodeStyle('virtualInterface', hasChildren && isCollapsedItem, false, undefined, info.isDescriptorProperty);
          const finalStyle = info.isDepthCutoff ? { ...nodeStyle, borderColor: '#e63946', borderWidth: 2 } : nodeStyle;

          nodes.push({
            id: nodeId,
            position: { x: posX, y: posY },
            data: {
              label: info.label,
              richText: info.richText,
              remId: info.id,
              kind: 'virtualInterface',
              sourcePropertyId: info.sourcePropertyId,
              ownerRemId: info.ownerRemId,
              sourceRemLabel: info.sourceRemLabel,
              isDescriptorProperty: info.isDescriptorProperty,
              isDepthCutoff: info.isDepthCutoff,
            },
            style: finalStyle,
            draggable: true,
            selectable: true,
            type: 'virtualInterfaceNode',
          });
          existingNodeIds.add(nodeId);

          const virtualNode = nodes[nodes.length - 1];

          // Edge: group header → child (grey dashed)
          const childEdgeId = `vgroup-child:${groupNodeId}->${nodeId}`;
          if (!existingEdgeIds.has(childEdgeId)) {
            edges.push({
              id: childEdgeId,
              source: groupNodeId,
              target: nodeId,
              sourceHandle: ATTRIBUTE_SOURCE_RIGHT_HANDLE,
              targetHandle: ATTRIBUTE_TARGET_LEFT_HANDLE,
              type: "randomOffset",
              markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
              style: { stroke: "#9ca3af", strokeDasharray: "4 2" },
            });
            existingEdgeIds.add(childEdgeId);
          }

          // Recurse into children of the virtual interface node if not collapsed
          if (hasChildren && !isCollapsedItem) {
            layoutVirtualAttributeDescendants(
              virtualNode,
              info.children,
              nodes,
              edges,
              existingNodeIds,
              existingEdgeIds,
              kind,
              collapsed,
              nodePositions
            );
          }
        });
      }

      // When collapsed, only the header node occupies a slot (not all its children)
      slotOffset += isGroupCollapsed ? 1 : groupSize;
    }

    return;
  }

  // Non-interface kinds: group by ultimate root ancestor (base type)
  const virtualKind = kind === 'property' ? 'virtualProperty' : 'virtualDirectProperty';

  // Build groups: Map<baseTypeId, { baseTypeLabel, minHierarchyLevel, items }>
  const groupMap = new Map<string, { baseTypeLabel: string; minHierarchyLevel: number; items: VirtualAttributeInfo[] }>();
  for (const info of virtualAttrs) {
    const groupId = info.baseTypeId ?? info.sourceRemId;
    const groupLabel = info.baseTypeLabel ?? info.sourceRemLabel;
    const existing = groupMap.get(groupId);
    const level = info.hierarchyLevel ?? 0;
    if (existing) {
      existing.items.push(info);
      if (level < existing.minHierarchyLevel) existing.minHierarchyLevel = level;
    } else {
      groupMap.set(groupId, { baseTypeLabel: groupLabel, minHierarchyLevel: level, items: [info] });
    }
  }

  // Sort groups by minHierarchyLevel then by baseTypeLabel
  const sortedGroups = [...groupMap.entries()].sort(([, a], [, b]) => {
    if (a.minHierarchyLevel !== b.minHierarchyLevel) return a.minHierarchyLevel - b.minHierarchyLevel;
    return a.baseTypeLabel.localeCompare(b.baseTypeLabel);
  });

  let slotOffset = 0;

  for (const [baseTypeId, group] of sortedGroups) {
    const groupNodeId = `vpropgroup:${ownerNode.id}:${baseTypeId}`;
    const sortedItems = [...group.items].sort(compareByHierarchyThenLabel);
    const groupSize = sortedItems.length;

    const groupCenterSlot = slotOffset + (groupSize - 1) / 2;
    let groupX = ownerNode.position.x + 150;
    let groupY = baseY + groupCenterSlot * ATTRIBUTE_VERTICAL_SPACING;

    const storedGroupPos = nodePositions?.get(groupNodeId);
    if (storedGroupPos) {
      groupX = storedGroupPos.x;
      groupY = storedGroupPos.y;
    }

    const isGroupCollapsed = collapsed.has(groupNodeId);
    const groupStyle = getNodeStyle('virtualInterfaceGroup', isGroupCollapsed, false);
    let groupNode: GraphNode;
    if (!existingNodeIds.has(groupNodeId)) {
      groupNode = {
        id: groupNodeId,
        position: { x: groupX, y: groupY },
        data: {
          label: group.baseTypeLabel,
          remId: groupNodeId,
          kind: 'virtualInterfaceGroup',
          sourceRemLabel: group.baseTypeLabel,
          ownerRemId: ownerNode.id,
        },
        style: groupStyle,
        draggable: true,
        selectable: true,
        type: 'virtualInterfaceGroupNode',
      };
      nodes.push(groupNode);
      existingNodeIds.add(groupNodeId);
    } else {
      groupNode = nodes.find(n => n.id === groupNodeId)!;
    }

    // Edge: owner → group header (grey solid)
    const groupEdgeId = `vpropgroup-link:${ownerNode.id}->${groupNodeId}`;
    if (!existingEdgeIds.has(groupEdgeId)) {
      edges.push({
        id: groupEdgeId,
        source: ownerNode.id,
        target: groupNodeId,
        sourceHandle: ownerNode.type === "remNode" ? REM_SOURCE_BOTTOM_HANDLE : ATTRIBUTE_SOURCE_BOTTOM_HANDLE,
        targetHandle: ATTRIBUTE_TARGET_LEFT_HANDLE,
        type: "randomOffset",
        markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
        style: { stroke: "#9ca3af" },
      });
      existingEdgeIds.add(groupEdgeId);
    }

    if (!isGroupCollapsed) {
      const groupWidth =
        typeof groupNode.style?.width === "number"
          ? groupNode.style.width
          : estimateNodeWidth(group.baseTypeLabel, 'virtualInterfaceGroup');
      const childX = groupX + groupWidth + ATTRIBUTE_HORIZONTAL_SPACING;
      const startOffset = ((groupSize - 1) / 2) * ATTRIBUTE_VERTICAL_SPACING;

      sortedItems.forEach((info, childIndex) => {
        const nodeId = info.id;
        if (existingNodeIds.has(nodeId)) return;

        let posX = childX;
        let posY = groupY + childIndex * ATTRIBUTE_VERTICAL_SPACING - startOffset;

        const storedPos = nodePositions?.get(nodeId);
        if (storedPos) {
          posX = storedPos.x;
          posY = storedPos.y;
        }

        const hasChildren = info.children && info.children.length > 0;
        const isCollapsedItem = collapsed.has(info.id);
        const nodeStyle = getNodeStyle(virtualKind, hasChildren && isCollapsedItem, false, undefined, info.isDescriptorProperty);
        const finalStyle = info.isDepthCutoff ? { ...nodeStyle, borderColor: '#e63946', borderWidth: 2 } : nodeStyle;

        nodes.push({
          id: nodeId,
          position: { x: posX, y: posY },
          data: {
            label: info.label,
            richText: info.richText,
            remId: info.id,
            kind: virtualKind,
            sourcePropertyId: info.sourcePropertyId,
            ownerRemId: info.ownerRemId,
            sourceRemLabel: info.sourceRemLabel,
            isDescriptorProperty: info.isDescriptorProperty,
            isDepthCutoff: info.isDepthCutoff,
          },
          style: finalStyle,
          draggable: true,
          selectable: true,
          type: `${virtualKind}Node`,
        });
        existingNodeIds.add(nodeId);

        const virtualNode = nodes[nodes.length - 1];

        // Edge: group header → child (grey dashed)
        const childEdgeId = `vpropgroup-child:${groupNodeId}->${nodeId}`;
        if (!existingEdgeIds.has(childEdgeId)) {
          edges.push({
            id: childEdgeId,
            source: groupNodeId,
            target: nodeId,
            sourceHandle: ATTRIBUTE_SOURCE_RIGHT_HANDLE,
            targetHandle: ATTRIBUTE_TARGET_LEFT_HANDLE,
            type: "randomOffset",
            markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
            style: { stroke: "#9ca3af", strokeDasharray: "4 2" },
          });
          existingEdgeIds.add(childEdgeId);
        }

        if (hasChildren && !isCollapsedItem) {
          layoutVirtualAttributeDescendants(
            virtualNode,
            info.children,
            nodes,
            edges,
            existingNodeIds,
            existingEdgeIds,
            kind,
            collapsed,
            nodePositions
          );
        }
      });
    }

    // When collapsed, only the header node occupies a slot (not all its children)
    slotOffset += isGroupCollapsed ? 1 : groupSize;
  }
}

async function saveMindMapState(
  plugin: RNPlugin,
  state: MindMapState
): Promise<void> {
  try {
    await plugin.storage.setSynced(MINDMAP_STATE_KEY, state);
  } catch (err) {
    console.error("Failed to save mindmap state:", err);
  }
}

async function loadMindMapState(
  plugin: RNPlugin
): Promise<MindMapState | null> {
  try {
    // If restoreFromSynced is false, clear storage and return null
    if (!restoreFromSynced) {
      await plugin.storage.setSynced(MINDMAP_STATE_KEY, null);
      return null;
    }
    
    const state = await plugin.storage.getSynced(MINDMAP_STATE_KEY);
    if (state && typeof state === "object" && "loadedRemId" in state) {
      return state as MindMapState;
    }
    return null;
  } catch (err) {
    console.error("Failed to load mindmap state:", err);
    return null;
  }
}

function MindmapWidget() {
  const plugin = usePlugin();

  const focusedRem = useTrackerPlugin(async (reactPlugin) => {
    return await reactPlugin.focus.getFocusedRem();
  });

  const [focusedRemName, setFocusedRemName] = useState<string>("");
  const [loadedRemName, setLoadedRemName] = useState<string>("");
  const [loadedRemRichText, setLoadedRemRichText] = useState<RichTextInterface | undefined>(undefined);
  const [loadedRemId, setLoadedRemId] = useState<string>("");
  const [ancestorTrees, setAncestorTrees] = useState<HierarchyNode[]>([]);
  const [descendantTrees, setDescendantTrees] = useState<HierarchyNode[]>([]);
  const [descendantOwnerMap, setDescendantOwnerMap] = useState<Record<string, string>>({});
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(() => new Set<string>());
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [propertyData, setPropertyData] = useState<AttributeData | null>(null);
  const [interfaceData, setInterfaceData] = useState<AttributeData | null>(null);
  const [directPropertyData, setDirectPropertyData] = useState<AttributeData | null>(null);
  const [hiddenAttributes, setHiddenAttributes] = useState<Set<string>>(() => new Set<string>());
  const [hiddenVirtualAttributes, setHiddenVirtualAttributes] = useState<Set<string>>(() => new Set<string>());
  const [attributeType, setAttributeType] = useState<'property' | 'interface'>('property');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isPartialLoad, setIsPartialLoad] = useState<boolean>(false);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  const [historyStack, setHistoryStack] = useState<string[]>([]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; remId: string; label: string } | null>(null);
  const [virtualContextMenu, setVirtualContextMenu] = useState<{ x: number; y: number; nodeId: string; label: string; sourcePropertyId: string; ownerRemId: string } | null>(null);
  const [paneContextMenu, setPaneContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [parentMap, setParentMap] = useState<Map<string, string>>(new Map());
  const [isInitialized, setIsInitialized] = useState<boolean>(false);

  const nodePositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const hiddenAttributeOffsetsRef = useRef<Map<string, { dx: number; dy: number }>>(new Map());
  const loadComputationContextRef = useRef<LoadComputationContext>(createLoadComputationContext());

  const storePositions = useCallback((nodeList: GraphNode[]) => {
    for (const node of nodeList) {
      nodePositionsRef.current.set(node.id, {
        x: node.position.x,
        y: node.position.y,
      });
    }
  }, []);

  const focusedRemId = focusedRem?._id;

  // Save state whenever key values change
  useEffect(() => {
    if (!isInitialized || !loadedRemId) return;

    const stateToSave: MindMapState = {
      loadedRemId,
      attributeType,
      historyStack,
    };

    saveMindMapState(plugin, stateToSave);
  }, [
    isInitialized,
    loadedRemId,
    attributeType,
    historyStack,
    plugin,
  ]);

  // Load saved state on mount
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

  const updateGraph = useCallback(async () => {
    if (!loadedRemId) return;
    // When attributeType is 'property', use both propertyData and directPropertyData
    const primaryData = attributeType === 'property' ? propertyData : interfaceData;
    const secondaryData = attributeType === 'property' ? directPropertyData : undefined;
    const primaryKind: 'property' | 'interface' | 'directProperty' = attributeType === 'property' ? 'property' : 'interface';
    const secondaryKind: 'property' | 'interface' | 'directProperty' | undefined = attributeType === 'property' ? 'directProperty' : undefined;
    
    const graph = await createGraphData(
      plugin,
      loadedRemId,
      loadedRemName || "(Untitled Rem)",
      loadedRemRichText,
      ancestorTrees,
      descendantTrees,
      collapsedNodes,
      primaryData ?? undefined,
      hiddenAttributes,
      hiddenVirtualAttributes,
      nodePositionsRef.current,
      primaryKind,
      secondaryData ?? undefined,
      secondaryKind,
      loadComputationContextRef.current
    );
    const updatedEdges = await addMissingRemEdges(
      plugin,
      graph.nodes,
      graph.edges,
      loadComputationContextRef.current.childToParentsMap,
      loadComputationContextRef.current
    );
    
    // Rebuild parentMap from edges — covers all attribute/virtual hierarchies:
    // attr-link/attr-child (regular properties), vpropgroup-link/vpropgroup-child (virtual property groups),
    // vgroup-link/vgroup-child (virtual interface groups), vattr-link/vattr-child (virtual attr descendants)
    setParentMap(() => {
      const newMap = new Map<string, string>();
      const ATTR_EDGE_PREFIXES = [
        'attr-link:', 'attr-child:',
        'vpropgroup-link:', 'vpropgroup-child:',
        'vgroup-link:', 'vgroup-child:',
        'vattr-link:', 'vattr-child:',
      ];
      for (const edge of updatedEdges) {
        if (ATTR_EDGE_PREFIXES.some(prefix => edge.id.startsWith(prefix))) {
          newMap.set(edge.target, edge.source);
        }
      }
      return newMap;
    });
    
    setNodes(graph.nodes);
    storePositions(graph.nodes);
    setEdges(updatedEdges);
  }, [loadedRemId, loadedRemName, loadedRemRichText, ancestorTrees, descendantTrees, collapsedNodes, propertyData, interfaceData, directPropertyData, hiddenAttributes, hiddenVirtualAttributes, plugin, storePositions, attributeType]);

  const loadHierarchy = useCallback(
    async (remId: string, ancestorsOnly?: boolean) => {
      loadComputationContextRef.current = createLoadComputationContext();
      setLoading(true);
      setError(null);
      setIsPartialLoad(false);
      setPropertyData(null);
      setInterfaceData(null);
      setDirectPropertyData(null);
      setHiddenAttributes(new Set<string>());
      setHiddenVirtualAttributes(new Set<string>());
      setNodes([]);
      setEdges([]);
      
      // Create timeout signal for graceful termination
      const timeoutSignal = createTimeoutSignal();
      
      try {
        const rem = await findRemCached(plugin, remId, loadComputationContextRef.current);
        if (!rem) {
          throw new Error("Unable to load the selected rem.");
        }

        if ((await rem.getType()) === RemType.PORTAL) {
          setAncestorTrees([]);
          setDescendantTrees([]);
          setDescendantOwnerMap({});
          setCollapsedNodes(new Set<string>());
          setPropertyData({ byOwner: {}, byId: {} });
          setInterfaceData({ byOwner: {}, byId: {} });
          setDirectPropertyData({ byOwner: {}, byId: {} });
          setHiddenAttributes(new Set<string>());
          setHiddenVirtualAttributes(new Set<string>());
          setLoadedRemId(rem._id);
          setLoadedRemName((await getRemText(plugin, rem)) || "(Untitled Rem)");
          setLoadedRemRichText(rem.text);
          setParentMap(new Map());
          setNodes([]);
          setEdges([]);
          return;
        }

        const tLoad = performance.now();

        // 1.1 Collect Ancestors and Descendants
        // Use separate visited sets to avoid race conditions between parallel builds
        const visitedAncestors = new Set<string>([rem._id]);
        const visitedDescendants = new Set<string>([rem._id]);
        const t0 = performance.now();
        const [name, ancestorTreesResult, descendantTreesResult] = await Promise.all([
          getRemText(plugin, rem),
          buildAncestorNodes(plugin, rem, visitedAncestors, loadComputationContextRef.current, timeoutSignal),
          ancestorsOnly ? Promise.resolve([]) : buildDescendantNodes(plugin, rem, visitedDescendants, timeoutSignal),
        ]);
        console.log(`[perf] phase 1 buildAncestors+buildDescendants: ${(performance.now() - t0).toFixed(0)}ms | ancestors=${ancestorTreesResult.length} descendants=${descendantTreesResult.length}`);

        // 1.2 Collect Properties
        const centerLabel = name || "(Untitled Rem)";
        const remsForAttributes = collectRemsForProperties(
          rem,
          ancestorTreesResult,
          descendantTreesResult
        );

        // Collect all hierarchy REM ids so extends-children of interface owners that are
        // class hierarchy nodes are not mistakenly treated as interface attributes.
        const hierarchyRemIds = new Set<string>([rem._id]);
        const hierarchyStack: HierarchyNode[] = [...ancestorTreesResult, ...descendantTreesResult];
        while (hierarchyStack.length > 0) {
          const hn = hierarchyStack.pop()!;
          hierarchyRemIds.add(hn.id);
          if (hn.children && hn.children.length > 0) {
            hierarchyStack.push(...hn.children);
          }
        }
        const t1 = performance.now();
        // Run sequentially so the second call benefits from extendsChildrenCache populated by the first
        const properties = await buildAttributeData(plugin, remsForAttributes, true, undefined, timeoutSignal, undefined, loadComputationContextRef.current);
        const t1b = performance.now();
        console.log(`[perf] phase 2a buildAttributeData (properties): ${(t1b - t1).toFixed(0)}ms | propOwners=${Object.keys(properties.byOwner).length} cacheSize=${loadComputationContextRef.current.extendsChildrenCache.size}`);
        const interfacesRaw = await buildAttributeData(plugin, remsForAttributes, false, undefined, timeoutSignal, hierarchyRemIds, loadComputationContextRef.current);
        console.log(`[perf] phase 2b buildAttributeData (interfaces): ${(performance.now() - t1b).toFixed(0)}ms | ifaceOwners=${Object.keys(interfacesRaw.byOwner).length} cacheSize=${loadComputationContextRef.current.extendsChildrenCache.size}`);
        console.log(`[perf] phase 2 buildAttributeData total: ${(performance.now() - t1).toFixed(0)}ms | rems=${remsForAttributes.length}`);

        // Split interfaces into regular interfaces and direct properties (Property-tagged)
        const { regularInterfaces: interfacesUnfiltered, directProperties } = splitInterfaceData(interfacesRaw);
        // Filter interfaces to only show those with Export tag (or with exported descendants)
        const interfaces = filterExportedInterfaces(interfacesUnfiltered);

        // 1.3
        const collapsed = new Set<string>();
        for (const detail of Object.values(properties.byId)) {
          if (detail.hasChildren) {
            collapsed.add(detail.id);
          }
        }
        for (const detail of Object.values(interfaces.byId)) {
          if (detail.hasChildren) {
            collapsed.add(detail.id);
          }
        }
        for (const detail of Object.values(directProperties.byId)) {
          if (detail.hasChildren) {
            collapsed.add(detail.id);
          }
        }

        // 1.4 Build complete parent map once per load for virtual computations and edge completion
        const t2 = performance.now();
        const childToParentsMap = await buildCompleteChildToParentsMap(
          plugin,
          rem._id,
          ancestorTreesResult,
          descendantTreesResult,
          loadComputationContextRef.current,
          timeoutSignal
        );
        console.log(`[perf] phase 3 buildCompleteChildToParentsMap: ${(performance.now() - t2).toFixed(0)}ms | entries=${Object.keys(childToParentsMap).length}`);

        // Helper to recursively collect virtual IDs with children
        const collectVirtualWithChildren = (attrs: VirtualAttributeInfo[]): string[] => {
          const ids: string[] = [];
          for (const attr of attrs) {
            if (attr.children && attr.children.length > 0) {
              ids.push(attr.id);
              ids.push(...collectVirtualWithChildren(attr.children));
            }
          }
          return ids;
        };

        const t3 = performance.now();
        // Build virtual property data and collapse those with children
        const virtualPropertyData = buildVirtualAttributeData(
          properties,
          rem._id,
          ancestorTreesResult,
          descendantTreesResult,
          'property',
          childToParentsMap,
          new Set([rem._id])
        );
        loadComputationContextRef.current.virtualDataByKind.property = virtualPropertyData;

        for (const virtualAttrs of Object.values(virtualPropertyData.byOwner)) {
          const virtualIds = collectVirtualWithChildren(virtualAttrs);
          for (const id of virtualIds) {
            collapsed.add(id);
          }
        }

        // Build virtual interface data and collapse those with children
        const virtualInterfaceData = buildVirtualAttributeData(
          interfaces,
          rem._id,
          ancestorTreesResult,
          descendantTreesResult,
          'interface',
          childToParentsMap,
          new Set([rem._id])
        );
        loadComputationContextRef.current.virtualDataByKind.interface = virtualInterfaceData;

        for (const virtualAttrs of Object.values(virtualInterfaceData.byOwner)) {
          const virtualIds = collectVirtualWithChildren(virtualAttrs);
          for (const id of virtualIds) {
            collapsed.add(id);
          }
        }

        // Build virtual directProperty data and collapse those with children
        const virtualDirectPropertyData = buildVirtualAttributeData(
          directProperties,
          rem._id,
          ancestorTreesResult,
          descendantTreesResult,
          'directProperty',
          childToParentsMap,
          new Set([rem._id])
        );
        loadComputationContextRef.current.virtualDataByKind.directProperty = virtualDirectPropertyData;

        for (const virtualAttrs of Object.values(virtualDirectPropertyData.byOwner)) {
          const virtualIds = collectVirtualWithChildren(virtualAttrs);
          for (const id of virtualIds) {
            collapsed.add(id);
          }
        }
        console.log(`[perf] phase 4 buildVirtualAttributeData x3: ${(performance.now() - t3).toFixed(0)}ms`);

        const hidden = new Set<string>();

        setAncestorTrees(ancestorTreesResult);
        setDescendantTrees(descendantTreesResult);
        setDescendantOwnerMap(buildDescendantOwnerMap(descendantTreesResult));
        setCollapsedNodes(collapsed);
        nodePositionsRef.current = new Map<string, { x: number; y: number }>();
        setPropertyData(properties);
        setInterfaceData(interfaces);
        setDirectPropertyData(directProperties);
        setHiddenAttributes(hidden);
        setLoadedRemId(rem._id);
        setLoadedRemName(centerLabel);
        setLoadedRemRichText(rem.text);

        const newParentMap = new Map<string, string>();
        const buildRemParentMap = (forest: HierarchyNode[]) => {
          const stack: { node: HierarchyNode; parent?: string }[] = forest.map((n) => ({ node: n }));
          while (stack.length) {
            const { node, parent } = stack.pop()!;
            if (parent) newParentMap.set(node.id, parent);
            node.children.forEach((child) => stack.push({ node: child, parent: node.id }));
          }
        };
        buildRemParentMap(ancestorTreesResult);
        buildRemParentMap(descendantTreesResult);

        const buildAttrParentMap = (attrs: AttributeNodeInfo[], parentNodeId: string, kind: 'property' | 'interface' | 'directProperty') => {
          attrs.forEach((p) => {
            const attrNodeId = attributeNodeId(kind, p.id);
            newParentMap.set(attrNodeId, parentNodeId);
            buildAttrParentMap(p.children, attrNodeId, kind);
          });
        };
        Object.entries(properties?.byOwner || {}).forEach(([ownerId, attrs]) => {
          buildAttrParentMap(attrs, ownerId, 'property');
        });
        Object.entries(interfaces?.byOwner || {}).forEach(([ownerId, attrs]) => {
          buildAttrParentMap(attrs, ownerId, 'interface');
        });
        Object.entries(directProperties?.byOwner || {}).forEach(([ownerId, attrs]) => {
          buildAttrParentMap(attrs, ownerId, 'directProperty');
        });
        setParentMap(newParentMap);

        // Build graph immediately with local values to avoid stale closure issue
        const primaryData = attributeType === 'property' ? properties : interfaces;
        const secondaryData = attributeType === 'property' ? directProperties : undefined;
        const primaryKind: 'property' | 'interface' | 'directProperty' = attributeType === 'property' ? 'property' : 'interface';
        const secondaryKind: 'property' | 'interface' | 'directProperty' | undefined = attributeType === 'property' ? 'directProperty' : undefined;
        
        const t4 = performance.now();
        const graph = await createGraphData(
          plugin,
          rem._id,
          centerLabel,
          rem.text,
          ancestorTreesResult,
          descendantTreesResult,
          collapsed,
          primaryData ?? undefined,
          hidden,
          new Set<string>(),
          nodePositionsRef.current,
          primaryKind,
          secondaryData ?? undefined,
          secondaryKind,
          loadComputationContextRef.current,
          timeoutSignal
        );
        console.log(`[perf] phase 5 createGraphData: ${(performance.now() - t4).toFixed(0)}ms | nodes=${graph.nodes.length} edges=${graph.edges.length}`);
        const t5 = performance.now();
        const updatedEdges = await addMissingRemEdges(
          plugin,
          graph.nodes,
          graph.edges,
          loadComputationContextRef.current.childToParentsMap,
          loadComputationContextRef.current
        );
        console.log(`[perf] phase 6 addMissingRemEdges: ${(performance.now() - t5).toFixed(0)}ms | edges=${updatedEdges.length}`);
        
        console.log(`[perf] TOTAL loadHierarchy: ${(performance.now() - tLoad).toFixed(0)}ms | rem="${centerLabel}" rems=${remsForAttributes.length}`);

        // Check if timeout occurred and set partial load flag
        if (timeoutSignal.timedOut) {
          setIsPartialLoad(true);
          console.log('[loadHierarchy] Timeout occurred - showing partial results');
        }
        
        setNodes(graph.nodes);
        storePositions(graph.nodes);
        setEdges(updatedEdges);
      } catch (err) {
        console.error(err);
        setError("Failed to build inheritance hierarchy.");
      } finally {
        setLoading(false);
      }
    },
    [plugin, storePositions, attributeType]
  );

  // Load saved state on mount - must be after loadHierarchy is defined
  useEffect(() => {
    let cancelled = false;

    async function restoreState() {
      const savedState = await loadMindMapState(plugin);
      if (cancelled) return;

      if (savedState && savedState.loadedRemId) {
        // Restore user preferences
        setAttributeType(savedState.attributeType || 'property');
        setHistoryStack(savedState.historyStack || []);

        // Verify the rem still exists before trying to load
        const rem = await plugin.rem.findOne(savedState.loadedRemId);
        if (cancelled) return;

        if (rem) {
          // Delegate to loadHierarchy which has timeout support
          await loadHierarchy(rem._id);
        }
      }

      if (!cancelled) {
        setIsInitialized(true);
      }
    }

    restoreState();
    return () => {
      cancelled = true;
    };
  }, [plugin, loadHierarchy]);

  useEffect(() => {
    if (loadedRemId && !loading) {
      updateGraph();
    }
  }, [loadedRemId, ancestorTrees, descendantTrees, propertyData, interfaceData, collapsedNodes, hiddenAttributes, loading, updateGraph]);

  // Subtree-aware drag propagation without double-applying deltas
  const handleNodesChange = useCallback((changes) => {
    setNodes((current) => {
      const updated = applyNodeChanges(changes, current);
      const prevById = new Map(current.map((n) => [n.id, n]));
      const deltas = new Map<string, { dx: number; dy: number }>();

      // Per-node direct deltas from this change
      for (const n of updated) {
        const prev = prevById.get(n.id);
        if (!prev) continue;
        const dx = (n.position?.x ?? 0) - (prev.position?.x ?? 0);
        const dy = (n.position?.y ?? 0) - (prev.position?.y ?? 0);
        if (dx || dy) deltas.set(n.id, { dx, dy });
      }
      if (deltas.size === 0) {
        storePositions(updated);
        return updated;
      }

      // Ancestor-accumulated delta (from nodes that actually moved directly)
      const getAccumulatedDelta = (id: string): { dx: number; dy: number } | null => {
        let cur = id;
        let dx = 0, dy = 0;
        const seen = new Set<string>();
        while (parentMap.has(cur)) {
          cur = parentMap.get(cur)!;
          if (seen.has(cur)) break;
          seen.add(cur);
          const d = deltas.get(cur);
          if (d) { dx += d.dx; dy += d.dy; }
        }
        return (dx || dy) ? { dx, dy } : null;
      };

      // Build children map once
      const childrenMap = new Map<string, string[]>();
      parentMap.forEach((p, c) => {
        const list = childrenMap.get(p) ?? [];
        list.push(c);
        childrenMap.set(p, list);
      });

      // Hidden node store shifting
      const updatedIdSet = new Set(updated.map((n) => n.id));
      const shiftStoredIfHidden = (id: string, delta: { dx: number; dy: number }) => {
        if (updatedIdSet.has(id)) return; // visible => handled via rendering adjustments
        const prev = nodePositionsRef.current.get(id);
        if (prev) {
          nodePositionsRef.current.set(id, { x: prev.x + delta.dx, y: prev.y + delta.dy });
        }
      };

      // Compute "move roots": direct-move nodes with no ancestor that also directly moved
      const movedDirect = [...deltas.keys()];
      const hasMovedAncestor = (id: string) => {
        let cur = id;
        const seen = new Set<string>();
        while (parentMap.has(cur)) {
          cur = parentMap.get(cur)!;
          if (seen.has(cur)) break;
          seen.add(cur);
          if (deltas.has(cur)) return true;
        }
        return false;
      };
      const movedRoots = movedDirect.filter((id) => !hasMovedAncestor(id));

      // Propagate deltas to hidden descendants exactly once
      const shiftedHidden = new Set<string>();
      for (const rootId of movedRoots) {
        const delta = deltas.get(rootId)!;
        const stack = [...(childrenMap.get(rootId) ?? [])];
        while (stack.length) {
          const id = stack.pop()!;
          if (shiftedHidden.has(id)) continue;
          shiftedHidden.add(id);
          shiftStoredIfHidden(id, delta);
          const kids = childrenMap.get(id);
          if (kids?.length) stack.push(...kids);
        }
      }

      // Adjust visible nodes that inherit motion from any directly-moved ancestor
      let mutated = false;
      const adjusted = updated.map((node) => {
        // If this node was directly moved, ReactFlow already applied its delta
        if (deltas.has(node.id)) return node;

        // Sum deltas from moved ancestors (including owning REM for attributes via parentMap)
        const effective = getAccumulatedDelta(node.id);

        // Fallback: if an attribute somehow isn't in parentMap, inherit from its owner
        if (!effective) {
          const data = node.data as GraphNodeData | undefined;
          if (data && (data.kind === 'property' || data.kind === 'interface' || data.kind === 'directProperty')) {
            const attrData = data.kind === 'property' ? propertyData : data.kind === 'interface' ? interfaceData : directPropertyData;
            const ownerId = attrData?.byId?.[data.remId]?.ownerNodeId;
            if (ownerId) {
              const d = deltas.get(ownerId) ?? getAccumulatedDelta(ownerId);
              if (d) {
                mutated = true;
                return {
                  ...node,
                  position: { x: node.position.x + d.dx, y: node.position.y + d.dy },
                };
              }
            }
          }
          return node;
        }

        mutated = true;
        return {
          ...node,
          position: { x: node.position.x + effective.dx, y: node.position.y + effective.dy },
        };
      });

      // Persist final positions
      storePositions(mutated ? adjusted : updated);
      return mutated ? adjusted : updated;
    });
  }, [parentMap, propertyData, interfaceData, directPropertyData, storePositions]);


  const handleLoad = useCallback(async () => {
    // Fetch fresh focused rem to avoid stale closure issues
    const currentFocusedRem = await plugin.focus.getFocusedRem();
    const currentRemId = currentFocusedRem?._id;

    if (!currentRemId) {
      setError("Focus a rem before refreshing.");
      return;
    }

    if (loadedRemId && loadedRemId !== currentRemId) {
      setHistoryStack((prev) => [...prev, loadedRemId]);
    }

    nodePositionsRef.current = new Map();
    loadHierarchy(currentRemId);
  }, [plugin, loadedRemId, loadHierarchy]);



  const handleToggleAttributes = useCallback(async () => {
    if (!loadedRemId) {
      return;
    }
    // When attributeType is 'property', use both propertyData and directPropertyData
    const primaryData = attributeType === 'property' ? propertyData : interfaceData;
    const secondaryData = attributeType === 'property' ? directPropertyData : undefined;
    
    if (!primaryData) {
      return;
    }
    const oldHiddenSize = hiddenAttributes.size;
    const oldHiddenVirtualSize = hiddenVirtualAttributes.size;
    const allHidden = oldHiddenSize > 0 || oldHiddenVirtualSize > 0;
    
    if (!allHidden) {
      // Store offsets for regular attributes before hiding
      nodes.forEach((node) => {
        const data = node.data as GraphNodeData;
        // Check for both 'property' and 'directProperty' kinds when in property mode
        const isRelevantKind = attributeType === 'property' 
          ? (data?.kind === 'property' || data?.kind === 'directProperty')
          : data?.kind === attributeType;
        if (isRelevantKind) {
          const relevantData = data?.kind === 'directProperty' ? secondaryData : primaryData;
          const detail = relevantData?.byId[data.remId];
          if (detail) {
            const ownerNode = nodes.find((n) => n.id === detail.ownerNodeId);
            if (ownerNode) {
              const dx = node.position.x - ownerNode.position.x;
              const dy = node.position.y - ownerNode.position.y;
              hiddenAttributeOffsetsRef.current.set(data.remId, { dx, dy });
            }
          }
        }
      });
    }
    
    // Toggle regular attributes - combine IDs from both data sets when in property mode
    let allAttrIds = Object.keys(primaryData.byId);
    if (secondaryData) {
      allAttrIds = [...allAttrIds, ...Object.keys(secondaryData.byId)];
    }
    const nextHidden = !allHidden ? new Set(allAttrIds) : new Set<string>();
    
    // Toggle virtual attributes - collect all virtual attribute IDs from current nodes
    // For property mode, collect both virtualProperty and virtualDirectProperty
    const virtualKinds: GraphNodeData['kind'][] = attributeType === 'property' 
      ? ['virtualProperty', 'virtualDirectProperty']
      : ['virtualInterface'];
    const allVirtualIds = nodes
      .filter(node => {
        const data = node.data as GraphNodeData;
        return virtualKinds.includes(data.kind);
      })
      .map(node => node.id);
    
    // Also include any already-hidden virtual IDs
    const nextHiddenVirtual = !allHidden 
      ? new Set([...allVirtualIds, ...hiddenVirtualAttributes])
      : new Set<string>();
    
    const primaryKind: 'property' | 'interface' | 'directProperty' = attributeType === 'property' ? 'property' : 'interface';
    const secondaryKind: 'property' | 'interface' | 'directProperty' | undefined = attributeType === 'property' ? 'directProperty' : undefined;
    
    const graph = await createGraphData(
      plugin,
      loadedRemId,
      loadedRemName || "(Untitled Rem)",
      loadedRemRichText,
      ancestorTrees,
      descendantTrees,
      collapsedNodes,
      primaryData,
      nextHidden,
      nextHiddenVirtual,
      nodePositionsRef.current,
      primaryKind,
      secondaryData ?? undefined,
      secondaryKind,
      loadComputationContextRef.current
    );
    let displayNodes = graph.nodes;
    if (allHidden && nextHidden.size === 0) {
      displayNodes = graph.nodes.map((node) => {
        const data = node.data as GraphNodeData;
        // Check for both kinds when in property mode
        const isRelevantKind = attributeType === 'property'
          ? (data.kind === 'property' || data.kind === 'directProperty')
          : data.kind === attributeType;
        if (!isRelevantKind) {
          return node;
        }
        const relevantData = data.kind === 'directProperty' ? secondaryData : primaryData;
        const detail = relevantData?.byId[data.remId];
        if (!detail) {
          return node;
        }
        const ownerNode = graph.nodes.find((n) => n.id === detail.ownerNodeId);
        if (!ownerNode) {
          return node;
        }
        const storedOffset = hiddenAttributeOffsetsRef.current.get(data.remId);
        if (storedOffset) {
          const newPos = {
            x: ownerNode.position.x + storedOffset.dx,
            y: ownerNode.position.y + storedOffset.dy,
          };
          return {
            ...node,
            position: newPos,
          };
        }
        return node;
      });
    }
    const updatedEdges = await addMissingRemEdges(
      plugin,
      displayNodes,
      graph.edges,
      loadComputationContextRef.current.childToParentsMap,
      loadComputationContextRef.current
    );
    setHiddenAttributes(nextHidden);
    setHiddenVirtualAttributes(nextHiddenVirtual);
    setNodes(displayNodes);
    storePositions(displayNodes);
    setEdges(updatedEdges);
  }, [
    attributeType,
    propertyData,
    interfaceData,
    directPropertyData,
    hiddenAttributes,
    hiddenVirtualAttributes,
    loadedRemId,
    loadedRemName,
    ancestorTrees,
    descendantTrees,
    collapsedNodes,
    nodes,
    plugin,
    storePositions
  ]);

  const handleSwitchAttributes = useCallback(async (newType: 'property' | 'interface') => {
    if (!loadedRemId) {
      return;
    }
    if (newType === attributeType) {
      return; // No change needed
    }
    const oldType = attributeType;
    // Get old data (both primary and secondary when in property mode)
    const oldPrimaryData = oldType === 'property' ? propertyData : interfaceData;
    const oldSecondaryData = oldType === 'property' ? directPropertyData : undefined;
    
    if (hiddenAttributes.size === 0 && oldPrimaryData) {
      nodes.forEach((node) => {
        const data = node.data as GraphNodeData;
        // Check for both kinds when in property mode
        const isRelevantKind = oldType === 'property'
          ? (data?.kind === 'property' || data?.kind === 'directProperty')
          : data?.kind === oldType;
        if (isRelevantKind) {
          const relevantData = data?.kind === 'directProperty' ? oldSecondaryData : oldPrimaryData;
          const detail = relevantData?.byId[data.remId];
          if (detail) {
            const ownerNode = nodes.find((n) => n.id === detail.ownerNodeId);
            if (ownerNode) {
              const dx = node.position.x - ownerNode.position.x;
              const dy = node.position.y - ownerNode.position.y;
              hiddenAttributeOffsetsRef.current.set(data.remId, { dx, dy });
            }
          }
        }
      });
    }
    setAttributeType(newType);
    const nextHidden = new Set<string>();
    const nextHiddenVirtual = new Set<string>();
    setHiddenAttributes(nextHidden);
    setHiddenVirtualAttributes(nextHiddenVirtual);
    
    // Get new data
    const newPrimaryData = newType === 'property' ? propertyData : interfaceData;
    const newSecondaryData = newType === 'property' ? directPropertyData : undefined;
    const primaryKind: 'property' | 'interface' | 'directProperty' = newType === 'property' ? 'property' : 'interface';
    const secondaryKind: 'property' | 'interface' | 'directProperty' | undefined = newType === 'property' ? 'directProperty' : undefined;
    
    if (!newPrimaryData) return;
    const graph = await createGraphData(
      plugin,
      loadedRemId,
      loadedRemName || "(Untitled Rem)",
      loadedRemRichText,
      ancestorTrees,
      descendantTrees,
      collapsedNodes,
      newPrimaryData,
      nextHidden,
      nextHiddenVirtual,
      nodePositionsRef.current,
      primaryKind,
      newSecondaryData ?? undefined,
      secondaryKind,
      loadComputationContextRef.current
    );
    const displayNodes = graph.nodes.map((node) => {
      const data = node.data as GraphNodeData;
      // Check for both kinds when in property mode
      const isRelevantKind = newType === 'property'
        ? (data.kind === 'property' || data.kind === 'directProperty')
        : data.kind === newType;
      if (!isRelevantKind) {
        return node;
      }
      const relevantData = data.kind === 'directProperty' ? newSecondaryData : newPrimaryData;
      const detail = relevantData?.byId[data.remId];
      if (!detail) {
        return node;
      }
      const ownerNode = graph.nodes.find((n) => n.id === detail.ownerNodeId);
      if (!ownerNode) {
        return node;
      }
      const storedOffset = hiddenAttributeOffsetsRef.current.get(data.remId);
      if (storedOffset) {
        const newPos = {
          x: ownerNode.position.x + storedOffset.dx,
          y: ownerNode.position.y + storedOffset.dy,
        };
        return {
          ...node,
          position: newPos,
        };
      }
      return node;
    });
    const updatedEdges = await addMissingRemEdges(
      plugin,
      displayNodes,
      graph.edges,
      loadComputationContextRef.current.childToParentsMap,
      loadComputationContextRef.current
    );
    setNodes(displayNodes);
    storePositions(displayNodes);
    setEdges(updatedEdges);
  }, [
    attributeType,
    propertyData,
    interfaceData,
    directPropertyData,
    hiddenAttributes,
    loadedRemId,
    loadedRemName,
    ancestorTrees,
    descendantTrees,
    collapsedNodes,
    nodes,
    plugin,
    storePositions
  ]);

  const handleToggleCollapseAll = useCallback(async () => {
    if (!loadedRemId) return;

    // Only collect IDs of REM nodes that have children
    const collectIdsWithChildren = (trees: HierarchyNode[]): string[] => {
      const ids: string[] = [];
      for (const node of trees) {
        // Only add this node if it has children
        if (node.children && node.children.length > 0) {
          ids.push(node.id);
        }
        // Recursively check children
        ids.push(...collectIdsWithChildren(node.children));
      }
      return ids;
    };

    // When in property mode, consider both propertyData and directPropertyData for collapsing
    const primaryData = attributeType === 'property' ? propertyData : interfaceData;
    const secondaryData = attributeType === 'property' ? directPropertyData : undefined;

    if (collapsedNodes.size > 0) {
      // Expand all: clear collapsed nodes
      setCollapsedNodes(new Set<string>());
    } else {
      // Collapse all: add only REM nodes that have children, and attribute nodes with children
      const allIds = new Set<string>([
        ...collectIdsWithChildren(ancestorTrees),
        ...collectIdsWithChildren(descendantTrees),
      ]);
      if (primaryData) {
        for (const detail of Object.values(primaryData.byId)) {
          if (detail.hasChildren) {
            allIds.add(detail.id);
          }
        }
      }
      if (secondaryData) {
        for (const detail of Object.values(secondaryData.byId)) {
          if (detail.hasChildren) {
            allIds.add(detail.id);
          }
        }
      }
      setCollapsedNodes(allIds);
    }
    // Note: updateGraph() is called automatically by the useEffect that depends on collapsedNodes
  }, [
    ancestorTrees,
    descendantTrees,
    collapsedNodes,
    loadedRemId,
    propertyData,
    interfaceData,
    attributeType,
  ]);

  const handleNodeClick = useCallback(
    (event: React.MouseEvent, node: GraphNode) => {
      event.preventDefault();
      event.stopPropagation();
      if (!loadedRemId) return;

      const data = (node.data ?? undefined) as GraphNodeData | undefined;
      const targetId = data?.remId ?? node.id;

      // Center node: toggle collapse to hide/show all ancestors and descendants
      if (targetId === loadedRemId) {
        const hasHierarchy = ancestorTrees.length > 0 || descendantTrees.length > 0;
        if (!hasHierarchy) return;
        const next = new Set(collapsedNodes);
        next.has(loadedRemId) ? next.delete(loadedRemId) : next.add(loadedRemId);
        setCollapsedNodes(next);
        return;
      }

      // Helpers
      const collectIds = (trees: HierarchyNode[]) => {
        const ids: string[] = [];
        const stack = [...trees];
        while (stack.length) {
          const n = stack.pop()!;
          ids.push(n.id);
          if (n.children?.length) stack.push(...n.children);
        }
        return ids;
      };
      const collectSubtreeIds = (root: HierarchyNode) => {
        const ids: string[] = [];
        const stack = [root];
        while (stack.length) {
          const n = stack.pop()!;
          ids.push(n.id);
          if (n.children?.length) stack.push(...n.children);
        }
        return ids;
      };

      // REM nodes: default = per-node toggle; Shift = rest-of-side
      if (!data || data.kind === "rem") {
        // Center node special-case unchanged
        if (targetId === loadedRemId) {
          // const collectImmediateChildren = (trees: HierarchyNode[]): string[] => {
          //   const ids: string[] = [];
          //   for (const tree of trees) {
          //     ids.push(tree.id);
          //     ids.push(...tree.children.map((c) => c.id));
          //   }
          //   return ids;
          // };
          // const immediateDescendantIds = collectImmediateChildren(descendantTrees);
          // setCollapsedNodes(new Set(immediateDescendantIds));
          return;
        }

        // Default: per-node toggle
        const t = findNodeById(ancestorTrees, targetId) ?? findNodeById(descendantTrees, targetId);
        const hasChildren = !!t?.children?.length;
        if (!hasChildren) return;
        const next = new Set(collapsedNodes);
        next.has(targetId) ? next.delete(targetId) : next.add(targetId);
        setCollapsedNodes(next);
        return;
      }

      // Attribute nodes: keep simple per-node toggle
      let hasChildren = false;
      if (data?.kind === "property" || data?.kind === "interface" || data?.kind === "directProperty") {
        const currentData = data.kind === "property" ? propertyData : data.kind === "interface" ? interfaceData : directPropertyData;
        const detail = currentData?.byId[targetId];
        hasChildren = !!detail?.hasChildren;
      } else if (data?.kind === "virtualInterfaceGroup") {
        // Group header nodes are always collapsible (they always have children)
        const groupNodeId = data.remId;
        const next = new Set(collapsedNodes);
        next.has(groupNodeId) ? next.delete(groupNodeId) : next.add(groupNodeId);
        setCollapsedNodes(next);
        return;
      } else if (data?.kind === "virtualProperty" || data?.kind === "virtualInterface" || data?.kind === "virtualDirectProperty") {
        // For virtual attributes, check if the source property has children
        const currentData = data.kind === "virtualProperty" ? propertyData : data.kind === "virtualInterface" ? interfaceData : directPropertyData;
        if (data.sourcePropertyId && currentData?.byId[data.sourcePropertyId]) {
          hasChildren = !!currentData.byId[data.sourcePropertyId].hasChildren;
        }
        // Toggle collapsed state using the virtual attribute's own ID (info.id format)
        if (!hasChildren) return;
        const virtualNodeId = data.remId; // This is the virtual:ownerRemId:sourcePropertyId format
        const next = new Set(collapsedNodes);
        next.has(virtualNodeId) ? next.delete(virtualNodeId) : next.add(virtualNodeId);
        setCollapsedNodes(next);
        return;
      } else {
        const t = findNodeById(ancestorTrees, targetId) ?? findNodeById(descendantTrees, targetId);
        hasChildren = !!t?.children?.length;
      }
      if (!hasChildren) return;

      const next = new Set(collapsedNodes);
      next.has(targetId) ? next.delete(targetId) : next.add(targetId);
      setCollapsedNodes(next);
    },
    [loadedRemId, ancestorTrees, descendantTrees, collapsedNodes, propertyData, interfaceData]
  );

  const handleContextMenuClose = useCallback(() => {
    setContextMenu(null);
    setVirtualContextMenu(null);
    setPaneContextMenu(null);
  }, []);

  const handleOpenContextRem = useCallback(async () => {
    if (!contextMenu?.remId) return;
    const rem = (await plugin.rem.findOne(contextMenu.remId)) as PluginRem | null;
    if (rem) {
      void plugin.window.openRem(rem);
    }
    handleContextMenuClose();
  }, [contextMenu, plugin, handleContextMenuClose]);

  const handleCopyContextRem = useCallback(async () => {
    if (!contextMenu?.remId) return;
    const rem = (await plugin.rem.findOne(contextMenu.remId)) as PluginRem | null;
    if (rem) {
      await rem.copyReferenceToClipboard();
    }
    handleContextMenuClose();
  }, [contextMenu, plugin, handleContextMenuClose]);

  const handleCopyDebugInfo = useCallback(async () => {
    if (!contextMenu?.remId) return;
    const rem = (await plugin.rem.findOne(contextMenu.remId)) as PluginRem | null;
    if (!rem) {
      handleContextMenuClose();
      return;
    }
    
    try {
      // Gather all Rem information (similar to remInfo_widget)
      const remName = await getRemText(plugin, rem);
      const remType = await rem.getType();
      
      // Fetch data with individual error handling
      let parentClass: PluginRem[] = [];
      let lineage: string[] = [];
      let properties: PluginRem[] = [];
      let descriptors: PluginRem[] = [];
      let tags: PluginRem[] = [];
      let taggedRems: PluginRem[] = [];
      let ancestorTags: PluginRem[] = [];
      let descendantTags: PluginRem[] = [];
      let referencingRems: PluginRem[] = [];
      let referencedRems: PluginRem[] = [];
      let deepReferencedRems: PluginRem[] = [];

      try { parentClass = await getParentClass(plugin, rem) || []; } catch {}
      try { lineage = await getAncestorLineageStrings(plugin, rem) || []; } catch {}
      try { properties = await getClassProperties(plugin, rem) || []; } catch {}
      try { descriptors = await getClassDescriptors(plugin, rem) || []; } catch {}
      try { tags = await rem.getTagRems() || []; } catch {}
      try { taggedRems = await rem.taggedRem() || []; } catch {}
      try { ancestorTags = await rem.ancestorTagRem() || []; } catch {}
      try { descendantTags = await rem.descendantTagRem() || []; } catch {}
      try { referencingRems = await rem.remsReferencingThis() || []; } catch {}
      try { referencedRems = await rem.remsBeingReferenced() || []; } catch {}
      try { deepReferencedRems = await rem.deepRemsBeingReferenced() || []; } catch {}

      // Helper to format Rem array as text list
      const formatRemList = async (rems: PluginRem[] | null): Promise<string> => {
        if (!rems || rems.length === 0) return "(none)";
        const names = await Promise.all(rems.map(async r => {
          try { return await getRemText(plugin, r); } catch { return r._id; }
        }));
        return names.join(", ");
      };

      // Build debug text
      const debugLines: string[] = [
        "=== Rem Debug Info ===",
        `ID: ${rem._id}`,
        `Name: ${remName}`,
        `Type: ${remType}`,
        "",
        `Parent Types: ${await formatRemList(parentClass)}`,
        `Ancestor Lineage: ${lineage.length > 0 ? lineage.join(" | ") : "(none)"}`,
        `Properties: ${await formatRemList(properties)}`,
        `Descriptors: ${await formatRemList(descriptors)}`,
        `Tags: ${await formatRemList(tags)}`,
        `Tagged Rems: ${await formatRemList(taggedRems)}`,
        `Ancestor Tags: ${await formatRemList(ancestorTags)}`,
        `Descendant Tags: ${await formatRemList(descendantTags)}`,
        `Rems Referencing This: ${await formatRemList(referencingRems)}`,
        `Rems Being Referenced: ${await formatRemList(referencedRems)}`,
        `Deep Rems Being Referenced: ${await formatRemList(deepReferencedRems)}`
      ];

      const debugText = debugLines.join("\n");

      // Copy to clipboard using fallback method (more reliable in iframe contexts)
      const textArea = document.createElement('textarea');
      textArea.value = debugText;
      textArea.style.position = 'fixed';
      textArea.style.left = '-9999px';
      textArea.style.top = '0';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      
      const success = document.execCommand('copy');
      document.body.removeChild(textArea);
      
      if (success) {
        await plugin.app.toast("Debug info copied to clipboard!");
      } else {
        // Try navigator.clipboard as fallback
        try {
          await navigator.clipboard.writeText(debugText);
          await plugin.app.toast("Debug info copied to clipboard!");
        } catch {
          console.log("Debug info (copy failed):", debugText);
          await plugin.app.toast("Copy failed - check console for debug info");
        }
      }
    } catch (error) {
      console.error("Error copying debug info:", error);
      await plugin.app.toast("Failed to copy debug info: " + String(error));
    }
    
    handleContextMenuClose();
  }, [contextMenu, plugin, handleContextMenuClose]);

  const handleEditVirtualRem = useCallback(async () => {
    if (!virtualContextMenu?.sourcePropertyId) return;
    const rem = (await plugin.rem.findOne(virtualContextMenu.sourcePropertyId)) as PluginRem | null;
    if (rem) {
      void plugin.window.openRem(rem);
    }
    handleContextMenuClose();
  }, [virtualContextMenu, plugin, handleContextMenuClose]);

  const handleImplementVirtualProperty = useCallback(async () => {
    if (!virtualContextMenu) return;
    
    try {
      // Determine if this is a property or interface based on the clicked node
      const clickedNode = nodes.find(n => n.id === virtualContextMenu.nodeId);
      const nodeData = clickedNode?.data as GraphNodeData | undefined;
      const isProperty = nodeData?.kind === 'virtualProperty';
      
      // Get the owner REM and source property/interface
      const ownerRem = await plugin.rem.findOne(virtualContextMenu.ownerRemId);
      const sourceProperty = await plugin.rem.findOne(virtualContextMenu.sourcePropertyId);
      
      if (!ownerRem || !sourceProperty) {
        setError("Could not find required REMs");
        handleContextMenuClose();
        return;
      }
      
      if (isProperty) {
        // For virtual properties: Create new child REM with same name and extends relationship
        const newRem = await plugin.rem.createRem();
        if (!newRem) {
          setError("Failed to create new REM");
          handleContextMenuClose();
          return;
        }
        
        // Set the text to match the source property
        const sourceText = sourceProperty.text;
        if (sourceText) {
          await newRem.setText(sourceText);
        }
        
        // Set parent to owner REM
        await newRem.setParent(ownerRem);
        
        // Make it a document for properties
        await newRem.setIsDocument(true);
        
        // Create extends relationship to source property
        // This requires creating an "extends" descriptor child
        const extendsDesc = await plugin.rem.createRem();
        if (extendsDesc) {
          await extendsDesc.setText(["extends"]);
          await extendsDesc.setParent(newRem);
          await extendsDesc.setType(SetRemType.DESCRIPTOR);
          
          // Add reference to source property
          const refChild = await plugin.rem.createRem();
          if (refChild) {
            await refChild.setText([{ i: "q", _id: sourceProperty._id }]);
            await refChild.setParent(extendsDesc);
          }
        }
        
        // Update descendant properties that extend the same source property
        // to now extend this newly created property instead.
        const updatedCount = await updateDescendantPropertyReferences(plugin, newRem, ownerRem, sourceProperty);
        
        // Show toast message if any descendant properties were updated
        if (updatedCount > 0) {
          await plugin.app.toast(
            `Updated ${updatedCount} descendant ${updatedCount === 1 ? 'property' : 'properties'} to extend the new property.`
          );
        }
      } else {
        // For virtual interfaces: Create new child REM with same name and extends relationship
        // (similar to virtual properties implementation)
        const newRem = await plugin.rem.createRem();
        if (!newRem) {
          setError("Failed to create new REM");
          handleContextMenuClose();
          return;
        }
        
        // Set the text to match the source interface
        const sourceText = sourceProperty.text;
        if (sourceText) {
          await newRem.setText(sourceText);
        }
        
        // Set parent to owner REM
        await newRem.setParent(ownerRem);
        
        // If this is a direct property (descriptor), set the new rem as a descriptor
        if (nodeData?.isDescriptorProperty) {
          await newRem.setType(SetRemType.DESCRIPTOR);
        }
        
        // Create extends relationship to source interface
        // This requires creating an "extends" descriptor child
        const extendsDesc = await plugin.rem.createRem();
        if (extendsDesc) {
          await extendsDesc.setText(["extends"]);
          await extendsDesc.setParent(newRem);
          await extendsDesc.setType(SetRemType.DESCRIPTOR);
          
          // Add reference to source interface
          const refChild = await plugin.rem.createRem();
          if (refChild) {
            await refChild.setText([{ i: "q", _id: sourceProperty._id }]);
            await refChild.setParent(extendsDesc);
          }
        }
        
        // If source interface is exported, also export the new implementation
        // This ensures the inheritance chain properly propagates export requirements
        //const sourceIsExported = await hasTag(plugin, sourceProperty, "Export");
        //if (sourceIsExported) {
        //  const exportTag = await getTag(plugin, sourceProperty, "Export");
        //  if (exportTag) {
        //    await newRem.addTag(exportTag);
        //  }
        //}
        
        // Update descendant interfaces that extend the same source interface
        // to now extend this newly created interface instead.
        const updatedCount = await updateDescendantInterfaceReferences(plugin, newRem, ownerRem, sourceProperty);
        
        // Show toast message if any descendant interfaces were updated
        if (updatedCount > 0) {
          await plugin.app.toast(
            `Updated ${updatedCount} descendant ${updatedCount === 1 ? 'interface' : 'interfaces'} to extend the new interface.`
          );
        }
      }
      
      // Reload the hierarchy to reflect changes
      if (loadedRemId) {
        await loadHierarchy(loadedRemId);
      }
    } catch (err) {
      console.error("Failed to implement:", err);
      setError("Failed to implement");
    }
    
    handleContextMenuClose();
  }, [virtualContextMenu, plugin, loadHierarchy, loadedRemId, handleContextMenuClose, nodes]);

  const collectAttributeIds = useCallback((attrs: AttributeNodeInfo[]): string[] => {
    const ids: string[] = [];
    for (const attr of attrs) {
      ids.push(attr.id);
      ids.push(...collectAttributeIds(attr.children));
    }
    return ids;
  }, []);

  // Collect virtual attribute IDs for a given REM from the current nodes (for hiding)
  const collectVirtualAttributeIdsFromNodes = useCallback((remId: string): string[] => {
    return nodes
      .filter(node => {
        const data = node.data as GraphNodeData;
        return (data.kind === 'virtualProperty' || data.kind === 'virtualInterface') && data.ownerRemId === remId;
      })
      .map(node => node.id);
  }, [nodes]);

  // Collect hidden virtual attribute IDs for a given REM from hiddenVirtualAttributes set (for showing)
  const collectHiddenVirtualAttributeIds = useCallback((remId: string): string[] => {
    const prefix = `virtual:${remId}:`;
    return [...hiddenVirtualAttributes].filter(id => id.startsWith(prefix));
  }, [hiddenVirtualAttributes]);

  const handleHideProperties = useCallback(async () => {
    if (!contextMenu?.remId || !propertyData) return;
    const attrs = propertyData.byOwner[contextMenu.remId];
    const idsToToggle = attrs ? collectAttributeIds(attrs) : [];
    
    // Collect virtual property IDs - from nodes if visible, from hiddenVirtualAttributes if hidden
    const visibleVirtualIds = collectVirtualAttributeIdsFromNodes(contextMenu.remId);
    const hiddenVirtualIds = collectHiddenVirtualAttributeIds(contextMenu.remId);
    const allVirtualIds = [...new Set([...visibleVirtualIds, ...hiddenVirtualIds])];
    
    const allRegularHidden = idsToToggle.length === 0 || idsToToggle.every(id => hiddenAttributes.has(id));
    const allVirtualHidden = allVirtualIds.length === 0 || allVirtualIds.every(id => hiddenVirtualAttributes.has(id));
    const allHidden = allRegularHidden && allVirtualHidden;
    
    const nextHidden: Set<string> = new Set(hiddenAttributes);
    const nextHiddenVirtual: Set<string> = new Set(hiddenVirtualAttributes);
    
    if (allHidden) {
      // Show them: remove from hidden
      idsToToggle.forEach(id => nextHidden.delete(id));
      allVirtualIds.forEach(id => nextHiddenVirtual.delete(id));
    } else {
      // Hide them: add to hidden
      idsToToggle.forEach(id => nextHidden.add(id));
      allVirtualIds.forEach(id => nextHiddenVirtual.add(id));
    }
    const graph = await createGraphData(
      plugin,
      loadedRemId,
      loadedRemName || "(Untitled Rem)",
      loadedRemRichText,
      ancestorTrees,
      descendantTrees,
      collapsedNodes,
      propertyData,
      nextHidden,
      nextHiddenVirtual,
      nodePositionsRef.current,
      'property',
      undefined,
      undefined,
      loadComputationContextRef.current
    );
    const updatedEdges = await addMissingRemEdges(
      plugin,
      graph.nodes,
      graph.edges,
      loadComputationContextRef.current.childToParentsMap,
      loadComputationContextRef.current
    );
    setHiddenAttributes(nextHidden);
    setHiddenVirtualAttributes(nextHiddenVirtual);
    setNodes(graph.nodes);
    storePositions(graph.nodes);
    setEdges(updatedEdges);
    handleContextMenuClose();
  }, [
    contextMenu,
    propertyData,
    hiddenAttributes,
    hiddenVirtualAttributes,
    loadedRemId,
    loadedRemName,
    ancestorTrees,
    descendantTrees,
    collapsedNodes,
    plugin,
    storePositions,
    collectAttributeIds,
    collectVirtualAttributeIdsFromNodes,
    collectHiddenVirtualAttributeIds,
    handleContextMenuClose
  ]);

  const handleHideVirtualProperties = useCallback(async () => {
    if (!contextMenu?.remId || !propertyData) return;
    
    // Collect virtual property IDs - from nodes if visible, from hiddenVirtualAttributes if hidden
    const visibleVirtualIds = collectVirtualAttributeIdsFromNodes(contextMenu.remId);
    const hiddenVirtualIds = collectHiddenVirtualAttributeIds(contextMenu.remId);
    const allVirtualIds = [...new Set([...visibleVirtualIds, ...hiddenVirtualIds])];
    
    if (allVirtualIds.length === 0) {
      handleContextMenuClose();
      return;
    }
    
    const allHidden = allVirtualIds.every(id => hiddenVirtualAttributes.has(id));
    const nextHiddenVirtual: Set<string> = new Set(hiddenVirtualAttributes);
    
    if (allHidden) {
      // Show them: remove from hidden
      allVirtualIds.forEach(id => nextHiddenVirtual.delete(id));
    } else {
      // Hide them: add to hidden
      allVirtualIds.forEach(id => nextHiddenVirtual.add(id));
    }
    const graph = await createGraphData(
      plugin,
      loadedRemId,
      loadedRemName || "(Untitled Rem)",
      loadedRemRichText,
      ancestorTrees,
      descendantTrees,
      collapsedNodes,
      propertyData,
      hiddenAttributes,
      nextHiddenVirtual,
      nodePositionsRef.current,
      'property',
      undefined,
      undefined,
      loadComputationContextRef.current
    );
    const updatedEdges = await addMissingRemEdges(
      plugin,
      graph.nodes,
      graph.edges,
      loadComputationContextRef.current.childToParentsMap,
      loadComputationContextRef.current
    );
    setHiddenVirtualAttributes(nextHiddenVirtual);
    setNodes(graph.nodes);
    storePositions(graph.nodes);
    setEdges(updatedEdges);
    handleContextMenuClose();
  }, [
    contextMenu,
    propertyData,
    hiddenAttributes,
    hiddenVirtualAttributes,
    loadedRemId,
    loadedRemName,
    ancestorTrees,
    descendantTrees,
    collapsedNodes,
    plugin,
    storePositions,
    collectVirtualAttributeIdsFromNodes,
    collectHiddenVirtualAttributeIds,
    handleContextMenuClose
  ]);

  const handleGotoContextRem = useCallback(() => {
    if (!contextMenu?.remId) return;

    if (loadedRemId && loadedRemId !== contextMenu.remId) {
      setHistoryStack((prev) => [...prev, loadedRemId]);
    }
    nodePositionsRef.current = new Map();
    loadHierarchy(contextMenu.remId);
    handleContextMenuClose();
  }, [contextMenu, loadHierarchy, handleContextMenuClose]);

  const handleRefresh = useCallback(async () => {
    if (loadedRemId) {
      nodePositionsRef.current = new Map();
      await updateGraph();
      reactFlowInstance?.fitView({ padding: 0.1, duration: 300 });
    }
  }, [loadedRemId, updateGraph, reactFlowInstance]);

  const handleGoBack = useCallback(() => {
    if (historyStack.length === 0) return;
    const previousId = historyStack[historyStack.length - 1];
    setHistoryStack((prev) => prev.slice(0, -1));
    nodePositionsRef.current = new Map();
    loadHierarchy(previousId);
    handleContextMenuClose();
  }, [historyStack, loadHierarchy, handleContextMenuClose]);

  const handleNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: GraphNode) => {
      event.preventDefault();
      event.stopPropagation();
      const nodeData = (node.data ?? undefined) as GraphNodeData | undefined;
      if (!nodeData) return;

      const label = (nodeData.label ?? "").trim();

      // Check if this is a virtual property/interface node
      if ((nodeData.kind === 'virtualProperty' || nodeData.kind === 'virtualInterface' || nodeData.kind === 'virtualDirectProperty') && nodeData.sourcePropertyId && nodeData.ownerRemId) {
        setVirtualContextMenu({
          x: event.clientX,
          y: event.clientY,
          nodeId: node.id,
          label: label.length > 0 ? label : '(Untitled)',
          sourcePropertyId: nodeData.sourcePropertyId,
          ownerRemId: nodeData.ownerRemId,
        });
        return;
      }

      // Regular node context menu
      const remId = nodeData.remId ?? node.id;
      if (!remId) return;

      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        remId,
        label: label.length > 0 ? label : '(Untitled Rem)'
      });
    },
    []
  );

  // Helper to escape XML special characters
  const escapeXml = useCallback((str: string): string => {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }, []);

  // Helper to sanitize a string into a valid XML tag name
  // Rules: must start with letter or underscore, can contain letters, digits, hyphens, underscores, periods
  const sanitizeXmlTagName = useCallback((str: string): string => {
    if (!str || str.trim().length === 0) return '_unnamed';
    // Replace invalid characters with underscores
    let sanitized = str
      .replace(/[^a-zA-Z0-9_\-\.]/g, '_')  // Replace invalid chars with underscore
      .replace(/^[^a-zA-Z_]/, '_');         // Ensure starts with letter or underscore
    // Remove consecutive underscores
    sanitized = sanitized.replace(/_+/g, '_');
    // Remove trailing underscores
    sanitized = sanitized.replace(/_+$/, '');
    return sanitized || '_unnamed';
  }, []);

  // Build export metadata for all descendants (async pre-fetch)
  const buildExportMetadata = useCallback(async (
    descendants: HierarchyNode[]
  ): Promise<Map<string, ExportMetadata>> => {
    const metadata = new Map<string, ExportMetadata>();
    
    // Collect all nodes from descendants tree
    const allNodes: HierarchyNode[] = [];
    const stack = [...descendants];
    while (stack.length > 0) {
      const node = stack.pop()!;
      allNodes.push(node);
      if (node.children?.length) {
        stack.push(...node.children);
      }
    }
    
    // Fetch metadata for each node in parallel
    await Promise.all(allNodes.map(async (node) => {
      const rem = node.remRef;
      if (!rem) return;
      
      const [remType, isDocument] = await Promise.all([
        rem.getType(),
        rem.isDocument()
      ]);
      
      // isProperty: true if descriptor or document
      const isProperty = remType === RemType.DESCRIPTOR || isDocument;
      
      // isExported: documents and descriptors are always exported; others need Export tag
      const isDescriptorProperty = remType === RemType.DESCRIPTOR ? await isPropertyDescriptor(plugin, rem) : false;
      const isExported = isDocument || isDescriptorProperty || await hasTag(plugin, rem, "Export");
      
      // Get extends parents and resolve their names
      const extendsParents = await getExtendsParents(plugin, rem);
      const extendsNames: string[] = [];
      for (const parent of extendsParents) {
        const parentName = await getRemText(plugin, parent);
        if (parentName) {
          extendsNames.push(parentName);
        }
      }
      
      metadata.set(node.id, {
        isProperty,
        isExported,
        extendsNames
      });
    }));
    
    return metadata;
  }, [plugin]);

  // Convert the tree structure to XML format (descendants only, with new schema)
  const treeToXml = useCallback((exportMetadata: Map<string, ExportMetadata>): string => {
    if (!loadedRemId || !loadedRemName) return '';
    if (descendantTrees.length === 0) return '';

    // Helper to convert HierarchyNode to XML with new schema
    // Uses rem name as XML tag, adds extends/export/property attributes
    const hierarchyNodeToXml = (node: HierarchyNode, indent: string): string => {
      const tagName = sanitizeXmlTagName(node.name);
      const meta = exportMetadata.get(node.id);
      
      // Build attributes
      const extendsAttr = meta?.extendsNames.join(',') || '';
      const exportAttr = meta?.isExported ? 'true' : 'false';
      const propertyAttr = meta?.isProperty ? 'true' : 'false';
      
      const hasChildren = node.children.length > 0;
      
      if (!hasChildren) {
        return `${indent}<${tagName} extends="${escapeXml(extendsAttr)}" export="${exportAttr}" property="${propertyAttr}" />\n`;
      }

      let xml = `${indent}<${tagName} extends="${escapeXml(extendsAttr)}" export="${exportAttr}" property="${propertyAttr}">\n`;

      // Add children recursively
      for (const child of node.children) {
        xml += hierarchyNodeToXml(child, indent + '  ');
      }

      xml += `${indent}</${tagName}>\n`;
      return xml;
    };

    // Build the XML structure - descendants only
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<descendants>\n';

    for (const descendant of descendantTrees) {
      xml += hierarchyNodeToXml(descendant, '  ');
    }

    xml += '</descendants>';
    return xml;
  }, [loadedRemId, loadedRemName, descendantTrees, escapeXml, sanitizeXmlTagName]);

  // Handle export to XML
  const handleExportToXml = useCallback(async () => {
    if (descendantTrees.length === 0) {
      setError("No descendants to export");
      setPaneContextMenu(null);
      return;
    }

    // Pre-fetch export metadata for all descendants
    const exportMetadata = await buildExportMetadata(descendantTrees);
    
    const xml = treeToXml(exportMetadata);
    if (!xml) {
      setError("No data to export");
      setPaneContextMenu(null);
      return;
    }

    try {
      // Try using the Clipboard API first
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(xml);
      } else {
        // Fallback: create a temporary textarea element
        const textArea = document.createElement('textarea');
        textArea.value = xml;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        textArea.style.top = '-9999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      await plugin.app.toast("XML copied to clipboard!");
    } catch (err) {
      console.error("Failed to copy to clipboard:", err);
      // Try the fallback method even if the first attempt failed
      try {
        const textArea = document.createElement('textarea');
        textArea.value = xml;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        textArea.style.top = '-9999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        const success = document.execCommand('copy');
        document.body.removeChild(textArea);
        if (success) {
          await plugin.app.toast("XML copied to clipboard!");
        } else {
          setError("Failed to copy to clipboard");
        }
      } catch (fallbackErr) {
        console.error("Fallback copy also failed:", fallbackErr);
        setError("Failed to copy to clipboard");
      }
    }

    setPaneContextMenu(null);
  }, [descendantTrees, buildExportMetadata, treeToXml, plugin]);

  // Handle pane (empty space) right-click
  const handlePaneContextMenu = useCallback((event: React.MouseEvent | MouseEvent) => {
    event.preventDefault();
    setPaneContextMenu({
      x: 'clientX' in event ? event.clientX : 0,
      y: 'clientY' in event ? event.clientY : 0,
    });
  }, []);

  const showPlaceholder = nodes.length === 0;

  return (
    <div style={{ padding: 12, fontFamily: "Inter, sans-serif", fontSize: 14, height: "100%" }}>
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
          onClick={handleLoad}
          disabled={!focusedRemId || loading}
        >
          {loading ? "Refreshing..." : "Load Current Rem"}
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
          onClick={handleToggleCollapseAll}
          disabled={!loadedRemId}
        >
          {collapsedNodes.size > 0 ? 'Expand All' : 'Collapse All'}
        </button>
        <button
          style={{
            padding: '6px 12px',
            background: '#1f2937',
            color: '#ffffff',
            border: 'none',
            borderRadius: 4,
            cursor: !loadedRemId || (!propertyData && !interfaceData && !directPropertyData) ? 'not-allowed' : 'pointer',
            fontWeight: 600,
          }}
          onClick={handleToggleAttributes}
          disabled={!loadedRemId || (!propertyData && !interfaceData && !directPropertyData)}
        >
          Toggle {attributeType === 'property' ? 'Properties' : 'Interfaces'}
        </button>
        <select
          style={{
            padding: '6px 12px',
            background: '#1f2937',
            color: '#ffffff',
            border: 'none',
            borderRadius: 4,
            cursor: !loadedRemId || (!propertyData && !interfaceData && !directPropertyData) ? 'not-allowed' : 'pointer',
            fontWeight: 600,
          }}
          value={attributeType}
          onChange={(e) => handleSwitchAttributes(e.target.value as 'property' | 'interface')}
          disabled={!loadedRemId || (!propertyData && !interfaceData && !directPropertyData)}
        >
          <option value="property">Properties</option>
          <option value="interface">Interfaces</option>
        </select>
        <button
          style={{
            padding: "6px 12px",
            background: !loadedRemId || loading ? "#cbd5f5" : "#2563eb",
            color: !loadedRemId || loading ? "#475569" : "#ffffff",
            border: "none",
            borderRadius: 4,
            cursor: !loadedRemId || loading ? "not-allowed" : "pointer",
            fontWeight: 600,
          }}
          onClick={handleRefresh}
          disabled={!loadedRemId}
        >
          Reposition
        </button>
        <button
          style={{
            padding: "6px 12px",
            background: historyStack.length === 0 || loading ? "#cbd5f5" : "#2563eb",
            color: historyStack.length === 0 || loading ? "#475569" : "#ffffff",
            border: "none",
            borderRadius: 4,
            cursor: historyStack.length === 0 || loading ? "not-allowed" : "pointer",
            fontWeight: 600,
          }}
          onClick={handleGoBack}
          disabled={historyStack.length === 0}
        >
          Back
        </button>
      </div>

      {error && <div style={{ color: "#dc2626", marginBottom: 8 }}>{error}</div>}
      
      {isPartialLoad && !error && (
        <div style={{ 
          color: "#b45309", 
          background: "#fef3c7", 
          padding: "8px 12px", 
          borderRadius: 4, 
          marginBottom: 8,
          border: "1px solid #fcd34d",
          fontSize: 13
        }}>
          ⚠️ Loading timed out after 60 seconds. Showing partial results.
        </div>
      )}

      <div
        style={{
          height: "calc(100% - 60px)",
          minHeight: 300,
          border: "1px solid #e2e8f0",
          borderRadius: 8,
          background: "#f8fafc",
          position: "relative",
          color: "#0f172a"
        }}
        onClick={handleContextMenuClose}
      >
        {showPlaceholder ? (
          <div style={{ padding: 24, color: "#64748b" }}>
            {focusedRemId
              ? "Press Reposition to load the inheritance hierarchy."
              : "Focus a rem, then press Reposition to load the hierarchy."}
          </div>
        ) : (
          <ReactFlowProvider>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={NODE_TYPES}
              edgeTypes={EDGE_TYPES}
              onInit={setReactFlowInstance}
              onNodeClick={handleNodeClick}
              onNodeContextMenu={handleNodeContextMenu}
              onPaneContextMenu={handlePaneContextMenu}
              onNodesChange={handleNodesChange}
              nodesDraggable
              nodesConnectable={false}
              elementsSelectable={false}
              panOnDrag
              zoomOnScroll
              proOptions={{ hideAttribution: true }}
              fitView
              minZoom={0.1}
              maxZoom={1.4}
              style={{ background: "transparent" }}
            >
              <Background gap={24} color="#e2e8f0" />
              <Controls position="bottom-right" showInteractive={false} />
            </ReactFlow>
          </ReactFlowProvider>
        )}
        {contextMenu && (
          <div
            style={{
              position: 'fixed',
              left: contextMenu.x,
              top: contextMenu.y,
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 4,
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
              zIndex: 1000,
              minWidth: 160,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              style={{
                padding: '8px 12px',
                background: 'none',
                border: 'none',
                width: '100%',
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: 14,
                color: '#374151',
              }}
              onClick={handleGotoContextRem}
            >
              Open Rem
            </button>
            <button
              style={{
                padding: '8px 12px',
                background: 'none',
                border: 'none',
                width: '100%',
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: 14,
                color: '#374151',
              }}
              onClick={handleHideProperties}
            >
              Toggle Properties
            </button>
            <button
              style={{
                padding: '8px 12px',
                background: 'none',
                border: 'none',
                width: '100%',
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: 14,
                color: '#374151',
              }}
              onClick={handleHideVirtualProperties}
            >
              Toggle Virtual Properties
            </button>
            <button
              style={{
                padding: '8px 12px',
                background: 'none',
                border: 'none',
                width: '100%',
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: 14,
                color: '#374151',
                borderTop: '1px solid #e2e8f0',
              }}
              onClick={handleOpenContextRem}
            >
              Edit Rem
            </button>
            <button
              style={{
                padding: '8px 12px',
                background: 'none',
                border: 'none',
                width: '100%',
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: 14,
                color: '#374151',
              }}
              onClick={handleCopyContextRem}
            >
              Copy Rem
            </button>
            <button
              style={{
                padding: '8px 12px',
                background: 'none',
                border: 'none',
                width: '100%',
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: 14,
                color: '#6b7280',
                borderTop: '1px solid #e2e8f0',
              }}
              onClick={handleCopyDebugInfo}
            >
              Copy Debug Info
            </button>
          </div>
        )}
        {virtualContextMenu && (
          <div
            style={{
              position: 'fixed',
              left: virtualContextMenu.x,
              top: virtualContextMenu.y,
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 4,
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
              zIndex: 1000,
              minWidth: 160,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              style={{
                padding: '8px 12px',
                background: 'none',
                border: 'none',
                width: '100%',
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: 14,
                color: '#374151',
              }}
              onClick={handleImplementVirtualProperty}
            >
              Implement
            </button>
            <button
              style={{
                padding: '8px 12px',
                background: 'none',
                border: 'none',
                width: '100%',
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: 14,
                color: '#374151',
                borderTop: '1px solid #e2e8f0',
              }}
              onClick={handleEditVirtualRem}
            >
              Edit Rem
            </button>
          </div>
        )}
        {paneContextMenu && (
          <div
            style={{
              position: 'fixed',
              left: paneContextMenu.x,
              top: paneContextMenu.y,
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 4,
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
              zIndex: 1000,
              minWidth: 120,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              style={{
                padding: '8px 12px',
                background: 'none',
                border: 'none',
                width: '100%',
                textAlign: 'left',
                cursor: loadedRemId ? 'pointer' : 'not-allowed',
                fontSize: 14,
                color: loadedRemId ? '#374151' : '#9ca3af',
              }}
              onClick={handleExportToXml}
              disabled={!loadedRemId}
            >
              Export
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

renderWidget(MindmapWidget);
