import React from 'react';
import { Handle, Position } from "@xyflow/react";

import { calcNodeHeight
} from "../utils/utils";

// ============================================
// Mindmap Node Styles
// ============================================

const MINDMAP_NODE_BASE: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 6,
  textAlign: "center",
};

// REM Node Styles
export const REM_NODE_STYLE: React.CSSProperties = {
  ...MINDMAP_NODE_BASE,
  background: "#ffffff",
  border: "1px solid #cbd5f5",
  fontSize: 13,
  minWidth: 140,
};

export const REM_NODE_STYLE_COLLAPSED: React.CSSProperties = {
  ...REM_NODE_STYLE,
  background: "#e2e8f0",
};

export const REM_NODE_STYLE_CENTER: React.CSSProperties = {
  ...REM_NODE_STYLE,
  border: "2px solid #1d4ed8",
  background: "#dbeafe",
  fontWeight: 600,
};

// Property Node Styles
export const PROPERTY_NODE_STYLE: React.CSSProperties = {
  ...MINDMAP_NODE_BASE,
  background: "#fefce8",
  border: "1px solid #facc15",
  fontSize: 12,
  minWidth: 160,
};

export const PROPERTY_NODE_STYLE_COLLAPSED: React.CSSProperties = {
  ...PROPERTY_NODE_STYLE,
  background: "#f1de90",
};

// Interface Node Styles
export const INTERFACE_NODE_STYLE: React.CSSProperties = {
  ...MINDMAP_NODE_BASE,
  background: "#ecfdf5",
  border: "1px solid #10b981",
  fontSize: 12,
  minWidth: 160,
};

export const INTERFACE_NODE_STYLE_COLLAPSED: React.CSSProperties = {
  ...INTERFACE_NODE_STYLE,
  background: "#a7f3d0",
};

// Virtual (Unimplemented) Property Node Styles - Greyed out
export const VIRTUAL_PROPERTY_NODE_STYLE: React.CSSProperties = {
  ...MINDMAP_NODE_BASE,
  background: "#e5e5e5",
  border: "1px dashed #9ca3af",
  fontSize: 12,
  minWidth: 160,
  opacity: 0.7,
  fontStyle: "italic",
};

export const VIRTUAL_INTERFACE_NODE_STYLE: React.CSSProperties = {
  ...MINDMAP_NODE_BASE,
  background: "#e5e5e5",
  border: "1px dashed #6b7280",
  fontSize: 12,
  minWidth: 160,
  opacity: 0.7,
  fontStyle: "italic",
};

// Helper to get the appropriate style with optional width
export function getNodeStyle(
  kind: 'rem' | 'property' | 'interface' | 'virtualProperty' | 'virtualInterface',
  isCollapsed: boolean,
  isCenter: boolean = false,
  width?: number
): React.CSSProperties {
  let style: React.CSSProperties;
  
  if (kind === 'rem') {
    if (isCenter) {
      style = REM_NODE_STYLE_CENTER;
    } else {
      style = isCollapsed ? REM_NODE_STYLE_COLLAPSED : REM_NODE_STYLE;
    }
  } else if (kind === 'property') {
    style = isCollapsed ? PROPERTY_NODE_STYLE_COLLAPSED : PROPERTY_NODE_STYLE;
  } else if (kind === 'interface') {
    style = isCollapsed ? INTERFACE_NODE_STYLE_COLLAPSED : INTERFACE_NODE_STYLE;
  } else if (kind === 'virtualProperty') {
    style = VIRTUAL_PROPERTY_NODE_STYLE;
  } else {
    style = VIRTUAL_INTERFACE_NODE_STYLE;
  }
  
  return width ? { ...style, width } : style;
}

export interface NodeData {
  [key: string]: unknown;
  label: string;
  width: number;
  height: number;
}

// Function to format node content based on the presence of "<"
//#f36666
function formatNodeContent(label: string, nodeWidth: number): JSX.Element {
  const isSpecial = label.includes("<<");
  if (label.includes("<")) {
    const lastIndex = label.lastIndexOf("<");
    const firstPartRaw = label.substring(0, lastIndex).trim();
    const firstPart = firstPartRaw.replace(/<(?!<)/g, '\n'); // Replace standalone "<" with newline
    const secondPart = label.substring(lastIndex + 1).trim();
    return (
      <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* Smaller node for firstPart */}
        <div style={{
          position: 'absolute',
          top: 1,
          left: 1,
          width: '97%',
          height: calcNodeHeight(firstPart, nodeWidth, 15),
          backgroundColor: isSpecial ? '#f36666' : '#aaaaff',
          border: '1px solid black',
          borderRadius: 5,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          fontSize: '12px',
          padding: '1px',
          whiteSpace: 'pre-wrap', // Respect newlines
          wordWrap: 'break-word'
        }}>
          {firstPart}
        </div>
        {/* Main content with secondPart at center bottom */}
        <div style={{
          flex: 1,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'flex-end', // Align to bottom
          padding: '10px'
        }}>
          {secondPart}
        </div>
      </div>
    );
  } else {
    return <div style={{ width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>{label}</div>;
  }
}

// FocusedRemNode: Handles on all four sides
export const FocusedRemNode = ({ data }: { data: NodeData }) => {
  const focusedNodeWidth = 100;

  return (
    <div
      style={{
        padding: 5,
        backgroundColor: "#ffcc00",
        color: "black",
        border: "1px solid black",
        borderRadius: 5,
        whiteSpace: "normal",
        wordWrap: "break-word",
        width: data.width,
        height: data.height,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        textAlign: 'center',
      }}
    >
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="source" position={Position.Right} id="right" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="target" position={Position.Left} id="left" />
      {formatNodeContent(data.label, data.width)}
    </div>
  );
};

// ParentNode: Handles on top (target) and bottom (source)
export const ParentNode = ({ data }: { data: NodeData }) => {
  return (
    <div
      style={{
        padding: 5,
        backgroundColor: "#cccccc",
        color: "black",
        border: "1px solid #777",
        borderRadius: 5,
        whiteSpace: "normal",
        wordWrap: "break-word",
        width: data.width,
        height: data.height,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        textAlign: 'center',
      }}
    >
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="target" position={Position.Left} id="left" />
      <Handle type="source" position={Position.Right} id="right" />
      <Handle type="target" position={Position.Right} id="right" />
      {formatNodeContent(data.label, data.width)}
    </div>
  );
};

// ChildNode: Handles on top (target) and bottom (source)
export const ChildNode = ({ data }: { data: NodeData }) => {
  return (
    <div
      style={{
        padding: 5,
        backgroundColor: "#437c52",
        color: "black",
        border: "1px solid #777",
        borderRadius: 5,
        whiteSpace: "normal",
        wordWrap: "break-word",
        width: data.width,
        height: data.height,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        textAlign: 'center',
      }}
    >
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      {formatNodeContent(data.label, data.width)}
    </div>
  );
};

// ParentPropertyNode: Handles on bottom (source) and left (target)
export const ParentPropertyNode = ({ data }: { data: NodeData }) => {
  return (
    <div
      style={{
        padding: 5,
        backgroundColor: "#aaaaff",
        color: "black",
        border: "1px solid #777",
        borderRadius: 5,
        whiteSpace: "normal",
        wordWrap: "break-word",
        width: data.width,
        height: data.height,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        textAlign: 'center',
      }}
    >
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="target" position={Position.Left} id="left" />
      {formatNodeContent(data.label, data.width)}
    </div>
  );
};

// PropertyNode: Handle only on left (target)
export const PropertyNode = ({ data }: { data: NodeData }) => {
  return (
    <div
      style={{
        padding: 5,
        backgroundColor: "#aaffaa",
        color: "black",
        border: "1px solid #777",
        borderRadius: 5,
        whiteSpace: "normal",
        wordWrap: "break-word",
        width: data.width,
        height: data.height,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        textAlign: 'center',
      }}
    >
      <Handle type="target" position={Position.Left} id="left" />
      {formatNodeContent(data.label, data.width)}
    </div>
  );
};

// PropertyNodeQuestion: Handles on left (target and source)
export const PropertyNodeQuestion = ({ data }: { data: NodeData }) => {
  return (
    <div
      style={{
        padding: 5,
        backgroundColor: "#3380b8",
        color: "black",
        border: "1px solid #777",
        borderRadius: 5,
        whiteSpace: "normal",
        wordWrap: "break-word",
        width: data.width,
        height: data.height,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        textAlign: 'center',
      }}
    >
      <Handle type="target" position={Position.Left} id="left" />
      <Handle type="source" position={Position.Left} id="left" />
      {formatNodeContent(data.label, data.width)}
    </div>
  );
};

// PropertyNodeRefQuestion: Handles on left and right (target)
export const PropertyNodeRefQuestion = ({ data }: { data: NodeData }) => {
  return (
    <div
      style={{
        padding: 5,
        backgroundColor: "#3d6885",
        color: "black",
        border: "1px solid #777",
        borderRadius: 5,
        whiteSpace: "normal",
        wordWrap: "break-word",
        width: data.width,
        height: data.height,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        textAlign: 'center',
      }}
    >
      <Handle type="target" position={Position.Left} id="left" />
      <Handle type="target" position={Position.Right} id="right" />
      {formatNodeContent(data.label, data.width)}
    </div>
  );
};

// PropertyNodeRefAnswer: Handles on left and right (target)
export const PropertyNodeRefAnswer = ({ data }: { data: NodeData }) => {
  return (
    <div
      style={{
        padding: 5,
        backgroundColor: "#3d6885",
        color: "black",
        border: "1px solid #777",
        borderRadius: 5,
        whiteSpace: "normal",
        wordWrap: "break-word",
        width: data.width,
        height: data.height,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        textAlign: 'center',
      }}
    >
      <Handle type="target" position={Position.Left} id="left" />
      <Handle type="target" position={Position.Right} id="right" />
      {formatNodeContent(data.label, data.width)}
    </div>
  );
};

// LayerNode: Handle only on left (target)
export const LayerNode = ({ data }: { data: NodeData }) => {
  return (
    <div
      style={{
        padding: 5,
        backgroundColor: "#b53f22",
        color: "black",
        border: "1px solid #777",
        borderRadius: 5,
        whiteSpace: "normal",
        wordWrap: "break-word",
        width: data.width,
        height: data.height,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        textAlign: 'center',
      }}
    >
      <Handle type="target" position={Position.Left} id="left" />
      {formatNodeContent(data.label, data.width)}
    </div>
  );
};

export const nodeTypes = {
  focused: FocusedRemNode,
  parent: ParentNode,
  parentProperty: ParentPropertyNode,
  child: ChildNode,
  property: PropertyNode,
  propertyQuestion: PropertyNodeQuestion,
  propertyRefQuestion: PropertyNodeRefQuestion,
  propertyRefAnswer: PropertyNodeRefAnswer,
  layer: LayerNode
};