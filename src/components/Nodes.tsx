import { Handle, Position } from "@xyflow/react";

export interface NodeData {
    [key: string]: unknown;
    label: string;
    width: number;
    height: number;
  }
  
// FocusedRemNode: Handles on all four sides
export const FocusedRemNode = ({ data }: { data: NodeData }) => {
  return (
    <div
      style={{
        padding: 5,
        backgroundColor: "#ffcc00", // Highlighted color for focused node
        color: "black",
        border: "1px solid black",
        borderRadius: 5,
        whiteSpace: "normal",
        wordWrap: "break-word",
        width: data.width,
        height: data.height,
        display: 'flex', // Use Flexbox for centering
      justifyContent: 'center', // Center horizontally
      alignItems: 'center', // Center vertically
      textAlign: 'center', // Additional text alignment
      }}
    >
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="source" position={Position.Right} id="right" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="target" position={Position.Left} id="left" />
      <div>{data.label}</div>
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
        display: 'flex', // Use Flexbox for centering
      justifyContent: 'center', // Center horizontally
      alignItems: 'center', // Center vertically
      textAlign: 'center', // Additional text alignment
      }}
    >
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="target" position={Position.Left} id="left" />
      <div>{data.label}</div>
    </div>
  );
};

// ChildNode: Handles on top (target) and bottom (source)
export const ChildNode = ({ data }: { data: NodeData }) => {
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
        display: 'flex', // Use Flexbox for centering
      justifyContent: 'center', // Center horizontally
      alignItems: 'center', // Center vertically
      textAlign: 'center', // Additional text alignment
      }}
    >
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <div>{data.label}</div>
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
        display: 'flex', // Use Flexbox for centering
      justifyContent: 'center', // Center horizontally
      alignItems: 'center', // Center vertically
      textAlign: 'center', // Additional text alignment
      }}
    >
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="target" position={Position.Left} id="left" />
      <div>{data.label}</div>
    </div>
  );
};

// ChildPropertyNode: Handle only on top (target)
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
        display: 'flex', // Use Flexbox for centering
        justifyContent: 'center', // Center horizontally
        alignItems: 'center', // Center vertically
        textAlign: 'center', // Additional text alignment
      }}
    >
      <Handle type="target" position={Position.Left} id="left" />
      <div>{data.label}</div>
    </div>
  );
};

// ChildPropertyNode: Handle only on top (target)
export const PropertyNodeQuestion = ({ data }: { data: NodeData }) => {
return (
  <div
    style={{
      padding: 5,
      backgroundColor: "#3380b8", // #3380b8
      color: "black",
      border: "1px solid #777",
      borderRadius: 5,
      whiteSpace: "normal",
      wordWrap: "break-word",
      width: data.width,
      height: data.height,
      display: 'flex', // Use Flexbox for centering
      justifyContent: 'left', // Center horizontally
      alignItems: 'center', // Center vertically
      textAlign: 'center', // Additional text alignment
    }}
  >
    <Handle type="target" position={Position.Left} id="left" />
    <Handle type="source" position={Position.Left} id="left" />
    <div>{data.label}</div>
  </div>
);
};

export const PropertyNodeRefQuestion = ({ data }: { data: NodeData }) => {
  return (
    <div
      style={{
        padding: 5,
        backgroundColor: "#3d6885", // #3d6885
        color: "black",
        border: "1px solid #777",
        borderRadius: 5,
        whiteSpace: "normal",
        wordWrap: "break-word",
        width: data.width,
        height: data.height,
        display: 'flex', // Use Flexbox for centering
        justifyContent: 'left', // Center horizontally
        alignItems: 'center', // Center vertically
        textAlign: 'center', // Additional text alignment
      }}
    >
      <Handle type="target" position={Position.Left} id="left" />
      <Handle type="target" position={Position.Right} id="right" />
      <div>{data.label}</div>
    </div>
  );
  };

export const PropertyNodeRefAnswer = ({ data }: { data: NodeData }) => {
  return (
    <div
      style={{
        padding: 5,
        backgroundColor: "#b56222",
        color: "black",
        border: "1px solid #777",
        borderRadius: 5,
        whiteSpace: "normal",
        wordWrap: "break-word",
        width: data.width,
        height: data.height,
        display: 'flex', // Use Flexbox for centering
        justifyContent: 'left', // Center horizontally
        alignItems: 'center', // Center vertically
        textAlign: 'center', // Additional text alignment
      }}
    >
      <Handle type="target" position={Position.Left} id="left" />
      <Handle type="target" position={Position.Right} id="right" />
      <div>{data.label}</div>
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
  propertyRefAnswer: PropertyNodeRefAnswer
};