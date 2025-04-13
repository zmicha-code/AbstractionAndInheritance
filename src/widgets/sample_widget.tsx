import React, { useState, useEffect, useCallback } from "react";
import { ReactFlow, Node, Edge, SmoothStepEdge, useReactFlow, ReactFlowProvider, Handle, Position, useNodesState, useEdgesState } from "@xyflow/react";
import { renderWidget, useTracker, Rem, usePlugin, RNPlugin, RemType, Queue } from "@remnote/plugin-sdk";

import {  specialTags, specialNames, highlightColorMap, DEFAULT_NODE_COLOR, FOCUSED_NODE_STYLE, calculateLines,
          getRemText, getNextParents, referencesEigenschaften, isReferencingRem,
          isNextParent, isRemProperty, getNonReferencingParent, highestXPosition,
          highestYPosition, calculateTextWidth,
          lowestYPosition
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
  edges: Set<Edge>,
  yStart: number = 0
) {
  const nodeWidth = 150; // Example width
  const nodeHeight = 50; // Example height
  const spacing_x = 120; 
  const spacing_y = 120;  // Example spacing between nodes
  if (depth <= 0) {
    return;
  }

  let childPosition = nodesMap.get(rem._id)?.position ?? { x: 0, y: 0 };

  let yOffset = yStart != 0 ? yStart : childPosition.y; // Offset

  let parents = await getNextParents(plugin, rem);

  //
  // Filter out special Rems
  const filterSpecial = async (rems: Rem[]) => {
    const filterResults = await Promise.all(
      rems.map(async (r) => {
        const text = await getRemText(plugin, r);
        return !specialNames.some(specialName => text.includes(specialName));
      })
    );
    return rems.filter((_, index) => filterResults[index]);
  };

  parents = await filterSpecial(parents);

  for (let i = 0; i < parents.length; i++) {
    const parent = parents[i];

    if (!nodesMap.has(parent._id)) {
      const x = childPosition.x + (i - (parents.length - 1) / 2) * (nodeWidth + spacing_x);
      const y = yOffset - nodeHeight - spacing_y;
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
/*
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

    let parentNonRefRem = await currentRem.getParentRem();
    let parentRem = await currentRem.getParentRem();

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
*/
async function collectParentProperties(
  plugin: RNPlugin,
  currentRem: Rem | undefined,
  nodesMap: Map<string, { rem: Rem; type: string; position: { x: number; y: number }; data: NodeData }>,
  edges: Set<Edge>,
  yStart: number = 0
) {
  const nodeWidth = 150; // Example width
  const nodeHeight = 50; // Example height
  const spacing_x = 120; 
  const spacing_y = 120;  // Example spacing between nodes
  let index = 0;

  while(true) {

    if (!currentRem) return;

    let parentConceptRem = await currentRem.getParentRem();
    let parentRem = await currentRem.getParentRem();

    let edgeLabel = "";

    // Search for parent concept
    while (parentConceptRem && parentRem) {
      if(!(await isReferencingRem(plugin, parentConceptRem)) && (await parentConceptRem.getType() == RemType.CONCEPT)) { // && (getRemText(parentClass) == getRemText(parentRem))
        //
        break;
      }
      else {
        //edgeLabel == "" ? edgeLabel = (await getRemText(plugin, (await parentConceptRem.remsBeingReferenced())[0])).trim() : edgeLabel = (await getRemText(plugin, (await parentConceptRem.remsBeingReferenced())[0])).trim() + "-" + edgeLabel;
        //edgeLabel = (await getRemText(plugin, parentConceptRem));
        edgeLabel == "" ? edgeLabel = (await getRemText(plugin, parentConceptRem)).trim() : edgeLabel = (await getRemText(plugin, parentConceptRem)).trim() + "-" + edgeLabel;
        parentConceptRem = await parentConceptRem?.getParentRem();
      }
    }

    // I cant remember why i did that
    if(parentConceptRem && parentRem && (parentConceptRem._id == parentRem._id)) {
      currentRem = parentRem; //(await currentRem.getTagRems())[0];
      index++;
      continue;
    }

    if(!parentConceptRem) return;

    // I DONT KNOW WHY THIS
    // if property class is itself a property class
    /*
    let j = 1;
    let propRef = parentConceptRem;
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
    */

    //console.log("getNonReferencingParent returned: " + getRemText(parentClass));
    const position = { x: -(nodeWidth + spacing_x) * ( + 1), y: -(nodeHeight + spacing_y) * (index + 1)+spacing_y*0.8+yStart };
    const data = { label: await getRemText(plugin, parentConceptRem), width: 150, height: 50 };
    nodesMap.set(parentConceptRem._id, { rem: parentConceptRem, type: "parentProperty", position, data });
    edges.add({
      id: `${parentConceptRem._id}-${currentRem._id}`,
      source: parentConceptRem._id,
      target: currentRem._id,
      label: edgeLabel,
      type: "smoothstep",
      sourceHandle: "bottom",
      targetHandle: "left",  
    });

    currentRem = (await getNextParents(plugin, currentRem))[0]

    //if((await getRemText(plugin, currentRem)).search("L_") != -1 || (await getRemText(plugin, currentRem)).search("C_") != -1)
    //  break;
    
    index++;
  } 
}

// Collect Children
// Builds the Graph Top-to-Bottom
/*
async function collectChildren(
  plugin: RNPlugin,
  rem: Rem,
  depth: number,
  nodesMap: Map<string, { rem: Rem; type: string; depth?: number; position: { x: number; y: number }; data: NodeData }>,
  edges: Set<Edge>,
  y_offset: number,
  applyYOffset: boolean = true,
  x_offset: number = 0
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

  // Filter
  for(const c of childrenRem) {
      if(!(await isReferencingRem(plugin, c)) &&
          (await c.getType() == RemType.CONCEPT) && 
         !specialNames.includes(await getRemText(plugin, c))) 
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
      const y = parentPosition.y + nodeHeight + spacing + (applyYOffset ? y_offset : 0);
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
//      pathOptions: {
//        offset: 1,
//        borderRadius: 100
//      }
    } as any);

    // Recursively process the child's children, with applyOffset set to false
    await collectChildren(plugin, child, depth - 1, nodesMap, edges, y_offset, false);
  }
}
*/
async function getSubtreeWidth(plugin: RNPlugin, rem: Rem, depth: number): Promise<number> {
  const nodeWidth = 150; // Width of each node
  const spacing = 50;   // Spacing between nodes

  // Base case: leaf node or depth limit reached
  if (depth <= 0) {
    return nodeWidth;
  }

  // Fetch children (same filtering as in collectChildren)
  let children = await rem.taggedRem();
  const childrenRem = await rem.getChildrenRem();
  for (const c of childrenRem) {
    if (!(await isReferencingRem(plugin, c)) &&
        (await c.getType() === RemType.CONCEPT) &&
        !specialNames.includes(await getRemText(plugin, c))) {
      children.push(c);
    }
  }

  // If no children, it's a leaf node
  if (children.length === 0) {
    return nodeWidth;
  }

  // Recursively compute subtree widths for all children
  const subtreeWidths = await Promise.all(
    children.map(child => getSubtreeWidth(plugin, child, depth - 1))
  );

  // Total width is the sum of subtree widths plus spacing between them
  return subtreeWidths.reduce((sum, w) => sum + w, 0) + (children.length - 1) * spacing;
}

async function collectChildren(
  plugin: RNPlugin,
  rem: Rem,
  depth: number,
  nodesMap: Map<string, { rem: Rem; type: string; depth?: number; position: { x: number; y: number }; data: NodeData }>,
  edges: Set<Edge>,
  y_offset: number,
  applyYOffset: boolean = true
) {
  const nodeWidth = 150; // Width of each node
  const nodeHeight = 50; // Height of each node
  const spacing = 50;   // Spacing between nodes

  // Stop recursion if depth limit is reached
  if (depth <= 0) {
    return;
  }

  // Get the parent's position
  let parentPosition = nodesMap.get(rem._id)?.position ?? { x: 0, y: 0 };

  // Fetch the children
  let children = await rem.taggedRem();
  const childrenRem = await rem.getChildrenRem();
  for (const c of childrenRem) {
    if (!(await isReferencingRem(plugin, c)) &&
        (await c.getType() === RemType.CONCEPT) &&
        !specialNames.includes(await getRemText(plugin, c))) {
      children.push(c);
    }
  }

  // If there are children, position them based on subtree widths
  if (children.length > 0) {
    // Compute subtree widths for all children
    const subtreeWidths = await Promise.all(
      children.map(child => getSubtreeWidth(plugin, child, depth - 1))
    );

    // Calculate the total width of the children row
    const totalWidth = subtreeWidths.reduce((sum, w) => sum + w, 0) + (children.length - 1) * spacing;

    // Start positioning from the leftmost point, centered under the parent
    let currentX = parentPosition.x - totalWidth / 2;

    // Position each child
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      // Place the child at the center of its subtree
      const childX = currentX + subtreeWidths[i] / 2;
      const childY = parentPosition.y + nodeHeight + spacing + (applyYOffset ? y_offset : 0);
      const position = { x: childX, y: childY };

      // Add child to nodesMap if not already present
      if (!nodesMap.has(child._id)) {
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

      // Recursively process the child's children
      await collectChildren(plugin, child, depth - 1, nodesMap, edges, y_offset, false);

      // Move to the next position
      currentX += subtreeWidths[i] + spacing;
    }
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
  // Refs can appear in questions and in answers
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
  const spacing_x = 300;   // Horizontal spacing between nodes
  const spacing_y = 20;    // Vertical spacing between nodes

  const selectedEntry = nodesMap.get(selectedRem._id);
  if (!selectedEntry) return;
  const selectedPosition = selectedEntry.position;

  // Collect local properties (children of "Eigenschaften" subcategory)
  let localProperties: Rem[] = [];
  const propertyRems = await selectedRem.getChildrenRem();
  for (const child of propertyRems) {
    //if (await referencesEigenschaften(plugin, child)) {
    console.log(await getRemText(plugin, child));
    if((await getRemText(plugin, child)).search("Eigenschaften") != -1 || await referencesEigenschaften(plugin, child)) {
      localProperties = await child.getChildrenRem();
      break;
    }
  }

  // Collect referencing Rems
  let referencingRems = includeRefs ? await selectedRem.remsReferencingThis() : [];

  // Filter out special Rems
  const filterSpecial = async (rems: Rem[]) => {
    const filterResults = await Promise.all(
      rems.map(async (r) => {
        const text = await getRemText(plugin, r);
        return !specialNames.some(specialName => text.includes(specialName));
      })
    );
    return rems.filter((_, index) => filterResults[index]);
  };

  localProperties = await filterSpecial(localProperties);
  referencingRems = await filterSpecial(referencingRems);

  // Classify local Rems
  const localRemsWithCardStatus = await Promise.all(
    localProperties.map(async (r) => ({
      rem: r,
      hasCards: (await r.getCards()).length > 0,
    }))
  );
  const localNormal = localRemsWithCardStatus.filter(({ hasCards }) => !hasCards).map(({ rem }) => rem);
  const localQuestions = localRemsWithCardStatus.filter(({ hasCards }) => hasCards).map(({ rem }) => rem);

  // Classify referencing Rems into questions and answers
  const referencingQuestions = [];
  const referencingAnswers = [];
  for (const r of referencingRems) {
    if ((await r.getCards()).length > 0) {
      referencingQuestions.push(r);
    } else {
      const parent = await r.getParentRem();
      if (parent && (await parent.getCards()).length > 0) {
        referencingAnswers.push(r);
      }
    }
  }

  // Collect all main nodes to be added
  const allMainNodes = [
    ...localNormal,
    ...(includeQuestions ? localQuestions : []),
    ...referencingQuestions,
    ...referencingAnswers,
  ];

  // Fetch their texts
  const nodeTexts = await Promise.all(allMainNodes.map((rem) => getRemText(plugin, rem)));

  // Calculate their heights
  const heights = nodeTexts.map((text) => {
    const lines = Math.ceil(text.length / 10); // Adjust as needed
    return lineHeight * lines;
  });

  // Calculate total height including spacing
  const totalHeight = heights.reduce((sum, h) => sum + h, 0) + Math.max(0, allMainNodes.length - 1) * spacing_y;

  // Set initial Y position to center the stack around selectedPosition.y
  let currentY = selectedPosition.y - totalHeight / 2;

  // Function to add a node
  async function addNode(rem: Rem, type: string, position: {x: number, y:number}) {
    if (!nodesMap.has(rem._id)) {
      const text = await getRemText(plugin, rem);
      const lines = text.length / 10; // TODO
      const height = lineHeight * lines;
      const width = 300;//calculateTextWidth(text);
      const data = { label: text, width, height };
      nodesMap.set(rem._id, { rem, type, position, data });
    }
  }

  // Add local normal Rems
  for (const prop of localNormal) {
    const position = { x: selectedPosition.x + spacing_x, y: currentY };
    await addNode(prop, "property", position);
    edges.add({
      id: `${selectedRem._id}-${prop._id}`,
      source: selectedRem._id,
      target: prop._id,
      type: "smoothstep",
      sourceHandle: "right",
      targetHandle: "left",
    });
    currentY += lineHeight * ((await getRemText(plugin, prop)).length / 10) + spacing_y;
  }

  // Add local questions if includeQuestions is true
  if (includeQuestions) {
    for (const prop of localQuestions) {
      const position = { x: selectedPosition.x + spacing_x, y: currentY };
      await addNode(prop, "propertyQuestion", position);
      edges.add({
        id: `${selectedRem._id}-${prop._id}`,
        source: selectedRem._id,
        target: prop._id,
        type: "smoothstep",
        sourceHandle: "right",
        targetHandle: "left",
      });
      currentY += lineHeight * ((await getRemText(plugin, prop)).length / 10) + spacing_y;
    }
  }

  // Add referencing questions with their parent
  for (const q of referencingQuestions) {
    const position = { x: selectedPosition.x + spacing_x, y: currentY };
    await addNode(q, "propertyRefQuestion", position);
    edges.add({
      id: `${selectedRem._id}-${q._id}`,
      source: selectedRem._id,
      target: q._id,
      type: "smoothstep",
      sourceHandle: "right",
      targetHandle: "left",
    });
    // Add parent node
    let parent = await q.getParentRem();
    let edgeLabel = "";

    if(parent && (await isReferencingRem(plugin, parent))) {
      edgeLabel = (await getRemText(plugin, parent)).trim();

      parent = await parent.getParentRem();
    }

    if (parent) {
      const parentPosition = { x: selectedPosition.x + 2.2 * spacing_x, y: currentY };
      await addNode(parent, "parent", parentPosition);
      edges.add({
        id: `${q._id}-${parent._id}`,
        label: edgeLabel,
        source: parent._id,
        target: q._id,
        type: "smoothstep",
        sourceHandle: "bottom",
        targetHandle: "right",
      });
    }
    currentY += lineHeight * ((await getRemText(plugin, q)).length / 10) + spacing_y;
  }

  // Add referencing answers with their parent question
  for (const a of referencingAnswers) {
    const position = { x: selectedPosition.x + spacing_x, y: currentY };
    await addNode(a, "propertyRefAnswer", position);
    edges.add({
      id: `${selectedRem._id}-${a._id}`,
      source: selectedRem._id,
      target: a._id,
      type: "smoothstep",
      sourceHandle: "right",
      targetHandle: "left",
    });
    // Add parent question node
    const parentQuestion = await a.getParentRem();
    if (parentQuestion) {
      const questionPosition = { x: selectedPosition.x + 2.2 * spacing_x, y: currentY };
      await addNode(parentQuestion, "propertyQuestion", questionPosition);
      edges.add({
        id: `${a._id}-${parentQuestion._id}`,
        source: parentQuestion._id,
        target: a._id,
        type: "smoothstep",
        sourceHandle: "left",
        targetHandle: "right",
      });
    }
    currentY += lineHeight * ((await getRemText(plugin, a)).length / 10) + spacing_y;
  }
}

// Build Graph with Node<NodeData> Array
async function buildGraph(plugin: RNPlugin, selectedRem: Rem, includeQuestions: boolean, includeRefs: boolean) {
  const nodesMap = new Map<string, { rem: Rem; type: string; depth?: number; position: { x: number; y: number }; data: NodeData }>();
  const edges = new Set<Edge>();

  //
  const focusedPosition = { x: 0, y: 0 };
  const focusedData = { label: await getRemText(plugin, selectedRem), width: 150, height: 50 };
  nodesMap.set(selectedRem._id, { 
    rem: selectedRem, 
    type: "focused", 
    position: focusedPosition, 
    data: focusedData 
  });

  //
  await collectProperties(plugin, selectedRem, nodesMap, edges, includeQuestions, includeRefs);

  let lowestPropertiesY = lowestYPosition(nodesMap)

  //
  await collectParents(plugin, selectedRem, selectedRem, 100, nodesMap, edges, lowestPropertiesY);

  //
  await collectParentProperties(plugin, selectedRem, nodesMap, edges, lowestPropertiesY);

  //
  await collectChildren(plugin, selectedRem, 1, nodesMap, edges, highestYPosition(nodesMap) + 75, true);

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

  // onNodeClick={handleNodeClick}
  async function onNodeClick<T extends Node>(_event: React.MouseEvent, node: T) {
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

  // In your React component
  //const onNodeContextMenu = (event, node) => {
  async function onNodeContextMenu<T extends Node>(event: React.MouseEvent, node: T) {
    event.preventDefault(); // Prevent the default context menu
    //expandNode(plugin, node.id);
  };


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
              onNodeClick={onNodeClick}
              onContextMenu={onNodeContextMenu}
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