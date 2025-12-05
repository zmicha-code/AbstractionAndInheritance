import React, { useState, useEffect, useCallback } from "react";
import { ReactFlow, Node, Edge, useReactFlow, NodeTypes, OnNodesChange, OnEdgesChange, NodeMouseHandler } from "reactflow";
import { renderWidget, useTrackerPlugin, usePlugin } from "@remnote/plugin-sdk";
import { NodeData } from "../components/Nodes";

// Define the props interface
interface GraphComponentProps {
  nodes: Node[];
  edges: Edge[];
  nodeTypes: NodeTypes;
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onNodeClick?: NodeMouseHandler;
  onNodeContextMenu?: NodeMouseHandler;
}

// Update the component with typed props
export function GraphComponent({
  nodes,
  edges,
  nodeTypes,
  onNodesChange,
  onEdgesChange,
  onNodeClick,
  onNodeContextMenu
}: GraphComponentProps) {
  const plugin = usePlugin();
  const { fitView } = useReactFlow();

  /*
  useEffect(() => {
    if (nodes.length > 0) {
      const timer = setTimeout(() => {
        fitView({ duration: 500, padding: 0.2 });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [nodes, fitView]);
  */

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={onNodeClick}
      onNodeContextMenu={onNodeContextMenu}
    />
  );
}