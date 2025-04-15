import { renderWidget, useTracker, Rem, usePlugin, RNPlugin, RichTextInterface, RemType, REM_TYPE } from "@remnote/plugin-sdk";

import { NodeData } from "../components/Nodes";

export const specialTags = ["Tag", "Tags", "Header", "Deck", "Flashcards", "Rem With An Alias", "Automatically Sort", "Document", "Highlight"];

export const specialNames = ["query:", "query:#", "contains:", "Document", "Tags", "Rem With An Alias", "Highlight", "Tag", "Color", "Definition", "Eigenschaften", "Status", "Aliases", "Bullet Icon"];

// Map RemNote highlight colors to CSS colors
export const highlightColorMap: { [key: string]: string } = {
  Red: "red",
  Orange: "orange",
  Yellow: "yellow",
  Green: "green",
  Blue: "blue",
  Purple: "purple",
};

// Default color for nodes without a highlight
export const DEFAULT_NODE_COLOR = "#f0f0f0"; // Light gray

// Highlight style for the focused Rem's node
export const FOCUSED_NODE_STYLE = {
  border: "3px solid black", // Thick black border for the focused node
};

//
/*
export function getRemText(rem: Rem) {
  if(!rem) return "";

  const text = rem.text
    .map((item) => {
      if (typeof item === "string") {
        return item;
      } else if ("text" in item) {
        return item.text;
      } else if ("remId" in item) {
        return `[Rem: ${item.remId}]`;
      } else {
        return "";
      }
    })
    .join("");
  return text;
}
  */

//
//
async function processRichText(plugin: RNPlugin, richText: RichTextInterface): Promise<string> {
  const textPartsPromises = richText.map(async (item) => {
    if (typeof item === "string") {
      return item;
    }
    switch (item.i) {
      case 'm': return item.text;
      case 'q':
        const referencedRem = await plugin.rem.findOne(item._id);
        if (referencedRem) {
          return await getRemText(plugin, referencedRem);
        } else if (item.textOfDeletedRem) {
          return await processRichText(plugin, item.textOfDeletedRem);
        }
        return "";
      case 'i': return item.url;
      case 'a': return item.url;
      case 'p': return item.url;
      case 'g': return item._id || "";
      case 'x': return item.text;
      case 'n': return item.text;
      case 's': return "";
      default: return "";
    }
  });

  const textParts = await Promise.all(textPartsPromises);
  return textParts.join("");
}

export async function getRemText(plugin: RNPlugin, rem: Rem) {
  if (!rem) return "";
  return processRichText(plugin, rem.text);
}

export async function isRemProperty(plugin: RNPlugin, rem: Rem): Promise<boolean> {
  const parentRem = await rem.getParentRem();

  if(!parentRem) return false;

  const parentRefs = await parentRem.remsBeingReferenced();

  if(parentRefs.length == 0) return false;

  return (await getRemText(plugin , parentRefs[0])).trim() == "Eigenschaften";

  //return parentRem ? getRemText((await parentRem.remsBeingReferenced())[0]).trim() == "Eigenschaften" : false
}

export async function getTagParent(plugin: RNPlugin, rem: Rem): Promise<Rem | undefined> {

    const tags = (await rem.getTagRems()).filter(async (tagRem: Rem) => !specialTags.includes(await getRemText(plugin, tagRem)));

    return tags[0];
}

export async function getImmediateParents(plugin: RNPlugin, rem: Rem): Promise<Rem[]> {

  const tags = await rem.getTagRems();
  const filteredTags = tags.filter(async (tagRem: Rem) => !specialTags.includes(await getRemText(plugin, tagRem)));
  const parentRem = await rem.getParentRem();

  // Check parent Rem
  if (parentRem && 
      filteredTags.lastIndexOf(parentRem) === -1) {

    const type = await parentRem.getType();
    //console.log(await getRemText(plugin, parentRem) );
    //console.log("Type:" + type)

    //
    if (type == RemType.CONCEPT)
      filteredTags.push(parentRem);

    //
    if (await isReferencingRem(plugin, parentRem) || type == RemType.DESCRIPTOR) {
      const pparentRemTags = (await parentRem.getTagRems()).filter(async (tagRem: Rem) => !specialTags.includes(await getRemText(plugin, tagRem)));

      //console.log("Parent ("+ await getRemText(plugin, parentRem) + ") is referencing, and has base" + "[" + await getRemText(plugin, pparentRemTags[0]) + "]");

      if (pparentRemTags.length > 0)
        filteredTags.push(pparentRemTags[0]);
    }
  }

  const parents = filteredTags;

  return parents;
}

export async function isAncestor(plugin: RNPlugin, ancestor: Rem, descendant: Rem, visited: Set<string> = new Set<string>()): Promise<boolean> {
  if (visited.has(descendant._id)) {
    //console.log("LOOP DETECTED" + getRemText(ancestor)); // TODO: VISUAL
    return false; // Cycle detected
  }
  visited.add(descendant._id);

  const parents = await getImmediateParents(plugin, descendant);

  for (const parent of parents) {
    if (parent._id === ancestor._id) {
      return true; // Found the ancestor
    }
    if (await isAncestor(plugin, ancestor, parent, visited)) {
      return true; // Ancestor found higher up
    }
  }
  return false; // No path to ancestor
}

export async function getNextParents(plugin: RNPlugin, rem: Rem): Promise<Rem[]> {
  const parents = await getImmediateParents(plugin, rem);

  const validParents = [];
  for (const P of parents) {
    let isValid = true;
    for (const Q of parents) {
      if (Q._id !== P._id && await isAncestor(plugin, P, Q)) {
        isValid = false;
        break;
      }
    }
    if (isValid) {
      validParents.push(P);
    }
  }

  return validParents;
}

export async function isNextParent(plugin: RNPlugin, rem: Rem, parent: Rem): Promise<boolean> {
  const parents = await getNextParents(plugin, rem);

  for(const p of parents) {
    if(p._id == parent._id)
      return true;
  }

  return false;
}

// Helper function to check if a Rem references "Eigenschaften"
export async function referencesEigenschaften(plugin: RNPlugin, rem: Rem): Promise<boolean> {
  const referencedRems = await rem.remsBeingReferenced();
  //return referencedRems.some(async (refRem) => {
  //  (await getRemText(plugin, refRem)).search("Eigenschaften") != -1});
  const texts = await Promise.all(
    referencedRems.map(async (refRem) => await getRemText(plugin, refRem))
  );
  return texts.some((text) => text.search("Eigenschaften") !== -1);
}

export async function isReferencingRem(plugin: RNPlugin, rem: Rem): Promise<boolean> {
  // somehow doesnt work
  return (await rem.remsBeingReferenced()).length != 0;
  //const referencing = (await getRemText(plugin, rem)).trim().length == 0;
  //return referencing;
}

export async function getNonReferencingParent(plugin: RNPlugin, rem: Rem): Promise<Rem | undefined> {
  let r = await rem.getParentRem();

  while (r) {
    if(!await isReferencingRem(plugin, r))
      return r;
    else
      r = await r?.getParentRem();
  }

  return r;
}

/*
export async function removeReferencingRem(rems: Rem[]): Promise<Rem[]> {
  const remsWithReferenceStatus = await Promise.all(
    rems.map(async (rem) => {
      try {
        return [rem, await isReferencingRem(rem)] as [Rem, boolean];
      } catch (error) {
        console.error(`Error checking references for rem ${rem._id}:`, error);
        return [rem, true] as [Rem, boolean]; // Treat as referencing on error
      }
    })
  );
  return remsWithReferenceStatus
    .filter(([, isReferencing]) => !isReferencing)
    .map(([rem]) => rem);
}
*/

//
export function calculateLines(text: string, containerWidth: number, font: string) {
  // Create an offscreen canvas to measure text
  const canvas = document.createElement('canvas');
  const context = canvas?.getContext('2d');

  if(context == null) return 0;

  context.font = font; // e.g., "16px Arial"

  let lines = 0; // Line counter
  let currentLine = ''; // Current line content

  // Split text into words by spaces
  const words = text.split(' ');

  for (const word of words) {
    // Build test line: add space before word if currentLine exists
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const testWidth = context.measureText(testLine).width;

    if (testWidth <= containerWidth) {
      // Word fits on current line
      currentLine = testLine;
    } else {
      if (currentLine) {
        // Current line is complete, start new line
        lines++;
        currentLine = word;
      } else {
        // No current line, word is too long; break it
        let remainingWord = word;
        while (remainingWord.length > 0) {
          // Find how many characters fit within containerWidth
          let fitLength = 1;
          while (fitLength <= remainingWord.length) {
            const substring = remainingWord.substring(0, fitLength);
            if (context.measureText(substring).width > containerWidth) {
              break;
            }
            fitLength++;
          }
          fitLength--; // Last length that fit

          if (fitLength === 0) {
            // Single character exceeds width; add it anyway
            lines++;
            remainingWord = remainingWord.substring(1);
          } else {
            // Add fitting substring as a line
            lines++;
            remainingWord = remainingWord.substring(fitLength);
          }
        }
        currentLine = '';
      }
    }
  }

  // Account for the last line if it has content
  if (currentLine) {
    lines++;
  }

  return lines;
}

export function calculateTextWidth(text: string): number {
  return text.length * 9;
}

export function highestXPosition(
  nodesMap: Map<string, { rem: Rem; type: string; position: { x: number; y: number }; data: NodeData }>,
  type?: string
): number {
  // Convert the Map's values (nodes) into an array
  const nodesArray = Array.from(nodesMap.values());
  
  // Filter nodes by the specified type and extract their x positions
  const xValues = nodesArray
    //.filter(node => node.type === type)
    .map(node => node.position.x);
  
  // If no nodes match the type, return null; otherwise, return the maximum x value
  if (xValues.length === 0) {
    return 0;
  } else {
    return Math.max(...xValues);
  }
}

// 
export function highestYPosition(
  nodesMap: Map<string, { rem: Rem; type: string; position: { x: number; y: number }; data: NodeData }>,
  type?: string
): number {
  // Convert the Map's values (nodes) into an array
  const nodesArray = Array.from(nodesMap.values());
  
  // Filter nodes by the specified type and extract their x positions
  const yValues = nodesArray
    //.filter(node => node.type === type)
    .map(node => node.position.y);
  
  // If no nodes match the type, return null; otherwise, return the maximum x value
  if (yValues.length === 0) {
    return 0;
  } else {
    return Math.max(...yValues);
  }
}

export function lowestYPosition(
  nodesMap: Map<string, { rem: Rem; type: string; position: { x: number; y: number }; data: NodeData }>,
  type?: string
): number {
  // Convert the Map's values (nodes) into an array
  const nodesArray = Array.from(nodesMap.values());
  
  // Filter nodes by the specified type and extract their x positions
  const yValues = nodesArray
    //.filter(node => node.type === type)
    .map(node => node.position.y);
  
  // If no nodes match the type, return null; otherwise, return the maximum x value
  if (yValues.length === 0) {
    return 0;
  } else {
    return Math.min(...yValues);
  }
}