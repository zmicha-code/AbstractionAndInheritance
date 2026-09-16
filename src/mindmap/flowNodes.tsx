import React from "react";
import { Handle, Position, NodeProps } from "reactflow";
import { RichTextLabel } from "../utils/richText";
import { GraphNodeData } from "./types";
import {
  NODE_CONTAINER_STYLE,
  ATTRIBUTE_CONTAINER_STYLE,
  HANDLE_COMMON_STYLE,
  TOP_HANDLE_STYLE,
  BOTTOM_HANDLE_STYLE,
  RIGHT_HANDLE_STYLE,
  LEFT_HANDLE_STYLE,
  RIGHT_TARGET_HANDLE_STYLE,
  BOTTOM_SOURCE_HANDLE_STYLE,
  REM_TARGET_TOP_HANDLE,
  REM_SOURCE_BOTTOM_HANDLE,
  REM_SOURCE_RIGHT_HANDLE,
  REM_SOURCE_LEFT_HANDLE,
  REM_TARGET_LEFT_HANDLE,
  REM_TARGET_RIGHT_HANDLE,
  ATTRIBUTE_TARGET_LEFT_HANDLE,
  ATTRIBUTE_SOURCE_RIGHT_HANDLE,
  ATTRIBUTE_SOURCE_BOTTOM_HANDLE,
  ATTRIBUTE_TARGET_RIGHT_HANDLE,
  ATTRIBUTE_TARGET_TOP_HANDLE,
} from "./constants";

export function RemFlowNode({ data }: NodeProps<GraphNodeData>) {
  return (
    <div style={{ ...NODE_CONTAINER_STYLE, cursor: "pointer" }}>
      <Handle type="target" position={Position.Top} id={REM_TARGET_TOP_HANDLE} style={{ ...HANDLE_COMMON_STYLE, ...TOP_HANDLE_STYLE }} />
      <Handle type="source" position={Position.Bottom} id={REM_SOURCE_BOTTOM_HANDLE} style={{ ...HANDLE_COMMON_STYLE, ...BOTTOM_HANDLE_STYLE }} />
      <Handle type="source" position={Position.Right} id={REM_SOURCE_RIGHT_HANDLE} style={{ ...HANDLE_COMMON_STYLE, ...RIGHT_HANDLE_STYLE }} />
      <Handle type="source" position={Position.Left} id={REM_SOURCE_LEFT_HANDLE} style={{ ...HANDLE_COMMON_STYLE, ...LEFT_HANDLE_STYLE }} />
      <Handle type="target" position={Position.Left} id={REM_TARGET_LEFT_HANDLE} style={{ ...HANDLE_COMMON_STYLE, ...LEFT_HANDLE_STYLE }} />
      <Handle type="target" position={Position.Right} id={REM_TARGET_RIGHT_HANDLE} style={{ ...HANDLE_COMMON_STYLE, ...RIGHT_TARGET_HANDLE_STYLE }} />
      <RichTextLabel richText={data.richText} fallback={data.label} />
    </div>
  );
}

export function PropertyFlowNode({ data }: NodeProps<GraphNodeData>) {
  return (
    <div style={{ ...ATTRIBUTE_CONTAINER_STYLE, cursor: "pointer" }}>
      <Handle type="target" position={Position.Left} id={ATTRIBUTE_TARGET_LEFT_HANDLE} style={{ ...HANDLE_COMMON_STYLE, ...LEFT_HANDLE_STYLE }} />
      <Handle type="source" position={Position.Right} id={ATTRIBUTE_SOURCE_RIGHT_HANDLE} style={{ ...HANDLE_COMMON_STYLE, ...RIGHT_HANDLE_STYLE }} />
      <Handle type="source" position={Position.Bottom} id={ATTRIBUTE_SOURCE_BOTTOM_HANDLE} style={{ ...HANDLE_COMMON_STYLE, ...BOTTOM_SOURCE_HANDLE_STYLE }} />
      <Handle type="target" position={Position.Right} id={ATTRIBUTE_TARGET_RIGHT_HANDLE} style={{ ...HANDLE_COMMON_STYLE, ...RIGHT_TARGET_HANDLE_STYLE }} />
      <Handle type="target" position={Position.Top} id={ATTRIBUTE_TARGET_TOP_HANDLE} style={{ ...HANDLE_COMMON_STYLE, ...TOP_HANDLE_STYLE }} />
      <RichTextLabel richText={data.richText} fallback={data.label} style={{ width: "100%" }} />
    </div>
  );
}

export function InterfaceFlowNode({ data }: NodeProps<GraphNodeData>) {
  return (
    <div style={{ ...ATTRIBUTE_CONTAINER_STYLE, cursor: "pointer" }}>
      <Handle type="target" position={Position.Left} id={ATTRIBUTE_TARGET_LEFT_HANDLE} style={{ ...HANDLE_COMMON_STYLE, ...LEFT_HANDLE_STYLE }} />
      <Handle type="source" position={Position.Right} id={ATTRIBUTE_SOURCE_RIGHT_HANDLE} style={{ ...HANDLE_COMMON_STYLE, ...RIGHT_HANDLE_STYLE }} />
      <Handle type="source" position={Position.Bottom} id={ATTRIBUTE_SOURCE_BOTTOM_HANDLE} style={{ ...HANDLE_COMMON_STYLE, ...BOTTOM_SOURCE_HANDLE_STYLE }} />
      <Handle type="target" position={Position.Right} id={ATTRIBUTE_TARGET_RIGHT_HANDLE} style={{ ...HANDLE_COMMON_STYLE, ...RIGHT_TARGET_HANDLE_STYLE }} />
      <Handle type="target" position={Position.Top} id={ATTRIBUTE_TARGET_TOP_HANDLE} style={{ ...HANDLE_COMMON_STYLE, ...TOP_HANDLE_STYLE }} />
      <RichTextLabel richText={data.richText} fallback={data.label} style={{ width: "100%" }} />
    </div>
  );
}

export function VirtualPropertyFlowNode({ data }: NodeProps<GraphNodeData>) {
  const hoverText = data.sourceRemLabel ? `${data.sourceRemLabel}` : undefined;
  return (
    <div style={{ ...ATTRIBUTE_CONTAINER_STYLE, cursor: "pointer" }} title={hoverText}>
      <Handle type="target" position={Position.Top} id={ATTRIBUTE_TARGET_TOP_HANDLE} style={{ ...HANDLE_COMMON_STYLE, ...TOP_HANDLE_STYLE }} />
      <Handle type="target" position={Position.Left} id={ATTRIBUTE_TARGET_LEFT_HANDLE} style={{ ...HANDLE_COMMON_STYLE, ...LEFT_HANDLE_STYLE }} />
      <Handle type="source" position={Position.Right} id={ATTRIBUTE_SOURCE_RIGHT_HANDLE} style={{ ...HANDLE_COMMON_STYLE, ...RIGHT_HANDLE_STYLE }} />
      <Handle type="source" position={Position.Bottom} id={ATTRIBUTE_SOURCE_BOTTOM_HANDLE} style={{ ...HANDLE_COMMON_STYLE, ...BOTTOM_HANDLE_STYLE }} />
      <RichTextLabel richText={data.richText} fallback={data.label} style={{ width: "100%", fontStyle: "italic" }} prefix="⊕ " />
    </div>
  );
}

export function VirtualInterfaceGroupFlowNode({ data }: NodeProps<GraphNodeData>) {
  return (
    <div style={{ ...ATTRIBUTE_CONTAINER_STYLE, cursor: "pointer" }}>
      <Handle type="target" position={Position.Left} id={ATTRIBUTE_TARGET_LEFT_HANDLE} style={{ ...HANDLE_COMMON_STYLE, ...LEFT_HANDLE_STYLE }} />
      <Handle type="source" position={Position.Right} id={ATTRIBUTE_SOURCE_RIGHT_HANDLE} style={{ ...HANDLE_COMMON_STYLE, ...RIGHT_HANDLE_STYLE }} />
      <RichTextLabel richText={data.richText} fallback={data.label} style={{ width: "100%" }} />
    </div>
  );
}

export const NODE_TYPES = {
  remNode: RemFlowNode,
  propertyNode: PropertyFlowNode,
  interfaceNode: InterfaceFlowNode,
  directPropertyNode: InterfaceFlowNode,
  virtualPropertyNode: VirtualPropertyFlowNode,
  virtualInterfaceNode: VirtualPropertyFlowNode,
  virtualDirectPropertyNode: VirtualPropertyFlowNode,
  virtualInterfaceGroupNode: VirtualInterfaceGroupFlowNode,
};
