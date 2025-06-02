import React, { useState, useEffect, useCallback } from "react";
import { ReactFlow, Node, Edge, SmoothStepEdge, useReactFlow, ReactFlowProvider, Handle, Position, useNodesState, useEdgesState } from "@xyflow/react";
import { renderWidget, useTracker, Rem, usePlugin, RNPlugin, RemType, Queue } from "@remnote/plugin-sdk";

import { specialTags, specialNames, highlightColorMap, DEFAULT_NODE_COLOR, FOCUSED_NODE_STYLE,
          getRemText, getNextParents, referencesEigenschaften, isReferencingRem,
          isNextParent, isRemProperty, getNonReferencingParent, highestXPosition,
          highestYPosition, calcNodeHeight2, lowestYPosition,
          isAncestor_,
          getTagParent,
          getNextChildren,
          formatIfLayerConcept
} from "../utils/utils";

import { GraphComponent } from "../components/GraphComponent";
import MyRemNoteButton from "../components/MyRemNoteButton";
import {
  FocusedRemNode,
  ParentNode,
  ChildNode,
  PropertyNode,
  ParentPropertyNode,
  NodeData,
  nodeTypes
} from "../components/Nodes";

import "@xyflow/react/dist/style.css";

const specialLayerNames = ["Aliases", "query", "Status"];

// Filter out special Rems
async function filterSpecial(plugin: RNPlugin, rems: Rem[]) {
  const filterResults = await Promise.all(
    rems.map(async (r) => {
      const text = await getRemText(plugin, r);
      return !specialNames.some(specialName => text.includes(specialName));
    })
  );
  return rems.filter((_, index) => filterResults[index]);
};

function calcNodeWidth(txt: string) {
  return 200;
}

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
  const spacing_x = 120; 
  const spacing_y = 120;  // Example spacing between nodes

  if (depth <= 0) {
    return;
  }

  let childPosition = nodesMap.get(rem._id)?.position ?? { x: 0, y: 0 };

  let yOffset = yStart != 0 ? yStart : childPosition.y; // Offset

  let parents = await getNextParents(plugin, rem);

  //console.log("Parents of " + await getRemText(plugin, rem) + ": " + parents.length);

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

  function removeDuplicateRems(rems: Rem[]): Rem[] {
    const remMap = new Map<string, Rem>();
    for (const rem of rems) {
      if (!remMap.has(rem._id)) {
        remMap.set(rem._id, rem);
      }
    }
    return Array.from(remMap.values());
  }

  parents = removeDuplicateRems(parents);

  //console.log("Actual Parents of " + await getRemText(plugin, rem) + ": " + parents.length);

  for (let i = 0; i < parents.length; i++) {
    const parent = parents[i];

    // Add new node
    if (!nodesMap.has(parent._id)) {
      const text = await formatIfLayerConcept(plugin, parent); //await getRemText(plugin, parent);
      const nodeWidth = calcNodeWidth(text); // Example width150
      const nodeHeight = Math.max(60, calcNodeHeight2(text, nodeWidth)); // Example height50
      const x = childPosition.x + (i - (parents.length - 1) / 2) * (nodeWidth + spacing_x);
      const y = yOffset - nodeHeight - spacing_y;
      const position = { x, y };
      const data = { label: text, width: nodeWidth, height: nodeHeight };
      nodesMap.set(parent._id, { rem: parent, type: "parent", position, data });

      edges.add({
        id: `${parent._id}-${rem._id}`,
        source: parent._id,
        target: rem._id,
        type: "smoothstep",
        sourceHandle: "bottom",
        targetHandle: "top",
        //pathOptions: {
        //  offset: -50,
        //  borderRadius: 100
        //}
      } as any);
    } else { // Add additional edge

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
      }
    }

    //if ((await getRemText(plugin, parent)).search("L_") == -1 && (await getRemText(plugin, parent)).search("C_") == -1) {
      await collectParents(plugin, srcRem, parent, depth - 1, nodesMap, edges);
    //}
  }
}

async function collectParentProperties(
  plugin: RNPlugin,
  currentRem: Rem | undefined,
  nodesMap: Map<string, { rem: Rem; type: string; position: { x: number; y: number }; data: NodeData }>,
  edges: Set<Edge>,
  yStart: number = 0
) {
  // Define constants for spacing and node dimensions
  const spacing_x = 150; // Horizontal spacing between parent and property nodes
  const spacing_y = 20;  // Vertical spacing between property nodes
  const nodeWidth = 300; // Width of each node
  const avgNodeHeight = 30; // Height of each node

  if(!currentRem) return;

  // Get all parent nodes from nodesMap
  const parentNodes = Array.from(nodesMap.values()).filter(node => node.type === "parent");

  //const parentNodes = [...Array.from(nodesMap.values()).filter(node => node.rem._id === currentRem._id), ...Array.from(nodesMap.values()).filter(node => node.type === "parent")];

  // Iterate over each parent node
  for (const parentNode of parentNodes) {
    const parentRem = parentNode.rem;
    let parentPosition = { ...parentNode.position }; // Clone to modify if needed

    // Fetch all children of the parent
    const children = await parentRem.getChildrenRem();

    // Collect all property nodes from "Eigenschaften" children
    let allProperties: Rem[] = [];

    for (const child of children) {
      const childText = await getRemText(plugin, child);
      const isEigenschaften = childText.search("Eigenschaften") !== -1 || await referencesEigenschaften(plugin, child);

      if (isEigenschaften) {
        const grandchildren = await child.getChildrenRem();
        const propertyGrandchildren = await Promise.all(
          grandchildren.map(async grandchild => {
            const type = await grandchild.getType();
            const text = await getRemText(plugin, grandchild);
            if (type === RemType.CONCEPT && !specialLayerNames.some(name => text.includes(name))) {
              return grandchild;
            }
            return null;
          })
        );
        const filteredProperties = propertyGrandchildren.filter(gc => gc !== null);
        allProperties = allProperties.concat(filteredProperties);
      }
    }

    // Collect descriptor nodes
    const descriptorChildren = await Promise.all(
      children.map(async child => {
        const type = await child.getType();
        const text = await getRemText(plugin, child);
        return (type === RemType.DESCRIPTOR ? child : null) ; // || await isReferencingRem(plugin, child) && !specialLayerNames.some(name => text.includes(name)) ? child : null
      })
    );

    let descriptors = descriptorChildren.filter(child => child !== null);

    descriptors = await filterSpecial(plugin, descriptors);

    // Calculate total number of nodes to add (properties + descriptors)
    const totalNodesToAdd = allProperties.length + descriptors.length;

    // Calculate total height required
    const totalHeightRequired = (totalNodesToAdd) * (avgNodeHeight + spacing_y);

    // Adjust parent position if necessary
    // Center the parent vertically among its nodes by shifting it up by half the total height
    const adjustedY = parentPosition.y - (totalHeightRequired);
    if (adjustedY !== parentPosition.y) {
      parentPosition.y = adjustedY;
      // Update the parent's position in nodesMap
      nodesMap.set(parentRem._id, { ...parentNode, position: parentPosition });
    }

    // Position property and descriptor nodes starting from the adjusted parent y-position
    let currentY = parentPosition.y;

    // Add property nodes
    for (const propertyRem of allProperties) {
      if (!nodesMap.has(propertyRem._id)) {
        const text = await getRemText(plugin, propertyRem);
        const data = { label: text, width: nodeWidth, height: calcNodeHeight2(text, nodeWidth) };
        const position = { x: parentPosition.x + nodeWidth, y: currentY };

        nodesMap.set(propertyRem._id, {
          rem: propertyRem,
          type: "property",
          position,
          data
        });

        edges.add({
          id: `${parentRem._id}-${propertyRem._id}`,
          source: parentRem._id,
          target: propertyRem._id,
          type: "smoothstep",
          sourceHandle: "right",
          targetHandle: "left"
        });

        currentY += avgNodeHeight + spacing_y;
      }
    }

    // Add descriptor nodes
    for (const descriptor of descriptors) {
      if (!nodesMap.has(descriptor._id)) {
        const text = await getRemText(plugin, descriptor);
        const data = { label: text, width: nodeWidth, height: avgNodeHeight };
        const position = { x: parentPosition.x + nodeWidth + spacing_x, y: currentY };

        nodesMap.set(descriptor._id, {
          rem: descriptor,
          type: "layer",
          position,
          data
        });

        edges.add({
          id: `${parentRem._id}-${descriptor._id}`,
          source: parentRem._id,
          target: descriptor._id,
          type: "smoothstep",
          sourceHandle: "right",
          targetHandle: "left"
        });

        currentY += avgNodeHeight + spacing_y;
      }
    }
  }
}

// If current Rem is child of a descriptor show the parent concept to the left
async function collectEnvironment(
  plugin: RNPlugin,
  currentRem: Rem | undefined,
  nodesMap: Map<string, { rem: Rem; type: string; position: { x: number; y: number }; data: NodeData }>,
  edges: Set<Edge>,
) {
  // Define constants for spacing and node dimensions (consistent with your code)
  const nodeWidth = 150;
  const nodeHeight = 50;
  const spacing_x = 120;
  const spacing_y = 120;

  if(!currentRem) return; //|| await (await currentRem.getParentRem())?.getType() != RemType.DESCRIPTOR

  // Get all parent nodes from nodesMap (mimicking collectParentProperties)
  // include currentRem to show its environment too
  const parentNodes = [...Array.from(nodesMap.values()).filter(node => node.rem._id === currentRem._id), ...Array.from(nodesMap.values()).filter(node => node.type === "parent")];

  // Iterate over each parent node
  for (const parentNode of parentNodes) {
    const parentRem = parentNode.rem;
    let parentPosition = parentNode.position;

    // Traverse the parent hierarchy to find concept ancestors
    let ancestor = await parentRem.getParentRem();
    let edgeLabel = "";
    let index = -1; // To adjust vertical positioning for multiple ancestors
    
    // Sorry this is a mess
    let alignLeft = (await isAncestor_(plugin, parentRem, currentRem) || parentRem == currentRem) && !((await currentRem.getCards()).length > 0);

    if(ancestor && (await ancestor.getType()) == RemType.DESCRIPTOR) {
      const nextAncestor = await ancestor.getParentRem();

      if(nextAncestor && (await nextAncestor.getType() == RemType.CONCEPT)) {

        edgeLabel = await getRemText(plugin, ancestor);

        // Position to the left of the parent, stacking vertically
        const position = {
          //x: parentPosition.x - (nodeWidth + spacing_x),
          x: alignLeft ? parentPosition.x - (nodeWidth + spacing_x) : parentPosition.x + (nodeWidth * 2 + spacing_x) - nodeWidth,
          y: parentPosition.y + (index * (nodeHeight + spacing_y))
        };
        const label = await getRemText(plugin, nextAncestor);
        const data = { label, width: nodeWidth, height: nodeHeight };

        if (!nodesMap.has(nextAncestor._id)) {
          nodesMap.set(nextAncestor._id, {
            rem: nextAncestor,
            type: "parentProperty",
            position,
            data
          });
        }

        // Add edge from ancestor to parent
        edges.add({
          id: `${nextAncestor._id}-${parentRem._id}`,
          source: nextAncestor._id,
          target: parentRem._id,
          label: edgeLabel,
          type: "smoothstep",
          sourceHandle: "bottom",
          targetHandle: alignLeft? "left" : "right"
        });
      }
    }
  }
}

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
  const spacing = 50;   // Spacing between nodes

  // Stop recursion if depth limit is reached
  if (depth <= 0) {
    return;
  }

  // Get the parent's position
  let parentPosition = nodesMap.get(rem._id)?.position ?? { x: 0, y: 0 };

  /*
  let children : Rem[] = [];

  // Fetch Rem children
  let childrenRem = await rem.getChildrenRem();

  for (const c of childrenRem) {
    //console.log(await getRemText(plugin, c));
    const isReferencing = await isReferencingRem(plugin, c);
    const type = await c.getType();

    // Concepts
    if (//!isReferencing &&
        (type === RemType.CONCEPT) &&
        !specialNames.includes(await getRemText(plugin, c))) {
      children.push(c);
    }
  }

  // Fetch Refs
  let childrenRef = await rem.remsReferencingThis();

  for (const c of childrenRef) {
    const text = await getRemText(plugin, c);
    const type = await c.getType();

    // Concepts
    if (//!isReferencing &&
        (type === RemType.CONCEPT) &&
        !specialNames.includes(await getRemText(plugin, c))) {
      children.push(c);
    } else {
      const cchildren = await c.getChildrenRem();

      for (const c of cchildren) {
        const text = await getRemText(plugin, c);
        //const isReferencing = await isReferencingRem(plugin, c);
        const type = await c.getType();

        // Concepts
        if ((type === RemType.CONCEPT) && !specialNames.includes(await getRemText(plugin, c)))
          children.push(c);
      }
      
      // Fetch Refs of Ref. 
      let childrenRef2 = await c.remsReferencingThis();

      for (const c of childrenRef2) {
        const text = await getRemText(plugin, c);
        const type = await c.getType();

        // Concepts
        if (//!isReferencing &&
            (type === RemType.CONCEPT) &&
            !specialNames.includes(await getRemText(plugin, c))) {
          children.push(c);
        } else {
          const cchildren = await c.getChildrenRem();

          for (const c of cchildren) {
            const text = await getRemText(plugin, c);
            //const isReferencing = await isReferencingRem(plugin, c);
            const type = await c.getType();

            // Concepts
            if ((type === RemType.CONCEPT) && !specialNames.includes(await getRemText(plugin, c)))
              children.push(c);
          }
        }
      }
    }
  }
  */

  let children = await getNextChildren(plugin, rem);

  //console.log("children.length: " + children.length);

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
      let text = await formatIfLayerConcept(plugin, child);

      const nodeWidth = calcNodeWidth(text); // Example width150
      const nodeHeight = Math.max(50, calcNodeHeight2(text, nodeWidth)); // Example height50

      // Place the child at the center of its subtree
      const childX = currentX + subtreeWidths[i] / 2;
      const childY = parentPosition.y + spacing * 3 + (applyYOffset ? y_offset : 0);
      const position = { x: childX, y: childY };

      // Add child to nodesMap if not already present
      const data = { label: text, width: nodeWidth, height: nodeHeight };
      if (!nodesMap.has(child._id)) {
        nodesMap.set(child._id, {
          rem: child,
          type: "child",
          position,
          data
        });
      } else {
        // Update the existing node's type to "child"
        const existingNode = nodesMap.get(child._id)!;
        nodesMap.set(child._id, {
          ...existingNode,
          type: "child",
          position: position,
          data: data,
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
        //pathOptions: {
        //  offset: 1,
        //  borderRadius: 100
        //}
      } as any);

      // Recursively process the child's children
      await collectChildren(plugin, child, depth - 1, nodesMap, edges, y_offset, false);

      // Move to the next position
      currentX += subtreeWidths[i] + spacing;
    }
  }
}

// Collect Child Properties
async function collectProperties( plugin: RNPlugin,
                                  selectedRem: Rem,
                                  nodesMap: Map<string, { rem: Rem; type: string; position: { x: number; y: number }; data: NodeData }>,
                                  edges: Set<Edge>,
                                  includeQuestions: boolean,
                                  includeRefs: boolean) {
  const nodeWidth = 300;
  const nodeWidthQuestions = 300;
  const nodeHeight = 50;
  const spacing_x = 300;   // Horizontal spacing between nodes
  const spacing_y = 20;    // Vertical spacing between nodes

  const selectedEntry = nodesMap.get(selectedRem._id);
  if (!selectedEntry) return;
  const selectedPosition = selectedEntry.position;

  // Collect local properties (children of "Eigenschaften" subcategory)
  let localProps: Rem[] = [];
  const localRems = await selectedRem.getChildrenRem();
  for (const child of localRems) {
    //if (await referencesEigenschaften(plugin, child)) {
    //console.log(await getRemText(plugin, child));
    if((await getRemText(plugin, child)).search("Eigenschaften") != -1 || await referencesEigenschaften(plugin, child)) {
      localProps = await child.getChildrenRem();
      break;
    }
  }

  // Collect referencing Rems
  let referencingRems = includeRefs ? await selectedRem.remsReferencingThis() : [];

  localProps = await filterSpecial(plugin, localProps);
  referencingRems = await filterSpecial(plugin, referencingRems);

  // Classify local Rems
  const localRemsWithCardStatus = await Promise.all(
    localProps.map(async (r) => ({
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

  // Collect descriptor nodes
  const descriptorChildren = await Promise.all(
    localRems.map(async child => {
      const type = await child.getType();
      const text = await getRemText(plugin, child);
      return (type === RemType.DESCRIPTOR) && !specialLayerNames.some(name => text.includes(name)) ? child : null;
    })
  );
  
  let descriptors = descriptorChildren.filter(child => child !== null);

  descriptors = await filterSpecial(plugin, descriptors);

  //console.log("Descriptors: " + descriptors.length);

  // Collect all main nodes to be added
  const allMainNodes = [
    ...localNormal,
    ...(includeQuestions ? localQuestions : []),
    ...(includeQuestions ? referencingQuestions : []),
    ...(includeQuestions ? referencingAnswers : []),
    ...descriptors
  ];

  // Fetch their texts
  const nodeTexts = await Promise.all(allMainNodes.map((rem) => getRemText(plugin, rem)));

  // Calculate their heights
  const heights = nodeTexts.map((text) => {
    //const lines = Math.ceil(text.length / 10); // Adjust as needed
    //return lineHeight * lines;
    return calcNodeHeight2(text, nodeWidth);
  });

  // Calculate total height including spacing
  const totalHeight = heights.reduce((sum, h) => sum + h, 0) + Math.max(0, allMainNodes.length - 1) * spacing_y;

  // Set initial Y position to center the stack around selectedPosition.y
  let currentY = selectedPosition.y - totalHeight / 2;

  // Function to add a node
  async function addNode(rem: Rem, type: string, position: {x: number, y:number}) {
    if (!nodesMap.has(rem._id)) {
      const text = await getRemText(plugin, rem);
      const width = type == "parent" ? nodeWidth/2 : nodeWidth; //calculateTextWidth(text);
      const height = type == "parent" ? 50 : Math.max(50, calcNodeHeight2(text, nodeWidth));
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
    currentY += calcNodeHeight2(await getRemText(plugin, prop), nodeWidth) + spacing_y;
  }

  // Add local questions if includeQuestions is true
  if (includeQuestions) {
    //
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
      currentY += calcNodeHeight2(await getRemText(plugin, prop), nodeWidthQuestions) + spacing_y;
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
        const parentPosition = { x: selectedPosition.x + 2.5 * spacing_x, y: currentY - spacing_y * 3};
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
      //currentY += lineHeight * ((await getRemText(plugin, q)).length / 10) + spacing_y;
      currentY += calcNodeHeight2(await getRemText(plugin, q), nodeWidthQuestions) + spacing_y;
    }

    // OLD: Add referencing answers with their parent question
    // NEW: Add parent question of referencing answers
    for (const a of referencingAnswers) {
      /*
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
      */
      const position = { x: selectedPosition.x + spacing_x, y: currentY };
      const parentQuestion = await a.getParentRem();
      if(parentQuestion) {
        await addNode(parentQuestion, "propertyRefAnswer", position);
        edges.add({
          id: `${selectedRem._id}-${parentQuestion._id}`,
          source: selectedRem._id,
          target: parentQuestion._id,
          type: "smoothstep",
          sourceHandle: "right",
          targetHandle: "left",
        });
        //
        collectEnvironment(plugin, parentQuestion, nodesMap, edges);

        currentY += calcNodeHeight2(await getRemText(plugin, a), nodeWidthQuestions) + spacing_y;
      }
    }
  }

  //
  for (const l of descriptors) {
    const position = { x: selectedPosition.x + spacing_x, y: currentY };
    await addNode(l, "layer", position);
    edges.add({
      id: `${selectedRem._id}-${l._id}`,
      source: selectedRem._id,
      target: l._id,
      type: "smoothstep",
      sourceHandle: "right",
      targetHandle: "left",
    });
    currentY += calcNodeHeight2(await getRemText(plugin, l), 300) + spacing_y;
  }
}

// **Updated buildGraph to Include Rem in Node Data**
async function buildGraph(plugin: RNPlugin, selectedRem: Rem, includeQuestions: boolean, includeRefs: boolean) {
  const nodesMap = new Map<string, { rem: Rem; type: string; depth?: number; position: { x: number; y: number }; data: NodeData }>();
  const edges = new Set<Edge>();

  const focusedPosition = { x: 0, y: 0 };
  const text = await formatIfLayerConcept(plugin, selectedRem);
  const width = calcNodeWidth(text);
  const height = Math.max(50, calcNodeHeight2(text, width));
  const focusedData = { label: text, width: width, height: height, rem: selectedRem };
  nodesMap.set(selectedRem._id, { 
    rem: selectedRem, 
    type: "focused", 
    position: focusedPosition, 
    data: focusedData 
  });

  await collectProperties(plugin, selectedRem, nodesMap, edges, includeQuestions, includeRefs);

  let lowestPropertiesY = lowestYPosition(nodesMap);

  await collectParents(plugin, selectedRem, selectedRem, 100, nodesMap, edges, lowestPropertiesY);

  await collectParentProperties(plugin, selectedRem, nodesMap, edges, lowestPropertiesY);

  await collectEnvironment(plugin, selectedRem, nodesMap, edges);

  await collectChildren(plugin, selectedRem, 1, nodesMap, edges, highestYPosition(nodesMap) + 75, true);

  const nodeArray: Node<NodeData>[] = Array.from(nodesMap.values()).map(({ rem, type, position, data }) => {
    return {
      id: rem._id,
      type,
      data: { ...data, rem }, // Include rem in data
      position,
      draggable: true,
    };
  });

  return { nodes: nodeArray, edges: Array.from(edges) };
}

function InheritanceWidget() {
  const plugin = usePlugin();

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<NodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const selectedRemId = useTracker((reactPlugin) => reactPlugin.storage.getSession('selectedRemId'));

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

  async function collapseNode(nodeId: string, nodes: Node<NodeData>[], edges: Edge[], setNodes: (nodes: Node<NodeData>[]) => void, setEdges: (edges: Edge[]) => void) {
    const nodesToRemove = new Set<string>();
    const edgesToRemove = new Set<Edge>();
  
    function collectDescendants(currentId: string) {
      nodesToRemove.add(currentId);
      const childEdges = edges.filter(edge => edge.source === currentId);
      for (const edge of childEdges) {
        edgesToRemove.add(edge);
        collectDescendants(edge.target);
      }
    }
  
    // Explicitly remove all outgoing edges from nodeId
    const allOutgoingEdges = edges.filter(edge => edge.source === nodeId);
    allOutgoingEdges.forEach(edge => {
      edgesToRemove.add(edge);
      collectDescendants(edge.target);
    });
  
    const newNodes = nodes.filter(node => !nodesToRemove.has(node.id) || node.id === nodeId);
    const newEdges = edges.filter(edge => !edgesToRemove.has(edge));
    setNodes(newNodes);
    setEdges(newEdges);
  }

  async function onNodeContextMenu<T extends Node>(_event: React.MouseEvent, node: T) {
    try {
      const focusedRem = (await plugin.rem.findOne(node.id)) as Rem;
      if (focusedRem) {
        //await plugin.storage.setSession('selectedRemId', focusedRem._id);
        await plugin.window.openRem(focusedRem);
      } else {
        await plugin.app.toast('No Rem is currently selected.');
      }
    } catch (error) {
      console.error("Error opening Rem:", error);
    }
  }

  async function onNodeClick<T extends Node>(event: React.MouseEvent, node: T) {
    event.preventDefault();
    const nodeId = node.id;

    const nodesMap: Map<string, { rem: Rem; type: string; position: { x: number; y: number }; data: NodeData }> = new Map();
    nodes.forEach(node => {
      const rem = node.data.rem as Rem;
      if (rem) {
        nodesMap.set(node.id, {
          rem,
          type: node.type as string,
          position: node.position,
          data: node.data,
        });
      }
    });

    const edgesSet = new Set(edges);
    const rem = nodesMap.get(nodeId)?.rem;
    if (!rem) {
      console.error(`Rem with ID ${nodeId} not found in nodesMap`);
      return;
    }

    const isExpanded = Array.from(edgesSet).some(edge => edge.source === nodeId);
    if (isExpanded) {
      await collapseNode(nodeId, nodes, edges, setNodes, setEdges);
      return;
    }

    const lowestY = Math.max(...nodes.map(node => node.position.y)) + 100;
    await collectChildren(plugin, rem, 1, nodesMap, edgesSet, lowestY, false);

    const newNodes = Array.from(nodesMap.values()).map(({ rem, type, position, data }) => ({
      id: rem._id,
      type,
      data: { ...data, rem },
      position,
      draggable: true,
    }));
    const newEdges = Array.from(edgesSet);
    setNodes(newNodes);
    setEdges(newEdges);
  }

  return (
    <div
      className="h-full w-full overflow-y-auto rn-clr-background-primary hover:bg-gray-400"
      onMouseDown={(e) => e.stopPropagation()}>
      <div className="flex gap-2">
        <MyRemNoteButton
          img="M9 2.221V7H4.221a2 2 0 0 1 .365-.5L8.5 2.586A2 2 0 0 1 9 2.22ZM11 2v5a2 2 0 0 1-2 2H4v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2h-7Z"
          text="Open Rem in Editor"
          onClick={async () => {
            const remId = await plugin.storage.getSession('selectedRemId');
            await plugin.window.openRem((await plugin.rem.findOne(remId as string)) as Rem);
          }}
        />
        <MyRemNoteButton
          img="M17.651 7.65a7.131 7.131 0 0 0-12.68 3.15M18.001 4v4h-4m-7.652 8.35a7.13 7.13 0 0 0 12.68-3.15M6 20v-4h4"
          text="Refresh"
          onClick={async () => {
            const remId = await plugin.storage.getSession('selectedRemId');
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
              onNodeContextMenu={onNodeContextMenu}
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