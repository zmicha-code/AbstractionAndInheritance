import React, { useState, useEffect, useCallback } from "react";
import { ReactFlow, Node, Edge, SmoothStepEdge, useReactFlow, ReactFlowProvider, Handle, Position, useNodesState, useEdgesState } from "@xyflow/react";
import { renderWidget, useTracker, Rem, usePlugin, RNPlugin } from "@remnote/plugin-sdk";

import {  specialTags, specialNames, highlightColorMap, DEFAULT_NODE_COLOR, FOCUSED_NODE_STYLE, calculateLines,
          getRemText, getNextParents, referencesEigenschaften, isReferencingRem,
          isNextParent, isRemProperty, getNonReferencingParent, highestXPosition,
          highestYPosition, calculateTextWidth
 } from "../utils/utils";
 
import { GraphComponent } from "../components/GraphComponent"
import MyRemNoteButton from "../components/MyRemNoteButton"
import {
  FocusedRemNode,
  ParentNode,
  ChildNode,
  PropertyNode,
  ParentPropertyNode,
  NodeData,
  nodeTypes
} from "../components/Nodes";

// Required CSS for React Flow
import "@xyflow/react/dist/style.css";

// ### Graph Construction Functions
// Collect Parents

async function collectParents(
  plugin: RNPlugin,
  srcRem: Rem,
  rem: Rem,
  depth: number,
  nodesMap: Map<string, { rem: Rem; type: string; depth?: number; position: { x: number; y: number }; data: NodeData }>,
  edges: Set<Edge>
) {
  const nodeWidth = 150; // Example width
  const nodeHeight = 50; // Example height
  const spacing_x = 120; 
  const spacing_y = 120;  // Example spacing between nodes
  if (depth <= 0) {
    return;
  }

  let childPosition = nodesMap.get(rem._id)?.position ?? { x: 0, y: 0 };

  const parents = await getNextParents(plugin, rem);

  for (let i = 0; i < parents.length; i++) {
    const parent = parents[i];

    if (!nodesMap.has(parent._id)) {
      const x = childPosition.x + (i - (parents.length - 1) / 2) * (nodeWidth + spacing_x);
      const y = childPosition.y - nodeHeight - spacing_y;
      const position = { x, y };
      const data = { label: await getRemText(plugin, parent), width: 150, height: 50 };
      nodesMap.set(parent._id, { rem: parent, type: "parent", position, data });

      edges.add({
        id: `${parent._id}-${rem._id}`,
        source: parent._id,
        target: rem._id,
        type: "smoothstep",
        sourceHandle: "bottom",
        targetHandle: "top",
        pathOptions: {
          offset: -50,
          borderRadius: 100
        }
      } as any);
    } else {

      // Define the edge ID
      const edgeId = `${parent._id}-${rem._id}`;
      const edgeId2 = `${parent._id}-${rem._id}2`;

      // Check if an edge with this ID already exists in the edges set
      if (!Array.from(edges).some(edge => edge.id === edgeId || edge.id === edgeId2)) {
        edges.add({
          id: `${parent._id}-${rem._id}2`,
          source: parent._id,
          target: rem._id,
          label: "Additional",
          type: "smoothstep",
          sourceHandle: "bottom",
          targetHandle: "top",
        });

        // Tree is built left to right. therefore move parent above the rightmost child
        const parentEntry = nodesMap.get(parent._id);
        const remEntry = nodesMap.get(rem._id);
        //if (parentEntry && remEntry) {
        //  parentEntry.position.x = remEntry.position.x;
        // }
        
        // Adjust height of newly node that got an additional connection
        //if (parentEntry && remEntry) {
        //  parentEntry.position.y = remEntry.position.y;
        //}
      }
    }

    if ((await getRemText(plugin, parent)).search("L_") == -1 && (await getRemText(plugin, parent)).search("C_") == -1) {
      await collectParents(plugin, srcRem, parent, depth - 1, nodesMap, edges);
    }
  }
}

// Collect Parent Properties
async function collectParentProperties(
  plugin: RNPlugin,
  selectedRem: Rem,
  nodesMap: Map<string, { rem: Rem; type: string; position: { x: number; y: number }; data: NodeData }>,
  edges: Set<Edge>
) {
  const nodeWidth = 150; // Example width
  const nodeHeight = 50; // Example height
  const spacing_x = 120; 
  const spacing_y = 120;  // Example spacing between nodes
  let currentRem = selectedRem;
  let index = 0;

  while(true) {

    if (!currentRem) return;

    //parentClass = await getNonReferencingParent(currentRem);
    let parentNonRefRem = await currentRem.getParentRem();
    let parentRem = await currentRem.getParentRem();
    //parentClass && console.log("Current Rem: " + getRemText(parentClass));
    //parentRem && console.log("Parent Rem: " + getRemText(parentRem));

    let edgeLabel = "";

    // Search for parent rem that is not referencing
    while (parentNonRefRem && parentRem) {
      if(!(await isReferencingRem(plugin, parentNonRefRem))) { // && (getRemText(parentClass) == getRemText(parentRem))
        //
        break;
      }
      else {
        edgeLabel == "" ? edgeLabel = (await getRemText(plugin, (await parentNonRefRem.remsBeingReferenced())[0])).trim() : edgeLabel = (await getRemText(plugin, (await parentNonRefRem.remsBeingReferenced())[0])).trim() + "-" + edgeLabel;
        parentNonRefRem = await parentNonRefRem?.getParentRem();
      }
    }

    // I cant remember why i did that
    if(parentNonRefRem && parentRem && (parentNonRefRem._id == parentRem._id)) {
      currentRem = parentRem; //(await currentRem.getTagRems())[0];
      index++;
      continue;
    }

    if(!parentNonRefRem) return;

    // if property class is itself a property class
    let j = 1;
    let propRef = parentNonRefRem;
    while(await isRemProperty(plugin, propRef)) {
      //collectParentProperties(parentNonRefRem, nodesMap, edges);

      // Get x rem: x -> Eigenschaften -> parentNonRef:
      let p = (await(await propRef.getParentRem() as Rem).getParentRem()) as Rem;

      const position = { x: -(nodeWidth + spacing_x) * ( j + 1), y: -(nodeHeight + spacing_y) * (index + j + 1)+spacing_y};
      const data = { label: await getRemText(plugin, p), width: 150, height: 50 };
      nodesMap.set(p._id, { rem: p, type: "parentProperty", position, data });
      edges.add({
        id: `${p._id}-${propRef._id}`,
        source: p._id,
        target: propRef._id,
        label: edgeLabel,
        type: "smoothstep",
        sourceHandle: "bottom",
        targetHandle: "left",  
      });

      propRef = p;

      j++;
    }

    //console.log("getNonReferencingParent returned: " + getRemText(parentClass));
    const position = { x: -(nodeWidth + spacing_x) * ( + 1), y: -(nodeHeight + spacing_y) * (index + 1)+spacing_y*0.8 };
    const data = { label: await getRemText(plugin, parentNonRefRem), width: 150, height: 50 };
    nodesMap.set(parentNonRefRem._id, { rem: parentNonRefRem, type: "parentProperty", position, data });
    edges.add({
      id: `${parentNonRefRem._id}-${currentRem._id}`,
      source: parentNonRefRem._id,
      target: currentRem._id,
      label: edgeLabel,
      type: "smoothstep",
      sourceHandle: "bottom",
      targetHandle: "left",  
    });

    // increment
    //currentRem = parent;
    //currentRem = (await currentRem.getTagRems())[0];
    currentRem = (await getNextParents(plugin, currentRem))[0]

    if((await getRemText(plugin, currentRem)).search("L_") != -1 || (await getRemText(plugin, currentRem)).search("C_") != -1)
      break;
    
    index++;
  } 
}

// Collect Children
async function collectChildren(
  plugin: RNPlugin,
  rem: Rem,
  depth: number,
  nodesMap: Map<string, { rem: Rem; type: string; depth?: number; position: { x: number; y: number }; data: NodeData }>,
  edges: Set<Edge>,
  y_offset: number,
  applyOffset: boolean = true
) {
  const nodeWidth = 150; // Width of each node
  const nodeHeight = 50; // Height of each node
  const spacing = 50;   // Spacing between nodes

  // Stop recursion if depth limit is reached
  if (depth <= 0) {
    return;
  }

  // Get the parent's position from nodesMap (assumes rem is already added)
  let parentPosition = nodesMap.get(rem._id)?.position ?? { x: 0, y: 0 };

  // Fetch the children of the current rem
  let children = await rem.taggedRem();

  //
  const childrenRem = await rem.getChildrenRem();

  for(const c of childrenRem) {
      if(!(await isReferencingRem(plugin, c)) && !specialNames.includes(await getRemText(plugin, c))) 
        children.push(c);
  }

  // Process each child with an index for horizontal positioning
  for (let i = 0; i < children.length; i++) {
    const child = children[i];

    // Add child to nodesMap if not already present
    if (!nodesMap.has(child._id)) {
      // Calculate x-position: center children below parent
      const x = parentPosition.x + (i - (children.length - 1) / 2) * (nodeWidth + spacing);
      
      // Calculate y-position: place children below parent, with offset if applyOffset is true
      const y = parentPosition.y + nodeHeight + spacing + (applyOffset ? y_offset : 0);
      const position = { x, y };

      const data = { label: await getRemText(plugin, child), width: 150, height: 50 };
      nodesMap.set(child._id, { 
        rem: child, 
        type: "child",
        position, 
        data 
      });
    }

    // Add edge from parent to child
    edges.add({
      id: `${rem._id}-${child._id}`,
      source: rem._id,
      target: child._id,
      type: "smoothstep",
      sourceHandle: "bottom",
      targetHandle: "top",
      pathOptions: {
        offset: 1,
        borderRadius: 100
      }
    } as any);

    // Recursively process the child's children, with applyOffset set to false
    await collectChildren(plugin, child, depth - 1, nodesMap, edges, y_offset, false);
  }
}

// Collect Child Properties
/*
async function collectProperties(
  plugin: RNPlugin,
  selectedRem: Rem,
  nodesMap: Map<string, { rem: Rem; type: string; position: { x: number; y: number }; data: NodeData }>,
  edges: Set<Edge>,
  includeQuestions: boolean,
  includeRefs: boolean
) {
  const lineHeight = 20;
  const spacing_x = 250;   // Horizontal spacing between nodes
  const spacing_y = 20;    // Vertical spacing between nodes

  // Get the position of the selectedRem node
  const selectedEntry = nodesMap.get(selectedRem._id);
  if (!selectedEntry) return; // Exit if selectedRem is not in nodesMap
  const selectedPosition = selectedEntry.position;

  // Initialize the starting y position
  let currentY = selectedPosition.y + 17;

  // Collect references if includeRefs is true
  let propertiesNRefs = includeRefs ? (await selectedRem.remsReferencingThis()) : [];

  // Search for the "Eigenschaften" (properties) rem among children
  const propertyRem = await selectedRem.getChildrenRem();
  for (const child of propertyRem) {
    if (await referencesEigenschaften(plugin, child)) {
      propertiesNRefs = [...propertiesNRefs, ...await child.getChildrenRem()];
      break;
    }
  }

  // Filter out special names
  propertiesNRefs = propertiesNRefs.filter(async (r: Rem) => !specialNames.includes(await getRemText(plugin, r)));

  // Compute card status for all rems to identify questions
  const remsWithCardStatus = await Promise.all(
    propertiesNRefs.map(async (r) => ({
      rem: r,
      hasCards: (await r.getCards()).length > 0,
    }))
  );

  // Separate into non-questions and questions
  const nonQuestions = remsWithCardStatus
    .filter(({ hasCards }) => !hasCards)
    .map(({ rem }) => rem);
  const questions = remsWithCardStatus
    .filter(({ hasCards }) => hasCards)
    .map(({ rem }) => rem);

  // Helper function to add a node and edge
  async function addNode(propChild: Rem, type: string) {
    if (!nodesMap.has(propChild._id)) {
      const text = await getRemText(plugin, propChild);
      const lines = 1; // Assuming single-line text; adjust if calculateLines is implemented
      const height = lineHeight * lines;
      const width = calculateTextWidth(text);
      const position = { x: selectedPosition.x + spacing_x, y: currentY };
      const data = { label: text, width, height };

      // Add the node to nodesMap
      nodesMap.set(propChild._id, { rem: propChild, type, position, data });

      // Add the edge from selectedRem to this node
      edges.add({
        id: `${selectedRem._id}-${propChild._id}`,
        source: selectedRem._id,
        target: propChild._id,
        type: "smoothstep",
        sourceHandle: "right",
        targetHandle: "left",
      });

      // Update currentY for the next node
      currentY += height + spacing_y;
    }
  };

  // Add non-question properties first
  for (const propChild of nonQuestions) {
    addNode(propChild, "property");
  }

  // Add questions after non-questions if includeQuestions is true
  if (includeQuestions) {
    for (const propChild of questions) {
      addNode(propChild, "propertyQuestion");
    }
  }
}
*/
async function collectProperties(
  plugin: RNPlugin,
  selectedRem: Rem,
  nodesMap: Map<string, { rem: Rem; type: string; position: { x: number; y: number }; data: NodeData }>,
  edges: Set<Edge>,
  includeQuestions: boolean,
  includeRefs: boolean
) {
  const lineHeight = 20;
  const spacing_x = 250;   // Horizontal spacing between nodes
  const spacing_y = 20;    // Vertical spacing between nodes

  const selectedEntry = nodesMap.get(selectedRem._id);
  if (!selectedEntry) return;
  const selectedPosition = selectedEntry.position;

  let currentY = selectedPosition.y + 17;

  let propertiesNRefs = includeRefs ? (await selectedRem.remsReferencingThis()) : [];

  const propertyRem = await selectedRem.getChildrenRem();
  for (const child of propertyRem) {
    if (await referencesEigenschaften(plugin, child)) {
      propertiesNRefs = [...propertiesNRefs, ...await child.getChildrenRem()];
      break;
    }
  }

  // Filter Special Rems
  const filterResults = await Promise.all(
    propertiesNRefs.map(async (r) => {
      const text = await getRemText(plugin, r);
      return !specialNames.some(specialName => text.includes(specialName));
    })
  );
  propertiesNRefs = propertiesNRefs.filter((_, index) => filterResults[index]);

  // Filter Cards
  const remsWithCardStatus = await Promise.all(
    propertiesNRefs.map(async (r) => ({
      rem: r,
      hasCards: (await r.getCards()).length > 0,
    }))
  );

  const nonQuestions = remsWithCardStatus
    .filter(({ hasCards }) => !hasCards)
    .map(({ rem }) => rem);
  const questions = remsWithCardStatus
    .filter(({ hasCards }) => hasCards)
    .map(({ rem }) => rem);

  async function addNode(propChild: Rem, type: string) {
    if (!nodesMap.has(propChild._id)) {
      const text = await getRemText(plugin, propChild);
      const lines = 1;
      const height = lineHeight * lines;
      const width = calculateTextWidth(text);
      const position = { x: selectedPosition.x + spacing_x, y: currentY };
      const data = { label: text, width, height };

      nodesMap.set(propChild._id, { rem: propChild, type, position, data });

      edges.add({
        id: `${selectedRem._id}-${propChild._id}`,
        source: selectedRem._id,
        target: propChild._id,
        type: "smoothstep",
        sourceHandle: "right",
        targetHandle: "left",
      });

      currentY += height + spacing_y;
    }
  };

  // Await all addNode calls
  await Promise.all(nonQuestions.map(propChild => addNode(propChild, "property")));

  if (includeQuestions) {
    await Promise.all(questions.map(propChild => addNode(propChild, "propertyQuestion")));
  }
}

// Build Graph with Node<NodeData> Array

async function buildGraph(plugin: RNPlugin, selectedRem: Rem, includeQuestions: boolean, includeRefs: boolean) {
  const nodesMap = new Map<string, { rem: Rem; type: string; depth?: number; position: { x: number; y: number }; data: NodeData }>();
  const edges = new Set<Edge>();

  const focusedPosition = { x: 0, y: 0 };
  const focusedData = { label: await getRemText(plugin, selectedRem), width: 150, height: 50 };
  nodesMap.set(selectedRem._id, { 
    rem: selectedRem, 
    type: "focused", 
    position: focusedPosition, 
    data: focusedData 
  });

  await collectProperties(plugin, selectedRem, nodesMap, edges, includeQuestions, includeRefs);

  await collectParents(plugin, selectedRem, selectedRem, 100, nodesMap, edges);

  await collectParentProperties(plugin, selectedRem, nodesMap, edges);

  await collectChildren(plugin, selectedRem, 100, nodesMap, edges, highestYPosition(nodesMap) + 50, true);

  const nodeArray: Node<NodeData>[] = Array.from(nodesMap.values()).map(({ rem, type, position, data }) => {
    return {
      id: rem._id, // Changed to rem._id
      type,
      data,
      position,
      draggable: true,
    };
  });

  return { nodes: nodeArray, edges: Array.from(edges) };
}
  

/*
async function buildGraph(selectedRem: Rem, ancestorDepth = 10, descendantDepth = 10) {
  const nodesMap = new Map<string, { rem: Rem; type: string; position: { x: number; y: number }; data: NodeData }>();
  const edges = new Set<Edge>();

  const focusedPosition = { x: 0, y: 0 };
  const focusedData = { label: getRemText(selectedRem), width: 150, height: 50 };
  nodesMap.set(selectedRem._id, { 
    rem: selectedRem, 
    type: "focused", 
    position: focusedPosition, 
    data: focusedData 
  });

  await collectChildProperties(selectedRem, nodesMap, edges);
  await collectParentProperties(selectedRem, nodesMap, edges);
  await collectParents(selectedRem, ancestorDepth, nodesMap, edges);
  await collectChildren(selectedRem, descendantDepth, nodesMap, edges);

  const nodeArray: Node<NodeData>[] = Array.from(nodesMap.values()).map(({ rem, type, position, data }) => ({
    id: rem._id,
    type,
    data,
    position: { x: 0, y: 0 }, // Temporary position
    draggable: true,
  }));

  const edgeArray: Edge[] = Array.from(edges);

  if (nodeArray.length === 0) {
    console.error("No nodes to layout");
    return { nodes: [], edges: [] };
  }

  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setGraph({ rankdir: 'TB', ranksep: 50, nodesep: 50 }); // Adjust spacing

  nodeArray.forEach(node => {
    if (!node.data.width || !node.data.height) {
      console.error(`Node ${node.id} missing width or height`);
      node.data.width = 150;
      node.data.height = 50;
    }
    dagreGraph.setNode(node.id, { width: node.data.width, height: node.data.height });
  });

  edgeArray.forEach(edge => {
    if (!nodeArray.some(n => n.id === edge.source) || !nodeArray.some(n => n.id === edge.target)) {
      console.error(`Edge ${edge.id} references non-existent nodes`);
      return;
    }
    dagreGraph.setEdge(edge.source, edge.target);
  });

  // Check for cycles
  if (!graphlib.isAcyclic(dagreGraph)) {
    console.warn("Graph contains cycles. Attempting to remove them for layout.");
    const cycles = dagre.graphlib.alg.findCycles(dagreGraph);
    cycles.forEach(cycle => {
      // Remove one edge from each cycle (e.g., between first and second node)
      const edgeToRemove = { v: cycle[0], w: cycle[1] };
      console.log(`Removing edge ${edgeToRemove.v} -> ${edgeToRemove.w} to break cycle`);
      dagreGraph.removeEdge(edgeToRemove.v, edgeToRemove.w);
    });
  }

  try {
    dagre.layout(dagreGraph);
  } catch (error) {
    console.error("Dagre layout failed:", error);
    return { nodes: nodeArray, edges: edgeArray }; // Fallback positions
  }

  nodeArray.forEach(node => {
    const nodeWithPosition = dagreGraph.node(node.id);
    if (nodeWithPosition && Number.isFinite(nodeWithPosition.x) && Number.isFinite(nodeWithPosition.y)) {
      node.position = {
        x: nodeWithPosition.x - node.data.width / 2,
        y: nodeWithPosition.y - node.data.height / 2,
      };
    } else {
      console.error(`Invalid position for node ${node.id}`, nodeWithPosition);
      node.position = { x: 0, y: 0 };
    }
  });

  console.log("Nodes after Dagre:", nodeArray);
  return { nodes: nodeArray, edges: edgeArray };
}
  */

// ### Main Widget Component
/*
function InheritanceWidget() {
  // Corrected: Type parameter is the element type, not the array type
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<NodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const focusedRem = useTracker((reactPlugin) => reactPlugin.focus.getFocusedRem());

  useEffect(() => {
    const fetchAndRenderGraph = async () => {
      if (focusedRem) {
        const { nodes: graphNodes, edges: graphEdges } = await buildGraph(focusedRem, 10, 10);
        setNodes(graphNodes);
        setEdges(graphEdges);
      } else {
        setNodes([]);
        setEdges([]);
      }
    };
    fetchAndRenderGraph().catch((error) => {
      console.error("useEffect: Error in fetchAndRenderGraph", error);
    });
  }, [focusedRem, setNodes, setEdges]);

  return (
    <div style={{ height: "100%", width: "100%" }}>
      {focusedRem ? (
        <ReactFlowProvider>
          <GraphComponent<Node<NodeData>>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
          />
        </ReactFlowProvider>
      ) : (
        <div>No Rem selected</div>
      )}
    </div>
  );
}
  */

function InheritanceWidget() {
  const plugin = usePlugin();

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<NodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Track the selected Rem ID from session storage instead of focusedRem
  const selectedRemId = useTracker((reactPlugin) => reactPlugin.storage.getSession('selectedRemId'));

  // 
  const [includeQuestions, setIncludeQuestions] = useState(true);
  const [includeRefs, setIncludeRefs] = useState(true);

  useEffect(() => {
    const fetchAndRenderGraph = async () => {
      if (selectedRemId) {
        const selectedRem = await plugin.rem.findOne(selectedRemId as string);
        if (selectedRem) {
          const { nodes: graphNodes, edges: graphEdges } = await buildGraph(plugin, selectedRem, includeQuestions, includeRefs);
          setNodes(graphNodes);
          setEdges(graphEdges);
        } else {
          setNodes([]);
          setEdges([]);
        }
      } else {
        setNodes([]);
        setEdges([]);
      }
    };
    fetchAndRenderGraph().catch((error) => {
      console.error("useEffect: Error in fetchAndRenderGraph", error);
    });
  }, [selectedRemId, includeQuestions, includeRefs, setNodes, setEdges, plugin]);

  return (
    <div
      className="h-full w-full overflow-y-auto rn-clr-background-primary hover:bg-gray-400"
      onMouseDown={(e) => e.stopPropagation()}>
      {/* Toolbar */}
      <div className="flex gap-2">
      <MyRemNoteButton
        img="M9 2.221V7H4.221a2 2 0 0 1 .365-.5L8.5 2.586A2 2 0 0 1 9 2.22ZM11 2v5a2 2 0 0 1-2 2H4v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2h-7Z"
        text="Open Rem in Editor"
        onClick={async () => {
          const remId = await plugin.storage.getSession('selectedRemId')
          await plugin.window.openRem((await plugin.rem.findOne(remId as string)) as Rem)
        }}
      />
      <MyRemNoteButton
        img="M17.651 7.65a7.131 7.131 0 0 0-12.68 3.15M18.001 4v4h-4m-7.652 8.35a7.13 7.13 0 0 0 12.68-3.15M6 20v-4h4"
        text="Refresh"
        onClick={async () => {
          const remId = await plugin.storage.getSession('selectedRemId')
          await plugin.storage.setSession('selectedRemId', 0);
          await plugin.storage.setSession('selectedRemId', remId);
        }}
      />
      <label className="flex items-center gap-1">
        <input
          type="checkbox"
          checked={includeQuestions}
          onChange={(e) => setIncludeQuestions(e.target.checked)}
          className="h-4 w-4"
        />
        <span className="text-gray-800 dark:text-white">Include Questions</span>
      </label>
      <label className="flex items-center gap-1">
        <input
          type="checkbox"
          checked={includeRefs}
          onChange={(e) => setIncludeRefs(e.target.checked)}
          className="h-4 w-4"
        />
        <span className="text-gray-800 dark:text-white">Include Refs</span>
      </label>
      <MyRemNoteButton
        img="M5 12h14M5 12l4-4m-4 4 4 4"
        text="Back"
        onClick={async () => {
          // TODO
        }}
      />
      <MyRemNoteButton
        img="M19 12H5m14 0-4 4m4-4-4-4"
        text="Forward"
        onClick={async () => {
          // TODO
        }}
      />
      </div>
      <div style={{ height: "100%", width: "100%" }}>
        {selectedRemId ? (
          <ReactFlowProvider>
            <GraphComponent<Node<NodeData>>
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
            />
          </ReactFlowProvider>
        ) : (
          <div>Execute the 'Display Graph' command to show the graph for the selected Rem.</div>
        )}
      </div>
    </div>
  );
}

renderWidget(InheritanceWidget);