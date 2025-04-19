import { renderWidget, useTracker, Rem, usePlugin, RNPlugin, RichTextInterface, RemType, REM_TYPE } from "@remnote/plugin-sdk";

import { NodeData } from "../components/Nodes";

export const specialTags = ["Tag", "Tags", "Header", "Deck", "Flashcards", "Rem With An Alias", "Automatically Sort", "Document", "Highlight", "Hide Bullets", "Status"];

export const specialNames = ["Hide Bullets", "Status", "query:", "query:#", "contains:", "Document", "Tags", "Rem With An Alias", "Highlight", "Tag", "Color", "Definition", "Eigenschaften", "Alias", "Bullet Icon"];

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
// Doesnt work. I overloaded getRemText with another boolean doing something different
async function processRichText(plugin: RNPlugin, richText: RichTextInterface, showAlias = false): Promise<string> {
  const textPartsPromises = richText.map(async (item) => {
    if (typeof item === "string") {
      return item;
    }
    switch (item.i) {
      case 'm': return item.text;
      case 'q':
        const id = showAlias && item.aliasId ? item.aliasId : item._id;
      
        //const referencedRem = await plugin.rem.findOne(item._id);
        const referencedRem = await plugin.rem.findOne(id);
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

export async function getRemText(plugin: RNPlugin, rem: Rem, extentedName = false): Promise<string> {
  if (!rem) return "";

  let richText = rem.text;

  const textPartsPromises = richText.map(async (item) => {
    if (typeof item === "string") {
      if(extentedName && await rem.getType() == RemType.DESCRIPTOR) {
        const parentRem = await rem.getParentRem();

        if(parentRem)
            return await getRemText(plugin, parentRem) + ">" + item;
      }
      return item;
    }
    switch (item.i) {
      //case 'm': return item.text;
      case 'q':
        const referencedRem = await plugin.rem.findOne(item._id);
        if (referencedRem) {
          if(extentedName) {
            const refParentRem = await rem.getParentRem();

            if(refParentRem)
              return await getRemText(plugin, refParentRem, true) + ">" + await getRemText(plugin, referencedRem);
          }

          return await getRemText(plugin, referencedRem);
        } else if (item.textOfDeletedRem) {
          return await processRichText(plugin, item.textOfDeletedRem);
        }
        return "";
      case 'i': return item.url;
      case 'a': return item.url;
      case 'p': return item.url;
      case 'g': return item._id || "";
      case 'm':
      case 'x': 
      case 'n':
        // 
        if(extentedName && await rem.getType() == RemType.DESCRIPTOR) {
            const parentRem = await rem.getParentRem();

            if(parentRem)
                return await getRemText(plugin, parentRem) + ">" + item.text;
        }
        return item.text;
      //case 'n': return item.text;
      case 's': return "";
      default: return "";
    }
  });

  const textParts = await Promise.all(textPartsPromises);
  return textParts.join("");
  //return processRichText(plugin, rem.text);
}

export async function isRemProperty(plugin: RNPlugin, rem: Rem): Promise<boolean> {
  const parentRem = await rem.getParentRem();

  if(!parentRem) return false;

  const parentRefs = await parentRem.remsBeingReferenced();

  if(parentRefs.length == 0) return false;

  return (await getRemText(plugin , parentRefs[0])).trim() == "Eigenschaften";

  //return parentRem ? getRemText((await parentRem.remsBeingReferenced())[0]).trim() == "Eigenschaften" : false
}

export async function isLayerConcept(plugin: RNPlugin, rem: Rem): Promise<boolean> {
  return await rem.getType() == RemType.DESCRIPTOR && (await rem.remsBeingReferenced()).length > 0;
}

export async function formatIfLayerConcept(plugin: RNPlugin, rem: Rem): Promise<string> {
  let text = await getRemText(plugin, rem);
  
  // LAYER CONCEPT
  if(await isLayerConcept(plugin, rem)) {
    const pC = await rem.getParentRem();

    if(pC)
      text = text + "<<" + await getRemText(plugin, pC);
  }

  return text;
}

export async function getTagParent(plugin: RNPlugin, rem: Rem): Promise<Rem | undefined> {

    const tags = (await rem.getTagRems()).filter(async (tagRem: Rem) => !specialTags.includes(await getRemText(plugin, tagRem)));

    return tags[0];
}

/*
export async function getImmediateParents(plugin: RNPlugin, rem: Rem): Promise<Rem[]> {

  let parents: Rem[] = [];

  const parentRem = await rem.getParentRem();

  // Check parent Rem
  if (parentRem) {

    const type = await parentRem.getType();
    //console.log(await getRemText(plugin, parentRem) );
    //console.log("Type:" + type)

    // RemParent is Concept
    if (type == RemType.CONCEPT)
      parents.push(parentRem);

    //
    if (await isReferencingRem(plugin, rem)) {
      const referencedRem = await rem.remsBeingReferenced();

      for(const r of referencedRem) {
        const type = await r.getType();

        if(type == RemType.CONCEPT)
          parents.push(r);
      }
    }
  }

  return parents;
}
*/
export async function getImmediateParents(plugin: RNPlugin, rem: Rem): Promise<Rem[]> {
  let parents: Rem[] = [];
  const visited: Set<string> = new Set(); // To prevent infinite loops

  // Helper function to traverse referencing Rems
  const traverseReferencingRem = async (currentRem: Rem): Promise<Rem | null> => {
    if (visited.has(currentRem._id)) {
      return null; // Cycle detected
    }
    visited.add(currentRem._id);

    // CONCEPT
    const type = await currentRem.getType();
    if (type === RemType.CONCEPT) {
      return currentRem;
    }

    // DESCRIPTOR
    if (type == RemType.DESCRIPTOR) { // await isReferencingRem(plugin, currentRem) &&
      return currentRem;
    }
    /*
    if (await isReferencingRem(plugin, currentRem)) {
      const referencedRems = await currentRem.remsBeingReferenced();
      for (const refRem of referencedRems) {
        const result = await traverseReferencingRem(refRem);
        if (result) {
          return result;
        }
      }
    }
    */
    return null;
  };

  // 
  const remType = await rem.getType(); 
  const parentRem = await rem.getParentRem();
  //const tags = (await rem.getTagRems()).filter(async (tagRem: Rem) => !specialTags.includes(await getRemText(plugin, tagRem)));
  const tagRems = await rem.getTagRems();
  const tagData = await Promise.all(
    tagRems.map(async (tagRem: Rem) => ({
      rem: tagRem,
      text: await getRemText(plugin, tagRem)
    }))
  );
  const tags = tagData
    .filter(({ text }) => !specialTags.includes(text))
    .map(({ rem }) => rem);

  const isReferencing = await isReferencingRem(plugin, rem);
  
  // CONCEPTS inherit through Rem Hierarchie
  if (parentRem && remType == RemType.CONCEPT) {
    const parentType = await parentRem.getType();

    //if (parentType === RemType.CONCEPT) {
      parents.push(parentRem);
    //}

    // CONCEPTS inherit explicitly through Tags too
    for (const tag of tags) {
      if (tag && await tag.getType() == RemType.CONCEPT ) {
        parents.push(tag);
      }
    }

    return parents;
  }

  // DESCRIPTORS
  // DESCRIPTORS inherit explicitly through TAGS and their type is set explicitly by TAGS
  if(parentRem && remType == RemType.DESCRIPTOR && tags.length > 0) {
    console.log("REM is a DESCRIPTOR with TAGS:" + await getRemText(plugin, tags[0]));

    for (const tag of tags) {
      if (tag && await tag.getType() == RemType.CONCEPT ) {
        parents.push(tag);
      }
    }
  } else
    console.log("DESCRIPTOR HAS NO TAGS TO INHERIT FROM")

  // DESCRIPTORS inherit through Rem Hierarchie and their type is set implicitly by Rem Hierarchie if their type is not set through TAGS
  if(parentRem && remType == RemType.DESCRIPTOR && tags.length == 0) {

    console.log("REM has no TAGS and is a DESCRIPTOR");

    const parentType = await parentRem.getType();

    if (parentType === RemType.CONCEPT) {
      parents.push(parentRem);
    } else
      console.log("Parent REM is not a CONCEPT to inherit from")

    // REFERENCING DESCRIPTORS inherit implicitly through REFERENCES
    if (remType == RemType.DESCRIPTOR && isReferencing) {
      const referencedRems = await rem.remsBeingReferenced();
      for (const refRem of referencedRems) {
        const conceptRem = await traverseReferencingRem(refRem);
        if (conceptRem) {
          parents.push(conceptRem);
        }
      }
    }
  }

  // DESCRIPTORS inherit implicitly through Rem Hierarchie if they are not REFERENCING and have no TAGS

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

  //console.log("Immediate Parents of " + await getRemText(plugin, rem) + ": " + parents.length);

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

export async function getAllParents(plugin: RNPlugin, rem: Rem): Promise<Rem[]> {
  const allParents = new Set<Rem>();
  const visited = new Set<string>();

  async function collectParents(currentRem: Rem) {
    if (visited.has(currentRem._id)) {
      return; // Cycle detected or already processed
    }
    visited.add(currentRem._id);

    const parents = await getImmediateParents(plugin, currentRem);
    for (const parent of parents) {
      allParents.add(parent);
      await collectParents(parent);
    }
  }

  await collectParents(rem);
  return Array.from(allParents);
}

export async function isNextParent(plugin: RNPlugin, rem: Rem, parent: Rem): Promise<boolean> {
  const parents = await getNextParents(plugin, rem);

  for(const p of parents) {
    if(p._id == parent._id)
      return true;
  }

  return false;
}

export async function getImmediateChildren(plugin: RNPlugin, rem: Rem): Promise<Rem[]> {
  let children: Rem[] = [];
  const visited: Set<string> = new Set(); // To prevent infinite loops

  // Helper function to traverse referencing Rems for children
  const traverseReferencingRem = async (currentRem: Rem): Promise<Rem[] | []> => {
    let refChildren: Rem[] = [];

    if (visited.has(currentRem._id)) {
      //console.log("Cycle detected");

      return refChildren; // Cycle detected
    }
    visited.add(currentRem._id);

    // [[Quest]] < CONCEPT
    const type = await currentRem.getType();
    const txt = await getRemText(plugin, currentRem);

    //console.log("Traversing " + txt);

    if (type === RemType.CONCEPT) {
      //console.log(txt + " is a directly inheriting child");
      refChildren.push(currentRem);

      return refChildren;
    }

    // LAYER CONCEPT: [[Quest]] DESCRIPOR
    if (type === RemType.DESCRIPTOR) {
      const referencedRems = await currentRem.remsReferencingThis(); // remsBeingReferenced

      refChildren.push(currentRem);
    }
    
    return refChildren;
  };

  // Get hierarchical children
  const hierarchicalChildren = await rem.getChildrenRem();
  for (const child of hierarchicalChildren) {
      const childType = await child.getType();
      if (childType === RemType.CONCEPT) {
          children.push(child);
      } 
  }

  // Get children through references
  const referencingRems = await rem.remsReferencingThis();
  for (const refRem of referencingRems) {
    const remTxt = await getRemText(plugin, rem);
    const refRTxt = await getRemText(plugin, refRem);

    //console.log(refRTxt + " references " + remTxt);
    const conceptRem = await traverseReferencingRem(refRem);

    children = [...children, ... conceptRem];
  }

  // Remove duplicates
  children = Array.from(new Set(children.map(rem => rem._id)))
      .map(id => children.find(rem => rem._id === id)!);

  //console.log(children.length + " immediate children found");
  return children;
}

export async function isDescendant(plugin: RNPlugin, descendant: Rem, ancestor: Rem, visited: Set<string> = new Set<string>()): Promise<boolean> {
  if (visited.has(ancestor._id)) {
      return false; // Cycle detected
  }
  visited.add(ancestor._id);

  const children = await getImmediateChildren(plugin, ancestor);

  for (const child of children) {
      if (child._id === descendant._id) {
          return true; // Found the descendant
      }
      if (await isDescendant(plugin, descendant, child, visited)) {
          return true; // Descendant found deeper
      }
  }
  return false; // No path to descendant
}

export async function getNextChildren(plugin: RNPlugin, rem: Rem): Promise<Rem[]> {
  const children = await getImmediateChildren(plugin, rem);

  const validChildren = [];
  for (const C of children) {
      let isValid = true;
      for (const D of children) {
          if (D._id !== C._id && await isDescendant(plugin, C, D)) {
              isValid = false;
              break;
          }
      }
      if (isValid) {
          validChildren.push(C);
      }
  }

  return validChildren;
}

export async function getAllChildren(plugin: RNPlugin, rem: Rem): Promise<Rem[]> {
  const allChildren = new Set<Rem>();
  const visited = new Set<string>();

  async function collectChildren(currentRem: Rem) {
    if (visited.has(currentRem._id)) {
      return; // Cycle detected or already processed
    }
    visited.add(currentRem._id);

    const children = await getImmediateChildren(plugin, currentRem);
    for (const child of children) {
      allChildren.add(child);
      await collectChildren(child);
    }
  }

  await collectChildren(rem);
  return Array.from(allChildren);
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

// Helper function to check if a Rem is an ancestor of another
export async function isClassAncestor(plugin: RNPlugin, potentialAncestor: Rem, rem: Rem): Promise<boolean> {
  let currentRem: Rem | null = rem;
  while (currentRem) {
    const classType = await getClassType(plugin, currentRem);
    if (classType && classType._id === potentialAncestor._id) {
      return true;
    }
    currentRem = classType;
  }
  return false;
}

// Function to get the closest class parent for a Rem
export async function getClassType(plugin: RNPlugin, rem: Rem): Promise<Rem | null> {
  if (!rem) return null;

  const parent = await rem.getParentRem();
  const type = await rem.getType();
  const isReferencing = await isReferencingRem(plugin, rem);
  const tagRems = await rem.getTagRems();
  const tagData = await Promise.all(
      tagRems.map(async (tagRem: Rem) => ({
      rem: tagRem,
      text: await getRemText(plugin, tagRem)
      }))
  );
  const tags = tagData
      .filter(({ text }) => !specialTags.includes(text))
      .map(({ rem }) => rem);

  // CONCEPT with TAGS
  if (type === RemType.CONCEPT && tags.length > 0) {
    return tags[0];
  } 

  // CONCEPT without TAGS
  if (type === RemType.CONCEPT && tags.length == 0) {

      if(!parent || await getRemText(plugin, parent) == "Eigenschaften" || await getRemText(plugin, parent) == "Definition") return null;

      const parentType = await parent.getType()

      if(parentType == RemType.CONCEPT)
          return parent;

      if (parentType == RemType.DESCRIPTOR) {
          if(!await isReferencingRem(plugin, parent))
              return parent;
          else {
            //const aliases = await parent.getAliases();

            //if(aliases.length > 0)
            //  return aliases[0];
            //else
            //  return await getClassType(plugin, parent);
            return parent;
          }
      }
  } 

  // DESCRIPTOR without TAG
  if(type == RemType.DESCRIPTOR && !isReferencing && tags.length == 0) {
    if(!parent || await getRemText(plugin, parent) == "Eigenschaften" || await getRemText(plugin, parent) == "Definition") return null;

      //console.log("DESCRIPTOR no TAG type " + await getRemText(plugin, parent));

      return parent;
  }

  // DESCRIPTOR with TAG
  if(type == RemType.DESCRIPTOR && !isReferencing && tags.length > 0) {
      return tags[0];
  }

  // REF DESCRIPTOR with TAG
  // TODO?

  // REF DESCRIPTOR without TAG
  if (type === RemType.DESCRIPTOR && isReferencing) {
      const referencedRem = (await rem.remsBeingReferenced())[0];

      console.log("REF Descriptor referencing " + await getRemText(plugin, referencedRem) + " of type " + await getRemText(plugin, await getClassType(plugin, referencedRem) as Rem));

      //const referencedParent = await referencedRem.getParentRem();
      const referencedClass = await getClassType(plugin, referencedRem);

      if (referencedClass && parent && await isClassAncestor(plugin, referencedClass, parent)) {
        // Special case: referenced Rem's parent is an ancestor of descriptor's parent
        //return getClassType(plugin, parent);
        if(!parent || await getRemText(plugin, parent) == "Eigenschaften" || await getRemText(plugin, parent) == "Definition") return null;
        return parent;
      } else {
        // Inherit from the referenced Rem's class type
        //return getClassType(plugin, referencedRem);
        return referencedRem;
      }
  }

  return null; // Default case, though should be handled above
}   

// Function to get the ancestor lineage as a string
export async function getAncestorLineage(plugin: RNPlugin, rem: Rem): Promise<string> {
  const lineage: Rem[] = [rem];
  const visited = new Set<string>([rem._id]); // Track visited Rem IDs
  let currentRem: Rem | null = rem;

  while (currentRem) {
      const classType = await getClassType(plugin, currentRem);
      if (classType && !visited.has(classType._id)) {
      lineage.push(classType);
      visited.add(classType._id);
      currentRem = classType;
      } else {
      break;
      }
  }

  // Format the lineage
  const texts = await Promise.all(lineage.map(async (r) => {
      //const text = await plugin.richText.toString(await r.text);
      //return text || 'Unnamed Rem';
      return await getRemText(plugin, r, true);
  }));
  return texts.join(' -> ');
}

export function calcNodeHeight(
  txt: string,
  width: number,
  lineHeight: number = 25,
  font: string = '14px Arial',
  smallNodeHeight: number = 25
): number {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  if (!context || width <= 0) return 0;

  context.font = font;

  //
  txt = txt.replace(/</g, '\n'); // Replace all "<" with newline

  // Split by newlines first
  const sections = txt.split('\n').filter(s => s.trim());
  let lines = 0;

  // Process each section (from newlines) for word wrapping
  for (const section of sections) {
    const words = section.replace(/</g, ' ').split(' ').filter(w => w);
    let currentLine = '';
    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      if (context.measureText(testLine).width > width) {
        if (currentLine) {
          lines++;
          currentLine = word;
        } else {
          lines += Math.ceil(context.measureText(word).width / width);
          currentLine = '';
        }
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines++;
  }

  // Add height for smaller nodes
  const extraNodes = (txt.match(/</g) || []).length;

  return (lines * lineHeight) + (extraNodes * smallNodeHeight);
}

export function calcNodeHeight2(
  txt: string,
  width: number,
  lineHeight1: number = 10,
  lineHeight2: number = 14,
  font: string = '14px Arial',
  smallNodeHeight: number = 25
): number {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  if (!context || width <= 0) return 0;

  context.font = font;

  let firstPart = "";
  let secondPart = txt;

  if (txt.includes("<")) {
    const lastIndex = txt.lastIndexOf("<");
    firstPart = txt.substring(0, lastIndex).trim();
    secondPart = txt.substring(lastIndex + 1).trim();
  } 

  //
  firstPart = firstPart.replace(/</g, '\n'); // Replace all "<" with newline
  secondPart = secondPart.replace(/</g, '\n'); // Replace all "<" with newline

  // Split by newlines first
  const sections1 = firstPart.split('\n').filter(s => s.trim());
  let lines1 = 0;

  // Process each section (from newlines) for word wrapping
  for (const section of sections1) {
    const words = section.replace(/</g, ' ').split(' ').filter(w => w);
    let currentLine = '';
    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      if (context.measureText(testLine).width > width) {
        if (currentLine) {
          lines1++;
          currentLine = word;
        } else {
          lines1 += Math.ceil(context.measureText(word).width / width);
          currentLine = '';
        }
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines1++;
  }

  // Split by newlines first
  const sections2 = secondPart.split('\n').filter(s => s.trim());
  let lines2 = 0;

  // Process each section (from newlines) for word wrapping
  for (const section of sections2) {
    const words = section.replace(/</g, ' ').split(' ').filter(w => w);
    let currentLine = '';
    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      if (context.measureText(testLine).width > width) {
        if (currentLine) {
          lines2++;
          currentLine = word;
        } else {
          lines2 += Math.ceil(context.measureText(word).width / width);
          currentLine = '';
        }
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines2++;
  }

  // Add height for smaller nodes
  const extraNodes = (txt.match(/</g) || []).length;

  return (lines1 * lineHeight1) + (lines2 * lineHeight2) + (extraNodes * smallNodeHeight);
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