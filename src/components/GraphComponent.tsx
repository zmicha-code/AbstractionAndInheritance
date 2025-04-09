import React, { useState, useEffect, useCallback } from "react";
import { ReactFlow, Node, Edge, useReactFlow, NodeTypes, OnNodesChange, OnEdgesChange } from "@xyflow/react";
import { renderWidget, useTracker, Rem, usePlugin } from "@remnote/plugin-sdk";
import { NodeData } from "../components/Nodes";

// Define the props interface
interface GraphComponentProps<T extends Node> {
  nodes: T[];
  edges: Edge[];
  nodeTypes: NodeTypes;
  onNodesChange: OnNodesChange<T>;
  onEdgesChange: OnEdgesChange<Edge>;
}

// Update the component with typed props
export function GraphComponent<T extends Node>({
  nodes,
  edges,
  nodeTypes,
  onNodesChange,
  onEdgesChange,
}: GraphComponentProps<T>) {
  const plugin = usePlugin();
  const { fitView } = useReactFlow();

  // onNodeClick={handleNodeClick}
  async function handleNodeClick<T extends Node>(_event: React.MouseEvent, node: T) {
    try {
        // const plugin = usePlugin(); // not allowed here
        //await plugin.window.openRem((await plugin.rem.findOne(node.id)) as Rem);
        const focusedRem = (await plugin.rem.findOne(node.id)) as Rem;
        if (focusedRem) {
          await plugin.storage.setSession('selectedRemId', focusedRem._id);
        } else {
          await plugin.app.toast('No Rem is currently selected.');
        }
    } catch (error) {
        console.error("Error opening Rem:", error);
    }
  }

  useEffect(() => {
    if (nodes.length > 0) {
      const timer = setTimeout(() => {
        fitView({ duration: 500, padding: 0.2 });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [nodes, fitView]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={handleNodeClick}
    />
  );
}