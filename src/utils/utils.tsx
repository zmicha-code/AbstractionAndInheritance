import { renderWidget, useTracker, Rem, usePlugin, RNPlugin, RichTextInterface, RemType, REM_TYPE } from "@remnote/plugin-sdk";

import { NodeData } from "../components/Nodes";

export const specialTags = ["Document", "Template Slot", "Tag", "Tags", "Header", "Deck", "Flashcards", "Rem With An Alias", "Automatically Sort", "Document", "Highlight", "Hide Bullets", "Status"];

export const specialNames = ["Hide Bullets", "Status", "query:", "query:#", "contains:", "Document", "Tags", "Rem With An Alias", "Highlight", "Tag", "Color", "Alias", "Bullet Icon"]; // , "Definition", "Eigenschaften"

export const specialNameParts = ["query:", "contains:"];

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

// Helper function to check if a Rem is a descriptor
export async function isDescriptor(plugin: RNPlugin, rem: Rem): Promise<boolean> {
    const type = await rem.getType();
    return type === RemType.DESCRIPTOR;
}

export async function isConcept(plugin: RNPlugin, rem: Rem): Promise<boolean> {
    const type = await rem.getType();
    return type === RemType.CONCEPT;
}

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

/**
 * Returns true if `candidateDescendant` is already a descendant of `ancestorRem` in the Rem hierarchy,
 * by walking parent links and avoiding cycles.
 */
export async function isRemAncestor(
  plugin: RNPlugin,
  ancestorRem: Rem,
  candidateDescendant: Rem,
  visited = new Set<string>()
): Promise<boolean> {
  // Direct match
  if (candidateDescendant._id === ancestorRem._id) {
    return true;
  }
  // Prevent cycles
  if (visited.has(candidateDescendant._id)) {
    return false;
  }
  visited.add(candidateDescendant._id);

  // Walk to parent
  const parent = await candidateDescendant.getParentRem();
  if (parent) {
    // If parent matches ancestor
    if (parent._id === ancestorRem._id) {
      return true;
    }
    // Recurse up
    return isRemAncestor(plugin, ancestorRem, parent, visited);
  }
  // No more parents
  return false;
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
    //console.log("REM is a DESCRIPTOR with TAGS:" + await getRemText(plugin, tags[0]));

    for (const tag of tags) {
      if (tag && await tag.getType() == RemType.CONCEPT ) {
        parents.push(tag);
      }
    }
  } else
    console.log("DESCRIPTOR HAS NO TAGS TO INHERIT FROM")

  // DESCRIPTORS inherit through Rem Hierarchie and their type is set implicitly by Rem Hierarchie if their type is not set through TAGS
  if(parentRem && remType == RemType.DESCRIPTOR && tags.length == 0) {

    //console.log("REM has no TAGS and is a DESCRIPTOR");

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
  if(rem)
    return (await rem.remsBeingReferenced()).length != 0;
  
  return false;
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
// TODO: Multiple Lineages?
export async function isClassAncestor(plugin: RNPlugin, potentialAncestor: Rem, rem: Rem): Promise<boolean> {
  let currentRem: Rem | null = rem;

  while (currentRem && !await currentRem.isDocument()) {
    const classType = await getParentClassType(plugin, currentRem);

    if(classType == null) return false;

    if (classType[0] && classType[0]._id === potentialAncestor._id) {
      return true;
    }

    currentRem = classType[0];
  }
  return false;
}

export async function isSameBaseType_(plugin: RNPlugin, rem1: Rem, rem2: Rem): Promise <boolean> {


  const ancestors1 = (await getAncestorLineage(plugin, rem1));
  const ancestors2 = (await getAncestorLineage(plugin, rem2));

  if(!ancestors1 || !ancestors2) return false;

  const ancestors11 = ancestors1[0];
  const ancestors22 = ancestors2[0];

  if(!ancestors11 || !ancestors22) return false;

  return (ancestors11.length>0 ? ancestors11[ancestors11.length-1]._id : rem1._id) == (ancestors22.length>0 ? ancestors22[ancestors22.length-1]._id : rem2._id);
}

/**
 * Returns the deepest (base) type Rem for a given Rem by examining its ancestor lineages.
 */
export async function getBaseType(plugin: RNPlugin, rem: Rem): Promise<Rem> {
  // Retrieve all ancestor lineages
  const lineages = await getAncestorLineage(plugin, rem);
  
  // If there are no ancestors, the base type is the rem itself
  if (!lineages || lineages.length === 0) {
    return rem;
  }

  // Choose the first lineage (primary path) and take its last element
  const primaryLineage = lineages[0];
  if (primaryLineage.length === 0) {
    return rem;
  }

  return primaryLineage[primaryLineage.length - 1];
}

/**
 * Determines whether two Rems share the same base type by comparing their base Rem._id values.
 */
export async function isSameBaseType(
  plugin: RNPlugin,
  rem1: Rem,
  rem2: Rem
): Promise<boolean> {
  const [base1, base2] = await Promise.all([
    getBaseType(plugin, rem1),
    getBaseType(plugin, rem2),
  ]);

  return base1._id === base2._id;
}

// Function to get the closest class parent for a Rem
export async function getParentClassType(plugin: RNPlugin, rem: Rem): Promise<Rem[] | null> {
  if (!rem) return null;

  const parent = await rem.getParentRem();
  const type = await rem.getType();
  const isReferencing = await isReferencingRem(plugin, rem);
  const isDocument = await rem.isDocument();
  const isSlot = await rem.isSlot();
  const tags = await getCleanTags(plugin, rem);

  // DOCUMENT with TAGS. This should never happen. A DOCUMENT should always define a new type and therefore have no parents through tags.
  if (isDocument && tags.length > 0) {
    await plugin.app.toast('Mistake: DOCUMENT with TAG. (' + await getRemText(plugin, rem) + ")");
    //return tags[0];
    return null;
  } 

  // DOCUMENT without TAGS. Defines a new Type. Has no other parent Type
  if (isDocument)
    return [rem];

  // SLOT with TAG.
  // NEW: We dont use TAGS for inheritance any more
  if(isSlot && tags.length > 0) {
    await plugin.app.toast('Mistake: SLOT with TAG. (' + await getRemText(plugin, rem) + ")");
    //return [tags[0]];
    return null
  }

  if(isSlot && isReferencing) {
    const referencedRem = (await rem.remsBeingReferenced())[0];
    return [referencedRem]
  }

  // SLOT without TAG: Property of new Type
  if(isSlot) {
    //await plugin.app.toast('Mistake: SLOT without TAG.' + (await getRemText(plugin, rem)) + ")");
    return [rem];
  }

  // CONCEPT, DOCUMENT, without TAGS
  // Case already covered with isDocument
  //if(type === RemType.CONCEPT && isDocument && tags.length == 0) {
  //  return rem;
  //}

  // CONCEPT with TAGS
  // OLD: Inherits Type from TAG
  // NEW: Inheritance no longer through TAGS but with REFS like in the case of DESCRIPTORS instead
  if (type === RemType.CONCEPT && tags.length > 0) {
    await plugin.app.toast('Mistake: CONCEPT with TAG. (' + await getRemText(plugin, rem) + ")");
    return [tags[0]];
  } 

  // Inherits Type from REF
  if(type === RemType.CONCEPT && isReferencing) {
    const referencedRem = (await rem.remsBeingReferenced())[0];

    if(parent && await isSameBaseType(plugin, referencedRem, parent))
      return [parent, referencedRem]

    return [referencedRem];
  }
  
  // Concept, without TAGS
  // Inherits Type from Rem Parent
  if (type === RemType.CONCEPT && tags.length == 0) {

      if(!parent) return [rem]; // || await getRemText(plugin, parent) == "Eigenschaften" || await getRemText(plugin, parent) == "Definition"

      return [parent];
  } 

  // DESCRIPTOR with TAG. Should this happen? Cant think of a usecase
  if(type == RemType.DESCRIPTOR && !isReferencing && tags.length > 0) {
    await plugin.app.toast('Potential Mistake: DESCRIPTOR with TAG.');
    return [tags[0]];
}

  // DESCRIPTOR without TAG
  // Defines an interface with the type of the parent rem
  if(type == RemType.DESCRIPTOR && !isReferencing && tags.length == 0) {
    // Soon deprecated
    if(!parent) return null; // || await getRemText(plugin, parent) == "Eigenschaften" || await getRemText(plugin, parent) == "Definition"

    return [parent];
  }

  // REF DESCRIPTOR with TAG
  // TODO?

  // REF DESCRIPTOR without TAG
  // Implements a layer with type of reference
  if (type === RemType.DESCRIPTOR && isReferencing) {
      const referencedRem = (await rem.remsBeingReferenced())[0];

      const referencedClass = referencedRem; //await getParentClassType(plugin, referencedRem);

      if(await referencedRem.isDocument()) {
        //console.log("Referenced Rem is document");

        return [referencedClass];
      }

      // Special case (Interface implementation/Same Type): referenced Rem's parent is an ancestor of descriptor's parent
      // TODO: Multiple lineages?
      if (referencedClass && parent && await isSameBaseType(plugin, referencedClass, parent)) { // await isClassAncestor(plugin, referencedClass, parent)

        // TODO:

        //console.log("We are here");

        return [parent, referencedClass];
      } else {
        // Inherit from the referenced Rem's class type
        //return getClassType(plugin, referencedRem);

        //console.log("REF DESCRIPTOR " + await getRemText(plugin, rem) + " is of type " + await getRemText(plugin, referencedRem));

        return [referencedRem];
      }
  }

  return null; // Default case, though should be handled above
} 

export async function getAncestorLineageOld(plugin: RNPlugin, rem: Rem): Promise<Rem[][]> {
  const lineage: Rem[] = [];
  const visited = new Set<string>([rem._id]); // Track visited Rem IDs
  let currentRem: Rem | null = rem;

  while (currentRem) {

      const classType = await getParentClassType(plugin, currentRem);

      if (classType && !visited.has(classType[0]._id)) {
        lineage.push(classType[0]);
        visited.add(classType[0]._id);
        currentRem = classType[0];
      } else {
        break;
      }
  }

  return [lineage];
}


export async function getAncestorLineage(plugin: RNPlugin, rem: Rem): Promise<Rem[][]> {
  const lineages = await findPaths(plugin, rem, [rem]);
  return lineages;
}

async function findPaths(plugin: RNPlugin, currentRem: Rem, currentPath: Rem[]): Promise<Rem[][]> {
  const parents = (await getParentClassType(plugin, currentRem)) || [];

  if (parents.length === 1 && parents[0]._id === currentRem._id) {
    return [currentPath];
  } else {
    const allPaths: Rem[][] = [];
    for (const parent of parents) {
      if (!currentPath.some(r => r._id === parent._id)) {
        const parentPaths = await findPaths(plugin, parent, [...currentPath, parent]);
        allPaths.push(...parentPaths);
      }
    }
    return allPaths;
  }
}

// Function to get the ancestor lineage as a string
// TODO: Use getAncestorLineage
export async function getAncestorLineageString_(plugin: RNPlugin, rem: Rem): Promise<string> {
  //const lineage: Rem[] = [rem];
  const lineage: Rem[] = [];
  const visited = new Set<string>([rem._id]); // Track visited Rem IDs
  let currentRem: Rem | null = rem;

  while (currentRem) {
      const classType = await getParentClassType(plugin, currentRem);
      if (classType && !visited.has(classType[0]._id)) {
        lineage.push(classType[0]);
        visited.add(classType[0]._id);
        currentRem = classType[0];
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

export async function getAncestorLineageString(plugin: RNPlugin, rem: Rem): Promise<string> {
  const lineages = await getAncestorLineage(plugin, rem);
  const validLineages = lineages.filter(lineage => lineage.length > 1);
  const lineageStrings = await Promise.all(validLineages.map(async (lineage) => {
      const ancestors = lineage.slice(1);
      const ancestorTexts = await Promise.all(ancestors.map(r => getRemText(plugin, r, true)));
      return ancestorTexts.join(" -> ");
  }));
  return "[Lineage]: " + lineageStrings.join("; [Lineage] :");
}

export async function getAncestorLineageStrings(plugin: RNPlugin, rem: Rem): Promise<string[]> {
  const lineages = await getAncestorLineage(plugin, rem);
  const validLineages = lineages.filter(lineage => lineage.length > 1);
  const lineageStrings = await Promise.all(validLineages.map(async (lineage) => {
      const ancestors = lineage.slice(1);
      const ancestorTexts = await Promise.all(ancestors.map(r => getRemText(plugin, r, true)));
      return ancestorTexts.join(" -> ");
  }));
  return lineageStrings;
}

export async function getCleanTags(plugin: RNPlugin, rem: Rem): Promise<Rem[]> {
  const tagRems = await rem.getTagRems();
  const cleanTags: Rem[] = [];
  for (const tagRem of tagRems) {
    const text = await getRemText(plugin, tagRem);
    if (!specialTags.includes(text)) {
      cleanTags.push(tagRem);
    }
  }
  return cleanTags;
}

export async function getCleanChildren(plugin: RNPlugin, rem: Rem): Promise<Rem[]> {
  const childrenRems = await rem.getChildrenRem();
  const cleanChildren: Rem[] = [];
  for (const childRem of childrenRems) {
    const text = await getRemText(plugin, childRem);
    if (
      !specialNames.includes(text) && 
      !specialNameParts.some(part => text.startsWith(part))
    ) {
      cleanChildren.push(childRem);
    }
  }
  return cleanChildren;
}

export async function hasClassProperty(plugin: RNPlugin, properties: Rem[], property: Rem): Promise<boolean> {

  const classType = await getParentClassType(plugin, property);

  if(!classType) return false;

  for(const p of properties) {
    const pClassType = await getParentClassType(plugin, p);

    if(!pClassType) return false;

    if(classType[0]._id == pClassType[0]._id)
      return true;
  }

  return false;
}

export async function getClassProperties(plugin: RNPlugin, rem: Rem): Promise<Rem[]> {
  const properties: Rem[] = [];
  const processedTypes = new Set<string>();

  // Get all lineages for the current Rem
  const lineages = await getAncestorLineage(plugin, rem);

  // Get the list of Rems being referenced by the current Rem once
  const referencedRems = await rem.remsBeingReferenced();
  const referencedIds = new Set<string>(referencedRems.map(r => r._id));

  // Process each lineage
  for (const lineage of lineages) {
    for (const currentRem of lineage) {
      const remChildren = await getCleanChildren(plugin, currentRem);

      for (const c of remChildren) {
        //const cType = await getParentClassType(plugin, c);

        //if (!cType || cType.length === 0) continue;

        //const typeId = cType[0]._id;

        if (await isConcept(plugin, c) && !referencedIds.has(c._id)) {
          //processedTypes.add(typeId);
          properties.push(c);

          const visited = new Set<string>([c._id]);
          await collectConceptChildren(plugin, c, properties, visited, lineage, referencedIds);

          if (await isReferencingRem(plugin, c)) {
            const referencedRem = (await c.remsBeingReferenced())[0];
            await collectConceptChildren(plugin, referencedRem, properties, visited, lineage, referencedIds);
          }
        }
        // new
        const visited = new Set<string>([c._id]);
        await collectConceptChildren(plugin, c, properties, visited, lineage, referencedIds);
      }
    }
  }

  return properties;
}

// Helper function to recursively collect concept children with the same type
async function collectConceptChildren(
  plugin: RNPlugin,
  conceptRem: Rem,
  properties: Rem[],
  visited: Set<string>,
  lineage: Rem[],
  referencedIds: Set<string> // Added to check referenced Rems
) {
  const children = await getCleanChildren(plugin, conceptRem);
  for (const child of children) {
    if (!visited.has(child._id) && await isConcept(plugin, child)) {
      if (await isSameBaseType(plugin, conceptRem, child)) {
        // Check if any ancestor references this child property
        const referencingAncestor = await findReferencingAncestor(plugin, conceptRem, child);
        if (referencingAncestor && !referencedIds.has(referencingAncestor._id)) {
          if (!visited.has(referencingAncestor._id)) {
            properties.push(referencingAncestor);
            visited.add(referencingAncestor._id);
          }
        } else if (!referencedIds.has(child._id)) {
          properties.push(child);
          visited.add(child._id);
          await collectConceptChildren(plugin, child, properties, visited, lineage, referencedIds);
        }
      }
    }

    // Search deeper descriptors for CONCEPTS of the same type
    if (!visited.has(child._id) && await isDescriptor(plugin, child)) {
      if (await isSameBaseType(plugin, conceptRem, child)) {
        visited.add(child._id);
        await collectConceptChildren(plugin, child, properties, visited, lineage, referencedIds);
      }
    }
  }
}

/*
export async function getClassProperties(plugin: RNPlugin, rem: Rem, areConcepts = true): Promise<Rem[]> {
  const properties: Rem[] = [];
  const processedTypes = new Set<string>();

  // Get all lineages for the current Rem
  const lineages = await getAncestorLineage(plugin, rem);

  // Get the list of Rems being referenced by the current Rem once
  const referencedRems = await rem.remsBeingReferenced();
  const referencedIds = new Set<string>(referencedRems.map(r => r._id));

  // Process each lineage
  for (const lineage of lineages) {
    for (const currentRem of lineage) {
      const remChildren = await getCleanChildren(plugin, currentRem);

      for (const c of remChildren) {
        const cType = await getParentClassType(plugin, c);

        if (!cType || cType.length === 0) continue;

        const typeId = cType[0]._id;

        if (((await isConcept(plugin, c) && areConcepts) || (!(await isConcept(plugin, c)) && !areConcepts)) && !referencedIds.has(c._id)) {
          processedTypes.add(typeId);
          properties.push(c);

          const visited = new Set<string>([c._id]);
          await collectConceptChildren(plugin, c, properties, visited, lineage, referencedIds, areConcepts);

          if (await isReferencingRem(plugin, c)) {
            const referencedRem = (await c.remsBeingReferenced())[0];
            await collectConceptChildren(plugin, referencedRem, properties, visited, lineage, referencedIds, areConcepts);
          }
        }
      }
    }
  }

  return properties;
}

// Helper function to recursively collect concept children with the same type
async function collectConceptChildren(
  plugin: RNPlugin,
  conceptRem: Rem,
  properties: Rem[],
  visited: Set<string>,
  lineage: Rem[],
  referencedIds: Set<string>, // Added to check referenced Rems
  areConcepts: boolean
) {
  const children = await getCleanChildren(plugin, conceptRem);
  for (const child of children) {
    if (!visited.has(child._id) && ((await isConcept(plugin, child) && areConcepts) || !(await isConcept(plugin, child) && !areConcepts))) {
      if (await isSameBaseType(plugin, conceptRem, child)) {
        // Check if any ancestor references this child property
        const referencingAncestor = await findReferencingAncestor(plugin, conceptRem, child);
        if (referencingAncestor && !referencedIds.has(referencingAncestor._id)) {
          if (!visited.has(referencingAncestor._id)) {
            properties.push(referencingAncestor);
            visited.add(referencingAncestor._id);
          }
        } else if (!referencedIds.has(child._id)) {
          properties.push(child);
          visited.add(child._id);
          await collectConceptChildren(plugin, child, properties, visited, lineage, referencedIds, areConcepts);
        }
      }
    }

    // Search deeper descriptors for CONCEPTS of the same type
    if (!visited.has(child._id) && await isDescriptor(plugin, child)) {
      if (await isSameBaseType(plugin, conceptRem, child)) {
        visited.add(child._id);
        await collectConceptChildren(plugin, child, properties, visited, lineage, referencedIds, areConcepts);
      }
    }
  }
}
  */

// Helper function to find if any ancestor in the lineage references the property
async function findReferencingAncestor(plugin: RNPlugin, rem: Rem, property: Rem): Promise<Rem | undefined> {
  let currentAncestor = await rem.getParentRem();
  
  while (currentAncestor) {
    const children = await getCleanChildren(plugin, currentAncestor);
    
    for (const child of children) {
      const references = await child.remsBeingReferenced();
      if (references.some(ref => ref._id === property._id)) {
        return child;
      }
    }
    
    // Dont search parent of document
    //if(await currentAncestor.isDocument())
    //  return undefined;
    const parentAncestor = await currentAncestor.getParentRem();

    currentAncestor = parentAncestor;
  }
  
  return undefined;
}

export async function getDescriptorRoot(plugin: RNPlugin, descriptor: Rem): Promise<Rem> {
  if (!isReferencingRem(plugin, descriptor)) {
    return descriptor;
  }

  const referencedRems = await descriptor.remsBeingReferenced();
  if (referencedRems && referencedRems.length > 0) {
    return getDescriptorRoot(plugin, referencedRems[0]);
  } else {
    return descriptor;
  }
}

export async function getClassDescriptors(plugin: RNPlugin, rem: Rem): Promise<Rem[]> {
  const descriptorMap = new Map<string, Rem>(); // Map from root._id to descriptor Rem
  const originalRem = rem; // Store the original rem for base type comparison

  // Get all lineages for the current Rem
  const lineages = await getAncestorLineage(plugin, rem);

  // Process each lineage
  for (const lineage of lineages) {
    for (const currentRem of lineage.slice(1)) {
      const remChildren = await getCleanChildren(plugin, currentRem);
      for (const c of remChildren) {
        await collectDescriptors(plugin, c, descriptorMap, originalRem);
      }
    }
  }

  // Return the unique descriptors, with descendant descriptors overriding ancestor ones
  return Array.from(descriptorMap.values());
}

async function hasLayer(plugin: RNPlugin, rem: Rem, layer: Rem): Promise<boolean> {
  // Get all lineages from the given rem to its ancestors
  const lineages = await getAncestorLineage(plugin, rem);
  
  // Collect unique ancestors, excluding the rem itself
  const ancestorsSet = new Set<Rem>();
  for (const lineage of lineages) {
    for (let i = 1; i < lineage.length; i++) {
      ancestorsSet.add(lineage[i]);
    }
  }
  const ancestors = Array.from(ancestorsSet);
  
  // Fetch children of all ancestors concurrently
  const childrenPromises = ancestors.map(ancestor => getCleanChildren(plugin, ancestor));
  const childrenArrays = await Promise.all(childrenPromises);
  const allChildren = childrenArrays.flat();
  
  // Check if any child has the same base type as layer, concurrently
  const checks = allChildren.map(child => isSameBaseType(plugin, child, layer));
  const results = await Promise.all(checks);
  
  // Return true if any child matches, false otherwise
  return results.some(result => result);
}

async function collectDescriptors(plugin: RNPlugin, rem: Rem, descriptorMap: Map<string, Rem>, originalRem: Rem) {
  const isDescriptor = await rem.getType() == RemType.DESCRIPTOR;
  //const hasNoTags = (await getCleanTags(plugin, rem)).length == 0;

  if (isDescriptor) { // && hasNoTags
    const root = await getDescriptorRoot(plugin, rem);
    if (!descriptorMap.has(root._id)) { // await isSameBaseType(plugin, originalRem, rem) &&
      //console.log("Attempting to Add: " + await getRemText(plugin, rem) + "(" + await getRemText(plugin, await getBaseType(plugin, rem)) + ")");

      if(await hasLayer(plugin, originalRem, rem)) {
        //console.log("Success: " + await getRemText(plugin, originalRem) + " has layer " + await getRemText(plugin, await getBaseType(plugin, rem)));
        descriptorMap.set(root._id, rem); // Add only if same base type and not already present
      }
      //else 
      //  console.log(await getRemText(plugin, originalRem) + " has no layer " + await getRemText(plugin, await getBaseType(plugin, rem)));

      // Recursively process children
      const children = await getCleanChildren(plugin, rem);
      for (const child of children) {
        //if(await isSameBaseType(plugin, originalRem, child) || await isSameBaseType(plugin, rem, child))
        await collectDescriptors(plugin, child, descriptorMap, originalRem);
      }
    }

    // Recurse call was here for some reason
  }
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