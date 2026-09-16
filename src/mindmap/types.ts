import { Node, Edge } from "reactflow";
import { PluginRem, RichTextInterface } from "@remnote/plugin-sdk";

export type HierarchyNode = {
  id: string;
  name: string;
  richText?: RichTextInterface;
  remRef: PluginRem;
  children: HierarchyNode[];
  isExported?: boolean;
};

export type GraphNodeData = {
  label: string;
  richText?: RichTextInterface;
  remId: string;
  kind: "rem" | "property" | "interface" | "virtualProperty" | "virtualInterface" | "directProperty" | "virtualDirectProperty" | "virtualInterfaceGroup";
  sourcePropertyId?: string;
  ownerRemId?: string;
  sourceRemLabel?: string;
  isDescriptorProperty?: boolean;
  isExported?: boolean;
  isDepthCutoff?: boolean;
};

export type AttributeNodeInfo = {
  id: string;
  label: string;
  richText?: RichTextInterface;
  hierarchyLevel?: number;
  extends: string[];
  children: AttributeNodeInfo[];
  isPrivate: boolean;
  isDescriptorProperty: boolean;
  isExported: boolean;
  isDepthCutoff?: boolean;
};

export type AttributeDetail = Omit<AttributeNodeInfo, "children"> & {
  ownerNodeId: string;
  hasChildren: boolean;
  parentId?: string;
};

export type AttributeData = {
  byOwner: Record<string, AttributeNodeInfo[]>;
  byId: Record<string, AttributeDetail>;
};

export type VirtualAttributeInfo = {
  id: string;
  label: string;
  richText?: RichTextInterface;
  hierarchyLevel?: number;
  sourcePropertyId: string;
  ownerRemId: string;
  sourceRemId: string;
  sourceRemLabel: string;
  children: VirtualAttributeInfo[];
  isDescriptorProperty: boolean;
  extendsVirtualIds: string[];
  isDepthCutoff?: boolean;
  baseTypeId?: string;
  baseTypeLabel?: string;
};

export type VirtualAttributeData = {
  byOwner: Record<string, VirtualAttributeInfo[]>;
};

export type GraphNode = Node<GraphNodeData>;
export type GraphEdge = Edge;

export type AttributeKind = "property" | "interface" | "directProperty";

export type VirtualDataByKind = Partial<Record<AttributeKind, VirtualAttributeData>>;

export type LoadComputationContext = {
  childToParentsMap?: Record<string, Set<string>>;
  virtualDataByKind: VirtualDataByKind;
  parentClassCache: Map<string, PluginRem[]>;
  remLookupCache: Map<string, PluginRem | null>;
  extendsChildrenCache: Map<string, PluginRem[]>;
};

export type MindMapState = {
  loadedRemId: string;
  attributeType: "property" | "interface";
  historyStack: string[];
};

export type ExportMetadata = {
  isProperty: boolean;
  isExported: boolean;
  extendsNames: string[];
};
