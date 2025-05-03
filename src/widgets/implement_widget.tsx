import { usePlugin, renderWidget, useTracker, Rem, RemType, SetRemType,
    RichTextElementRemInterface, RichTextInterface, RNPlugin } from '@remnote/plugin-sdk';
import { useEffect, useState } from 'react';
import { getRemText, isRemAncestor,getBaseType, isConcept, isDescriptor, isReferencingRem, getParentClassType, getAncestorLineage, isSameBaseType, getClassDescriptors, getClassProperties, getCleanChildren} from '../utils/utils';
import MyRemNoteButton from '../components/MyRemNoteButton';

// Define interface for descriptor items
interface DescriptorItem {
    rem: Rem;
    text: string;
    isSlot: boolean;
    isDescriptor: boolean;
}

// Function to create a new Rem with a reference to the descriptor
async function createRemWithReference(plugin: RNPlugin, parentRem: Rem, descriptorRem: Rem): Promise<void> {
    const newRem = await plugin.rem.createRem();
    if (newRem) {
        const referenceElement: RichTextElementRemInterface = {
            i: 'q',
            _id: descriptorRem._id
        };
        const richText: RichTextInterface = [referenceElement];
        await newRem.setText(richText);
        await newRem.setParent(parentRem._id);
        await newRem.setType(SetRemType.DESCRIPTOR);
    }
}

async function createPropertyReference(plugin: RNPlugin, parentRem: Rem, propertyRem: Rem): Promise<void> {
    const newRem = await plugin.rem.createRem();
    if (newRem) {
        const referenceElement: RichTextElementRemInterface = {
            i: 'q',
            _id: propertyRem._id
        };
        const richText: RichTextInterface = [referenceElement];
        await newRem.setText(richText);
        await newRem.setParent(parentRem._id);
        await newRem.setType(SetRemType.CONCEPT);
    }
}

// Check if a child with the given text already exists
async function hasChildWithText(plugin: RNPlugin, parentRem: Rem, targetText: string): Promise<boolean> {
    if (!parentRem || !targetText) {
        return false;
    }
    const children = await parentRem.getChildrenRem();
    for (const child of children) {
        const childText = await getRemText(plugin, child);
        if (childText === targetText) {
            return true;
        }
    }
    return false;
}

/*
async function collectDescendantDescriptors(plugin: RNPlugin, rem: Rem, root: Rem): Promise<DescriptorItem[]> {
    let result: DescriptorItem[] = [];
    const children = await rem.getChildrenRem();

    //if (rem._id == root._id) return result;

    for (const child of children) {

        if(child._id == root._id) continue;

        //if (await isSameClassType(plugin, child, root)) {
            if (await isDescriptor(plugin, child) || await child.isSlot()) { //await isReferencingRem(plugin, child)
                const text = await getRemText(plugin, child, true);
                result.push({ rem: child, text: text, isSlot: (await child.isSlot()), isDescriptor: (!await isReferencingRem(plugin, child) && await isReferencingRem(plugin, rem)) });

                // Recursively collect descriptors from this child
                if (await isSameClassType(plugin, child, root)) {
                    const childDescriptors = await collectDescendantDescriptors(plugin, child, root);
                    result = result.concat(childDescriptors);
                }
            }
        //} 
    }
    return result;
}
    */


async function isRootHierarchieLevel(plugin: RNPlugin, rem: Rem, root: Rem): Promise<boolean> {
    const children = await rem.getChildrenRem();

    for (const child of children) {

        if(child._id == root._id) return true;
    }
    
    return false;
}

// TODO:  Cover the case where a rem is a sibling through referencing the parent
async function isSibling(plugin: RNPlugin, rem: Rem, root: Rem): Promise <boolean> {

    if((await rem.getParentRem())?._id == (await root.getParentRem())?._id) // && !await ancestor.isDocument()
        return true;

    return false;
}

// Is any of the ancestors of root a sibling to rem
/*
async function isSiblingOfAncestor(plugin: RNPlugin, rem: Rem, root: Rem): Promise<boolean> {

    if (await isSibling(plugin, rem, root)) 
        return true;

    const ancestors = await getAncestorLineage(plugin, root);

    if(ancestors.length == 0)
        return false;

    return isSiblingOfAncestor(plugin, rem, ancestors[0]);
}
    */

/*
async function isDifferentFamily(plugin: RNPlugin, rem: Rem, root: Rem): Promise<boolean> {

    const ancestors = await getAncestorLineage(plugin, root);
    const remAncestor = await getClassType(plugin, rem);

    for(const ancestor of ancestors) {
        if(ancestor._id == remAncestor?._id)
            return true;
    }


    return false;
}
    */

async function isOfSpecificType(plugin: RNPlugin, rem: Rem, root: Rem): Promise<boolean> {

    const ancestors = (await getAncestorLineage(plugin, root))[0];
    const remType = await getParentClassType(plugin, rem);

    if(remType == null) return false;

    for(const ancestor of ancestors) {
        if(ancestor._id == remType[0]?._id)
            return true;
    }

    return false;
}

async function collectDescendantDescriptors(plugin: RNPlugin, rem: Rem, root: Rem): Promise<DescriptorItem[]> {
    let result: DescriptorItem[] = [];
    const children = await rem.getChildrenRem();
    //const isRoot = await isRootHierarchieLevel(plugin, rem, root);

    // Parents and Root are the Same Type
    if (await isSameBaseType(plugin, rem, root)) {
        //console.log(await getRemText(plugin, rem) + " and has same base type as " + await getRemText(plugin, root));

        for (const child of children) {

            if(child._id == root._id) continue;

            const isChildDescriptor = await isDescriptor(plugin, child);
            const isChildConcept = await isConcept(plugin, child);
            const isChildSlot = await child.isSlot();
            const isChildDocument = await child.isDocument();
            const isChildReferencing = await isReferencingRem(plugin, child);
            const isSameType = await isOfSpecificType(plugin, child, root);

            //const notHigherHierarchie = await isDifferentFamily(plugin, child, root); // await isSiblingOfAncestor(plugin, child, root) ||

            // OLD: Only offer concepts for implementation if they are of higher hierarchie
            // NEW: WHY? FOR WHICH CASE?
            // TODO: SLOT only if of specifig type
            // CONCEPTS can not be implemented if same type (thats what DESCRIPTORS are for). CONCEPTS can only be implemented if of different type.
            if ((isChildDescriptor || (isChildSlot) || isChildDocument || (isChildConcept && !isSameType)) && // || (await isConcept(plugin, child) && !notHigherHierarchie) // && isSameType
                !(await isDescriptor(plugin, child) && await child.isDocument() )) {

                const text = await getRemText(plugin, child, true);
                result.push({ rem: child, text: text, isSlot: isChildSlot, isDescriptor: (!isChildReferencing && await isReferencingRem(plugin, rem)) });

                // OLD: One can not implement ...
                // NEW: WHY? FOR WHICH CASE?
                //if(!(isChildDescriptor && !isChildReferencing)) {
                    const childDescriptors = await collectDescendantDescriptors(plugin, child, root);
                    result = result.concat(childDescriptors);
                //}

                // Special Case: Normally DESCRIPTOR REF are of different type. However, if same type -> implement specifig Interface in addition
                if(isChildDescriptor && isChildReferencing && await isSameBaseType(plugin, child, root)) {
                    const interfaces = await child.remsBeingReferenced();

                    for(const i of interfaces) {
                        //console.log("Special Implementation: Interface: " + await getRemText(plugin, i));
                        const childDescriptors = await collectDescendantDescriptors(plugin, i, child);
                        result = result.concat(childDescriptors);
                    }
                }
            }
        }
    } else {
        //console.log(await getRemText(plugin, rem) + " and " + await getRemText(plugin, root) + " are not the same class type.")
        for (const child of children) {
            if (await isConcept(plugin, child) && !await child.isDocument() && !await child.isSlot()) { //await isReferencingRem(plugin, child)
                const text = await getRemText(plugin, child, true);
                result.push({ rem: child, text: text, isSlot: false, isDescriptor: true });

                const childDescriptors = await collectDescendantDescriptors(plugin, child, root);
                result = result.concat(childDescriptors);
            }

            // e.g. Character > Monsters > Boss in Campaign > Boss
            if(await isDescriptor(plugin, child) && !await isReferencingRem(plugin, child)) {
                // Dont add Descriptor but search for child Concepts
                const childDescriptors = await collectDescendantDescriptors(plugin, child, root);
                result = result.concat(childDescriptors);
            }

            /*
            if(await isReferencingRem(plugin, child)) {
                const childDescriptors = await collectDescendantDescriptors(plugin, child, root);
                result = result.concat(childDescriptors);
            }
                */
        }
    }

    return result;
}

// TODO: Remove Repeating Code
async function getDescriptors(plugin: RNPlugin, focusedRem: Rem): Promise<DescriptorItem[]> {

    let desc: DescriptorItem[] = [];
    
    if (!focusedRem) {
        console.log("Not a valid Rem");
        return desc;
    }

    const parentRem = await focusedRem.getParentRem();
    const parentRemAncestor = await getParentClassType(plugin, parentRem as Rem);
    const ancestorRems = (await getAncestorLineage(plugin, focusedRem))[0]; 

    if (ancestorRems.length === 0) {
        console.log(await getRemText(plugin, focusedRem) + " has no valid Parents");
        return desc;
    }

    // Special Case: Normally DESCRIPTOR REF are of different type. However, if same type -> implement specific Interface in addition
    if(await focusedRem.getType() == RemType.DESCRIPTOR && await isReferencingRem(plugin, focusedRem)) { // && await isSameBaseType(plugin, focusedRem, (await focusedRem.remsBeingReferenced())[0])
        const interfaces = await focusedRem.remsBeingReferenced();

        for(const i of interfaces) {
            //console.log("Special Implementation: Interface: " + await getRemText(plugin, i));

            const interfaceDescriptors = await collectDescendantDescriptors(plugin, i, focusedRem);
            
            for (const descriptor of interfaceDescriptors) {
                let text = descriptor.text;
    
                if (text.lastIndexOf(">") !== -1) {
                    text = text.substring(text.lastIndexOf(">") + 1);
                }
    
                // Define specialNames
                const specialNames = ["Hide Bullets", "Status", "query:", "query:#", "contains:", "Document", "Tags", "Rem With An Alias", "Highlight", "Tag", "Color", "Alias", "Bullet Icon"];
                
                // Check if the descriptor text is in specialNames or is "Collapse Tag Configure"
                const isSpecial = specialNames.some(special => text.includes(special)) || text.includes("Collapse Tag Configure");
    
                // Check if Descriptor is already present and not special
                if (!isSpecial && !await hasChildWithText(plugin, focusedRem, text) && !desc.some(d => d.rem._id === descriptor.rem._id) && (descriptor.rem._id != parentRem?._id) && parentRemAncestor != null && descriptor.rem._id != parentRemAncestor[0]?._id ) {
    
                    //console.log(await getRemText(plugin, descriptor.rem) + " !=  Parent Rem: " + await getRemText(plugin, parentRem as Rem));
                    //console.log("Descriptor Rem ID: " + descriptor.rem._id + " != Parent Rem ID: " + parentRem?._id);
                    desc.push(descriptor);
                }
            }
        }
    }

    for (const ancestorRem of ancestorRems) {
        // Collect all descendant descriptors recursively

        //console.log("Get Descriptors for " + await getRemText(plugin, ancestorRem));

        const descriptors = await collectDescendantDescriptors(plugin, ancestorRem, focusedRem);

        for (const descriptor of descriptors) {
            let text = descriptor.text;

            if (text.lastIndexOf(">") !== -1) {
                text = text.substring(text.lastIndexOf(">") + 1);
            }

            // Define specialNames
            const specialNames = ["Hide Bullets", "Status", "query:", "query:#", "contains:", "Document", "Tags", "Rem With An Alias", "Highlight", "Tag", "Color", "Alias", "Bullet Icon"];
            
            // Check if the descriptor text is in specialNames or is "Collapse Tag Configure"
            const isSpecial = specialNames.some(special => text.includes(special)) || text.includes("Collapse Tag Configure");

            // Check if Descriptor is already present and not special
            if (!isSpecial && !await hasChildWithText(plugin, focusedRem, text) && !desc.some(d => d.rem._id === descriptor.rem._id) && (descriptor.rem._id != parentRem?._id) && parentRemAncestor != null && descriptor.rem._id != parentRemAncestor[0]?._id ) {

                //console.log(await getRemText(plugin, descriptor.rem) + " !=  Parent Rem: " + await getRemText(plugin, parentRem as Rem));
                //console.log("Descriptor Rem ID: " + descriptor.rem._id + " != Parent Rem ID: " + parentRem?._id);
                desc.push(descriptor);
            }
        }
    }

    return desc;
}

// ImplementWidget component
/*
export function ImplementWidget() {
    const plugin = usePlugin();
    const [currentRem, setCurrentRem] = useState("No Rem Focused");
    const [descriptors, setDescriptors] = useState<DescriptorItem[]>([]);

    const focusedRem = useTracker(async (reactPlugin) => {
        return await reactPlugin.focus.getFocusedRem();
    });

    useEffect(() => {
        const fetchData = async () => {
            if (focusedRem) {
                const text = await getRemText(plugin, focusedRem);
                setCurrentRem(text);
                const descList = await getDescriptors(plugin, focusedRem);
                setDescriptors(descList);
            }
        };
        fetchData();
    }, [focusedRem, plugin]);

    const handleDescriptorClick = async (descriptor: Rem) => {
        await createRemWithReference(plugin, focusedRem!, descriptor);
        const updatedDesc = await getDescriptors(plugin, focusedRem!);
        setDescriptors(updatedDesc);

        plugin.window.closeFloatingWidget("implement_widget")
    };

    if (!focusedRem) return <div></div>;

    return (
        <div style={{ 
            border: '1px solid #ccc', 
            padding: '10px', 
            borderRadius: '5px', 
            overflowY: 'auto', 
            maxHeight: '500px',
            width: '100%', // Ensure full width
            boxSizing: 'border-box' // Include padding and border in width
        }}>
            <div style={{ marginBottom: '10px' }}>{currentRem}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {descriptors.map(({ rem, text, isSlot, isDescriptor}) => {
                    return (
                    <div style={{ marginLeft: (isDescriptor && !isSlot) || isSlot ? '16px' : '0px'}}>
                        <MyRemNoteButton
                            img={isSlot ? "M4.16667 2.5H15.8333C16.75 2.5 17.5 3.25 17.5 4.16667V15.8333C17.5 16.75 16.75 17.5 15.8333 17.5H4.16667C3.25 17.5 2.5 16.75 2.5 15.8333V13.3333C2.5 12.875 2.875 12.5 3.33333 12.5C3.79167 12.5 4.16667 12.875 4.16667 13.3333V15C4.16667 15.4583 4.54167 15.8333 5 15.8333H15C15.4583 15.8333 15.8333 15.4583 15.8333 15V5C15.8333 4.54167 15.4583 4.16667 15 4.16667H5C4.54167 4.16667 4.16667 4.54167 4.16667 5V6.66667C4.16667 7.125 3.79167 7.5 3.33333 7.5C2.875 7.5 2.5 7.125 2.5 6.66667V4.16667C2.5 3.25 3.24167 2.5 4.16667 2.5ZM13.1583 10.5833L10.1667 13.575C9.84167 13.9 9.31667 13.9 8.99167 13.575C8.675 13.2583 8.66667 12.725 8.99167 12.4L10.5583 10.8333H3.33333C2.875 10.8333 2.5 10.4583 2.5 10C2.5 9.54166 2.875 9.16666 3.33333 9.16666H10.5583L8.99167 7.59166C8.66667 7.26666 8.66667 6.74166 8.99167 6.41666C9.14736 6.26062 9.35874 6.17293 9.57917 6.17293C9.7996 6.17293 10.011 6.26062 10.1667 6.41666L13.1583 9.40833C13.4833 9.73333 13.4833 10.2583 13.1583 10.5833Z" : undefined}
                            key={rem._id}
                            text={text}
                            onClick={() => handleDescriptorClick(rem)}
                        />
                    </div>
                    )
                })}
            </div>
        </div>
    );
}
*/

export function ImplementWidget_NoGrouping() {
    const plugin = usePlugin();
    const [currentRem, setCurrentRem] = useState("No Rem Focused");
    const [descriptors, setDescriptors] = useState<{ rem: Rem; text: string }[]>([]);

    const focusedRem = useTracker(async (reactPlugin) => {
        return await reactPlugin.focus.getFocusedRem();
    });

    useEffect(() => {
        const fetchData = async () => {
            if (focusedRem) {
                const text = await getRemText(plugin, focusedRem);
                setCurrentRem(text);
                const descList = await getClassDescriptors(plugin, focusedRem);
                const descWithText = await Promise.all(
                    descList.map(async (rem) => ({
                        rem,
                        text: await getRemText(plugin, rem),
                    }))
                );
                setDescriptors(descWithText);
            }
        };
        fetchData();
    }, [focusedRem, plugin]);

    const handleDescriptorClick = async (descriptor: Rem) => {
        await createRemWithReference(plugin, focusedRem!, descriptor);
        const updatedDesc = await getClassDescriptors(plugin, focusedRem!);
        const updatedDescWithText = await Promise.all(
            updatedDesc.map(async (rem) => ({
                rem,
                text: await getRemText(plugin, rem),
            }))
        );
        setDescriptors(updatedDescWithText);
        plugin.window.closeFloatingWidget("implement_widget");
    };

    if (!focusedRem) return <div></div>;

    return (
        <div
            style={{
                border: '1px solid #ccc',
                padding: '10px',
                borderRadius: '5px',
                overflowY: 'auto',
                maxHeight: '500px',
                width: '100%',
                boxSizing: 'border-box',
            }}
        >
            <div style={{ marginBottom: '10px' }}>{currentRem}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {descriptors.map(({ rem, text }) => (
                    <MyRemNoteButton
                        key={rem._id}
                        text={text}
                        onClick={() => handleDescriptorClick(rem)}
                    />
                ))}
            </div>
        </div>
    );
}

export function ImplementWidget_DescriptorGrouping() {
    const plugin = usePlugin();
    const [currentRem, setCurrentRem] = useState("No Rem Focused");
    const [groupedDescriptors, setGroupedDescriptors] = useState<Map<string, { parent: Rem; parentText: string; descriptors: { rem: Rem; text: string }[] }>>(new Map());

    const focusedRem = useTracker(async (reactPlugin) => {
        return await reactPlugin.focus.getFocusedRem();
    });

    useEffect(() => {
        const fetchData = async () => {
            if (focusedRem) {
                const text = await getRemText(plugin, focusedRem);
                setCurrentRem(text);
                const descList = await getClassDescriptors(plugin, focusedRem);
                const descWithTextAndParent = await Promise.all(
                    descList.map(async (rem) => {
                        const text = await getRemText(plugin, rem);
                        const parent = await rem.getParentRem();
                        const parentText = parent ? await getRemText(plugin, parent) : "No Parent";
                        return { rem, text, parent, parentText };
                    })
                );

                // Group by parent._id
                const grouped = new Map<string, { parent: Rem; parentText: string; descriptors: { rem: Rem; text: string }[] }>();
                for (const { rem, text, parent, parentText } of descWithTextAndParent) {
                    if (parent) {
                        const parentId = parent._id;
                        if (!grouped.has(parentId)) {
                            grouped.set(parentId, { parent, parentText, descriptors: [] });
                        }
                        grouped.get(parentId)!.descriptors.push({ rem, text });
                    }
                }
                setGroupedDescriptors(grouped);
            }
        };
        fetchData();
    }, [focusedRem, plugin]);

    const handleDescriptorClick = async (descriptor: Rem) => {
        await createRemWithReference(plugin, focusedRem!, descriptor);
        const updatedDesc = await getClassDescriptors(plugin, focusedRem!);
        const updatedDescWithTextAndParent = await Promise.all(
            updatedDesc.map(async (rem) => {
                const text = await getRemText(plugin, rem);
                const parent = await rem.getParentRem();
                const parentText = parent ? await getRemText(plugin, parent) : "No Parent";
                return { rem, text, parent, parentText };
            })
        );
        const updatedGrouped = new Map<string, { parent: Rem; parentText: string; descriptors: { rem: Rem; text: string }[] }>();
        for (const { rem, text, parent, parentText } of updatedDescWithTextAndParent) {
            if (parent) {
                const parentId = parent._id;
                if (!updatedGrouped.has(parentId)) {
                    updatedGrouped.set(parentId, { parent, parentText, descriptors: [] });
                }
                updatedGrouped.get(parentId)!.descriptors.push({ rem, text });
            }
        }
        setGroupedDescriptors(updatedGrouped);
        plugin.window.closeFloatingWidget("implement_widget");
    };

    if (!focusedRem) return <div></div>;

    return (
        <div
            style={{
                border: '1px solid #ccc',
                padding: '10px',
                borderRadius: '5px',
                overflowY: 'auto',
                maxHeight: '500px',
                width: '100%',
                boxSizing: 'border-box',
            }}
        >
            <div style={{ marginBottom: '10px' }}>{currentRem}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {Array.from(groupedDescriptors.values()).map(({ parent, parentText, descriptors }) => (
                    <div key={parent._id} style={{ border: '1px solid #ddd', padding: '8px', borderRadius: '4px' }}>
                        <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>{parentText}</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {descriptors.map(({ rem, text }) => (
                                <MyRemNoteButton
                                    key={rem._id}
                                    text={text}
                                    onClick={() => handleDescriptorClick(rem)}
                                />
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}


  // Item category
type ItemType = "property" | "descriptor";

// Nested grouping structure: parent rem -> base type -> items
/*
interface BaseSubgroup {
  base: Rem;
  baseText: string;
  items: Array<{ rem: Rem; text: string; type: ItemType }>;
}
interface ParentGroup {
  parent: Rem;
  parentText: string;
  bases: Map<string, BaseSubgroup>;
}

  export function ImplementWidget() {
    const plugin = usePlugin() as RNPlugin;
    const [currentRem, setCurrentRem] = useState<string>("No Rem Focused");
    const [currentRemBase, setCurrentRemBase] = useState<string>("No Rem Focused");
    const [groupedItems, setGroupedItems] = useState<Map<string, ParentGroup>>(new Map());
    const [loading, setLoading] = useState<boolean>(true);
  
    const focusedRem = useTracker(async (reactPlugin) => {
      return await reactPlugin.focus.getFocusedRem();
    });
  
    // Build grouping: parent -> base -> items
    const buildGroupedItems = async (root: Rem) => {
      // gather existing children names
      const children = await getCleanChildren(plugin, root);
      const existingNames = new Set(
        await Promise.all(children.map((c) => getRemText(plugin, c)))
      );
      existingNames.add("Collapse Tag Configure Options");
  
      // fetch candidates
      const [props, descs] = await Promise.all([
        getClassProperties(plugin, root),
        getClassDescriptors(plugin, root),
      ]);
  
      // filter out self, existing, descendants
      const filterRems = async (list: Rem[]) => (
        await Promise.all(
          list.map(async (r) => {
            const text = await getRemText(plugin, r);
            const isDesc = await isRemAncestor(plugin, root, r);
            return (
              r._id !== root._id &&
              !existingNames.has(text) &&
              !isDesc
            ) ? r : null;
          })
        )
      ).filter((r): r is Rem => r !== null);
  
      const filteredList = [
        ...(await filterRems(props)).map(r => ({ rem: r, type: "property" as ItemType })),
        ...(await filterRems(descs)).map(r => ({ rem: r, type: "descriptor" as ItemType })),
      ];
  
      // annotate items
      const allItems = await Promise.all(
        filteredList.map(async ({ rem, type }) => {
          const text = await getRemText(plugin, rem);
          const base = await getBaseType(plugin, rem);
          const baseText = await getRemText(plugin, base);
          const parent = await rem.getParentRem();
          const parentText = parent ? await getRemText(plugin, parent) : "No Parent";
          return { rem, text, type, base, baseText, parent, parentText };
        })
      );
  
      // group by parent, then base
      const nested = new Map<string, ParentGroup>();
      for (const { rem, text, type, base, baseText, parent, parentText } of allItems) {
        if (!parent) continue;
        if (!nested.has(parent._id)) {
          nested.set(parent._id, { parent, parentText, bases: new Map() });
        }
        const parentGrp = nested.get(parent._id)!;
  
        if (!parentGrp.bases.has(base._id)) {
          parentGrp.bases.set(base._id, { base, baseText, items: [] });
        }
        parentGrp.bases.get(base._id)!.items.push({ rem, text, type });
      }
  
      // Remove duplicate items in each base subgroup
      for (const parentGrp of nested.values()) {
        for (const baseGrp of parentGrp.bases.values()) {
          const seenIds = new Set<string>();
          baseGrp.items = baseGrp.items.filter(({ rem }) => {
            if (seenIds.has(rem._id)) return false;
            seenIds.add(rem._id);
            return true;
          });
        }
      }
  
      return nested;
    };
  
    // initial load
    useEffect(() => {
      const init = async () => {
        setLoading(true);
        if (focusedRem) {
          const txt = await getRemText(plugin, focusedRem);
          setCurrentRem(txt);
          const base = await getBaseType(plugin, focusedRem);
          setCurrentRemBase(await getRemText(plugin, base));
          setGroupedItems(await buildGroupedItems(focusedRem));
        }
        setLoading(false);
      };
      init();
    }, [focusedRem, plugin]);
  
    // handle item click
    const handleItemClick = async (item: Rem, type: ItemType) => {
      if (!focusedRem) return;
      if (type === "descriptor") await createRemWithReference(plugin, focusedRem, item);
      else await createPropertyReference(plugin, focusedRem, item);
  
      setGroupedItems(await buildGroupedItems(focusedRem));
      plugin.window.closeFloatingWidget("implement_widget");
    };
  
    if (!focusedRem) return <div />;
  
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
        {loading ? (
          <div>Loading...</div>
        ) : (
          <>
            <div style={{
              marginBottom: 10,
              textAlign: 'center',
              fontWeight: 'bold',
              fontSize: '1.2em',
              padding: '8px',
            }}>
              {currentRem} ({currentRemBase})
            </div>
            <div style={{ overflowY: "auto", maxHeight: "calc(100vh - 40px)" }}>
              {Array.from(groupedItems.values()).map(({ parent, parentText, bases }) => (
                <div key={parent._id} style={{ marginBottom: 16, border: "1px solid #ddd", padding: 8, borderRadius: 4 }}>
                  <div style={{ fontWeight: "bold", marginBottom: 8 }}>{parentText}</div>
                  {Array.from(bases.values()).map(({ base, baseText, items }) => (
                    <div key={base._id} style={{ marginLeft: 12, marginBottom: 12 }}>
                      <div style={{ fontStyle: "italic", marginBottom: 4 }}>{baseText}</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {items.map(({ rem, text, type }) => (
                          <MyRemNoteButton
                            key={rem._id}
                            text={text}
                            img={
                              type === "property"
                                ? "M15 4h3a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3m0 3h6m-3 5h3m-6 0h.01M12 16h3m-6 0h.01M10 3v4h4V3h-4Z"
                                : "M5 4a2 2 0 0 0-2 2v1h10.968l-1.9-2.28A2 2 0 0 0 10.532 4H5ZM3 19V9h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Zm11.707-7.707a1 1 0 0 0-1.414 1.414l.293.293H8a1 1 0 1 0 0 2h5.586l-.293.293a1 1 0 0 0 1.414 1.414l2-2a1 1 0 0 0 0-1.414l-2-2Z"
                            }
                            onClick={() => handleItemClick(rem, type)}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }
*/
  // Nested grouping structure: base type -> parent rem -> items
interface ParentGroup {
    parent: Rem;
    parentText: string;
    items: Array<{ rem: Rem; text: string; type: ItemType }>;
}

interface BaseGroup {
    base: Rem;
    baseText: string;
    baseParent?: Rem;
    baseParentText?: string;
    parents: Map<string, ParentGroup>;
  }

    export function ImplementWidget_() {
        const plugin = usePlugin() as RNPlugin;
        const [currentRem, setCurrentRem] = useState<string>("No Rem Focused");
        const [currentRemBase, setCurrentRemBase] = useState<string>("No Rem Focused");
        const [groupedItems, setGroupedItems] = useState<Array<{ depth: number; group: BaseGroup }>>([]);
        const [loading, setLoading] = useState<boolean>(true);
        const [collapsedBases, setCollapsedBases] = useState<Set<string>>(new Set());
      
        const focusedRem = useTracker(async (reactPlugin) => {
          return await reactPlugin.focus.getFocusedRem();
        });
      
        const toggleBaseCollapse = (baseId: string) => {
          setCollapsedBases(prev => {
            const next = new Set(prev);
            if (next.has(baseId)) next.delete(baseId);
            else next.add(baseId);
            return next;
          });
        };
      
        // Build grouping: base -> parent -> items, also include baseParent
        const buildGroupedItems = async (root: Rem) => {
          const children = await getCleanChildren(plugin, root);
          const existingNames = new Set(await Promise.all(children.map(c => getRemText(plugin, c))));
          existingNames.add("Collapse Tag Configure Options");
      
          const [props, descs] = await Promise.all([
            getClassProperties(plugin, root),
            getClassDescriptors(plugin, root),
          ]);
      
          const filterRems = async (list: Rem[]) => (
            await Promise.all(list.map(async r => {
              const text = await getRemText(plugin, r);
              const isDesc = await isRemAncestor(plugin, root, r);
              return (r._id !== root._id && !existingNames.has(text) && !isDesc) ? r : null;
            }))
          ).filter((r): r is Rem => r !== null);
      
          const filtered = [
            ...(await filterRems(props)).map(r => ({ rem: r, type: "property" as ItemType })),
            ...(await filterRems(descs)).map(r => ({ rem: r, type: "descriptor" as ItemType })),
          ];
      
          const allItems = await Promise.all(filtered.map(async ({ rem, type }) => {
            const text = await getRemText(plugin, rem);
            const base = await getBaseType(plugin, rem);
            const baseText = await getRemText(plugin, base);
            // fetch base parent
            const baseParent = await base.getParentRem();
            const baseParentText = baseParent ? await getRemText(plugin, baseParent) : baseText;
            const parent = await rem.getParentRem();
            const parentText = parent ? await getRemText(plugin, parent) : "Base";
            return { rem, text, type, base, baseText, baseParent, baseParentText, parent, parentText };
          }));
      
          const nested = new Map<string, BaseGroup>();
          for (const item of allItems) {
            const { base, baseText, baseParent, baseParentText, parent, parentText, rem, text, type } = item;
            if (!nested.has(base._id)) {
              nested.set(base._id, { base, baseText, baseParent, baseParentText, parents: new Map() });
            }
            const bg = nested.get(base._id)!;
            if (parent) {
              if (!bg.parents.has(parent._id)) bg.parents.set(parent._id, { parent, parentText, items: [] });
              bg.parents.get(parent._id)!.items.push({ rem, text, type });
            }
          }
      
          // Dedupe + sort parents
            for (const bg of nested.values()) {
                bg.parents.forEach(pg => {
                const seen = new Set<string>();
                pg.items = pg.items.filter(({ rem }) => !seen.has(rem._id) && seen.add(rem._id));
                });
                const arr = Array.from(bg.parents.entries());
                const withDepth = await Promise.all(arr.map(async ([pid, pg]) => {
                if (pid === bg.baseParent?._id) return { pid, pg, depth: -1 };
                let depth = 0;
                let curr: Rem | undefined = pg.parent;
                while (curr && curr._id !== bg.base._id) { curr = await curr.getParentRem(); depth++; }
                return { pid, pg, depth };
                }));
                withDepth.sort((a, b) => a.depth - b.depth);
                bg.parents = new Map(withDepth.map(({ pid, pg }) => [pid, pg]));
            }
        
            return nested;
            };
      
            useEffect(() => {
                const init = async () => {
                  setLoading(true);
                  if (focusedRem) {
                    const txt = await getRemText(plugin, focusedRem);
                    setCurrentRem(txt);
                    const curBase = await getBaseType(plugin, focusedRem);
                    setCurrentRemBase(await getRemText(plugin, curBase));
              
                    const nested = await buildGroupedItems(focusedRem);
                    const lineages = await getAncestorLineage(plugin, focusedRem);
              
                    const arr = await Promise.all(
                      Array.from(nested.values()).map(async (bg) => {
                        // For each base group, find the earliest ancestor in the lineage that introduces its base type
                        let definingDepth = -1; // Default if not found
                        let definingAncestor: Rem | undefined;
              
                        for (const lineage of lineages) {
                          // Traverse lineage from root (last item) towards focused Rem (first item)
                          for (let i = lineage.length - 1; i >= 0; i--) {
                            const ancestor = lineage[i];
                            // Check if this ancestor has a child with the base type bg.base
                            const children = await getCleanChildren(plugin, ancestor);
                            const hasChildWithBase = (await Promise.all(
                              children.map(async (child) => {
                                const childBase = await getBaseType(plugin, child);
                                return childBase && childBase._id === bg.base._id;
                              })
                            )).some(Boolean);
              
                            if (hasChildWithBase) {
                              definingAncestor = ancestor;
                              definingDepth = lineage.length - 1 - i;
                              break; // Found the earliest ancestor, exit inner loop
                            }
                          }
                          if (definingAncestor) break; // Exit outer loop if found
                        }
              
                        // Set baseParent and baseParentText
                        if (definingAncestor) {
                          bg.baseParent = definingAncestor;
                          bg.baseParentText = await getRemText(plugin, definingAncestor);
                        } else {
                          // Default values if not found
                          bg.baseParent = undefined;
                          bg.baseParentText = "Other";
                          definingDepth = lineages[0].length; // Default depth
                        }
              
                        return { depth: definingDepth, bg };
                      })
                    );
              
                    // Sort by depth to maintain lineage order (root to focused Rem)
                    arr.sort((a, b) => a.depth - b.depth);
                    setGroupedItems(arr.map(({ depth, bg }) => ({ depth, group: bg })));
                    setCollapsedBases(new Set(arr.map(e => e.bg.base._id)));
                  }
                  setLoading(false);
                };
                init();
              }, [focusedRem, plugin]);
      
        const handleClick = async (rem: Rem, type: ItemType) => {
          if (!focusedRem) return;
          if (type === "descriptor") await createRemWithReference(plugin, focusedRem, rem);
          else await createPropertyReference(plugin, focusedRem, rem);
          plugin.window.closeFloatingWidget("implement_widget");
        };
      
        if (!focusedRem) return null;
        return (
            <div style={{ height: "100%", display: "flex", flexDirection: "column", padding: 8 }}>
            {loading ? (
                <div>Loading...</div>
            ) : (
                <>
                <div style={{ textAlign: "center", fontWeight: "bold", fontSize: 18, padding: 8 }}>
                    {currentRem} ({currentRemBase})
                </div>
                <div style={{ overflowY: "auto", maxHeight: "calc(100vh - 40px)", padding: "0 8px" }}>
                    {(() => {
                    const byDepth = new Map<number, BaseGroup[]>();
                    groupedItems.forEach(({ depth, group }) => {
                        if (!byDepth.has(depth)) byDepth.set(depth, []);
                        byDepth.get(depth)!.push(group);
                    });
                    // Sort basegroups within each depth
                    byDepth.forEach((groups, depth) => {
                        groups.sort((a, b) => {
                            const getPriority = (bg: BaseGroup) => {
                                // Priority 0: base equals the lineage ancestor (baseParent)
                                if (bg.base._id === bg.baseParent?._id) return 0;
                                // Priority 1: base is a slot
                                //if (isSlot(plugin, bg.base)) return 1;
                                // Priority 2: everything else
                                return 2;
                            };
                            return getPriority(a) - getPriority(b);
                        });
                    });
                    return Array.from(byDepth.entries()).map(([depth, groupsAtDepth]) => (
                        <div key={depth} style={{ marginBottom: 16, border: "1px dashed #ccc", padding: 8, borderRadius: 4 }}>
                        <div style={{ textAlign: "center", fontWeight: "bold", marginBottom: 8 }}>
                          {groupsAtDepth[0].baseParentText || "Other"}
                        </div>
                        {groupsAtDepth.map(bg => {
                            const collapsed = collapsedBases.has(bg.base._id);
                            return (
                            <div key={bg.base._id} style={{ marginBottom: 12, border: "1px solid #ddd", padding: 8, borderRadius: 4 }}>
                                <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
                                <button onClick={() => toggleBaseCollapse(bg.base._id)} style={{ marginRight: 8 }}>
                                    {collapsed ? "+" : "-"}
                                </button>
                                <span style={{ fontWeight: "bold" }}>{bg.baseText}</span>
                                </div>
                                {!collapsed &&
                                Array.from(bg.parents.values()).map(pg => (
                                    <div key={pg.parent._id} style={{ marginLeft: 12, marginBottom: 12 }}>
                                    <div style={{ fontStyle: "italic", marginBottom: 4 }}>{pg.parentText}</div>
                                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                        {pg.items.map(it => (
                                        <MyRemNoteButton
                                            key={it.rem._id}
                                            text={it.text}
                                            img={it.type === "property" ? "M15 4h3a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3m0 3h6m-3 5h3m-6 0h.01M12 16h3m-6 0h.01M10 3v4h4V3h-4Z" : "M5 4a2 2 0 0 0-2 2v1h10.968l-1.9-2.28A2 2 0 0 0 10.532 4H5ZM3 19V9h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Zm11.707-7.707a1 1 0 0 0-1.414 1.414l.293.293H8a1 1 0 1 0 0 2h5.586l-.293.293a1 1 0 0 0 1.414 1.414l2-2a1 1 0 0 0 0-1.414l-2-2Z"}
                                            onClick={() => handleClick(it.rem, it.type)}
                                        />
                                        ))}
                                    </div>
                                    </div>
                                ))}
                            </div>
                            );
                        })}
                        </div>
                    ));
                    })()}
                </div>
                </>
            )}
            </div>
        );
        }

        export function ImplementWidget() {
            const plugin = usePlugin() as RNPlugin;
            const [currentRem, setCurrentRem] = useState<string>("No Rem Focused");
            const [currentRemBase, setCurrentRemBase] = useState<string>("No Rem Focused");
            const [groupedItems, setGroupedItems] = useState<Array<{ depth: number; group: BaseGroup }>>([]);
            const [loading, setLoading] = useState<boolean>(false); // Changed to false initially
            const [collapsedBases, setCollapsedBases] = useState<Set<string>>(new Set());
            const [displayedRem, setDisplayedRem] = useState<Rem | undefined>(undefined); // New state
          
            const focusedRem = useTracker(async (reactPlugin) => {
              return await reactPlugin.focus.getFocusedRem();
            });
          
            const toggleBaseCollapse = (baseId: string) => {
              setCollapsedBases(prev => {
                const next = new Set(prev);
                if (next.has(baseId)) next.delete(baseId);
                else next.add(baseId);
                return next;
              });
            };
          
            const buildGroupedItems = async (root: Rem) => {
              const children = await getCleanChildren(plugin, root);
              const existingNames = new Set(await Promise.all(children.map(c => getRemText(plugin, c))));
              existingNames.add("Collapse Tag Configure Options");
          
              const [props, descs] = await Promise.all([
                getClassProperties(plugin, root),
                getClassDescriptors(plugin, root),
              ]);
          
              const filterRems = async (list: Rem[]) => (
                await Promise.all(list.map(async r => {
                  const text = await getRemText(plugin, r);
                  const isDesc = await isRemAncestor(plugin, root, r);
                  return (r._id !== root._id && !existingNames.has(text) && !isDesc) ? r : null;
                }))
              ).filter((r): r is Rem => r !== null);
          
              const filtered = [
                ...(await filterRems(props)).map(r => ({ rem: r, type: "property" as ItemType })),
                ...(await filterRems(descs)).map(r => ({ rem: r, type: "descriptor" as ItemType })),
              ];
          
              const allItems = await Promise.all(filtered.map(async ({ rem, type }) => {
                const text = await getRemText(plugin, rem);
                const base = await getBaseType(plugin, rem);
                const baseText = await getRemText(plugin, base);
                const baseParent = await base.getParentRem();
                const baseParentText = baseParent ? await getRemText(plugin, baseParent) : baseText;
                const parent = await rem.getParentRem();
                const parentText = parent ? await getRemText(plugin, parent) : "Base";
                return { rem, text, type, base, baseText, baseParent, baseParentText, parent, parentText };
              }));
          
              const nested = new Map<string, BaseGroup>();
              for (const item of allItems) {
                const { base, baseText, baseParent, baseParentText, parent, parentText, rem, text, type } = item;
                if (!nested.has(base._id)) {
                  nested.set(base._id, { base, baseText, baseParent, baseParentText, parents: new Map() });
                }
                const bg = nested.get(base._id)!;
                if (parent) {
                  if (!bg.parents.has(parent._id)) bg.parents.set(parent._id, { parent, parentText, items: [] });
                  bg.parents.get(parent._id)!.items.push({ rem, text, type });
                }
              }
          
              for (const bg of nested.values()) {
                bg.parents.forEach(pg => {
                  const seen = new Set<string>();
                  pg.items = pg.items.filter(({ rem }) => !seen.has(rem._id) && seen.add(rem._id));
                });
                const arr = Array.from(bg.parents.entries());
                const withDepth = await Promise.all(arr.map(async ([pid, pg]) => {
                  if (pid === bg.baseParent?._id) return { pid, pg, depth: -1 };
                  let depth = 0;
                  let curr: Rem | undefined = pg.parent;
                  while (curr && curr._id !== bg.base._id) { curr = await curr.getParentRem(); depth++; }
                  return { pid, pg, depth };
                }));
                withDepth.sort((a, b) => a.depth - b.depth);
                bg.parents = new Map(withDepth.map(({ pid, pg }) => [pid, pg]));
              }
          
              return nested;
            };
          
            useEffect(() => {
              const init = async () => {
                if (!displayedRem) return;
                setLoading(true);
                const txt = await getRemText(plugin, displayedRem);
                setCurrentRem(txt);
                const curBase = await getBaseType(plugin, displayedRem);
                setCurrentRemBase(await getRemText(plugin, curBase));
          
                const nested = await buildGroupedItems(displayedRem);
                const lineages = await getAncestorLineage(plugin, displayedRem);
          
                const arr = await Promise.all(
                  Array.from(nested.values()).map(async (bg) => {
                    let definingDepth = -1;
                    let definingAncestor: Rem | undefined;
          
                    for (const lineage of lineages) {
                      for (let i = lineage.length - 1; i >= 0; i--) {
                        const ancestor = lineage[i];
                        const children = await getCleanChildren(plugin, ancestor);
                        const hasChildWithBase = (await Promise.all(
                          children.map(async (child) => {
                            const childBase = await getBaseType(plugin, child);
                            return childBase && childBase._id === bg.base._id;
                          })
                        )).some(Boolean);
          
                        if (hasChildWithBase) {
                          definingAncestor = ancestor;
                          definingDepth = lineage.length - 1 - i;
                          break;
                        }
                      }
                      if (definingAncestor) break;
                    }
          
                    if (definingAncestor) {
                      bg.baseParent = definingAncestor;
                      bg.baseParentText = await getRemText(plugin, definingAncestor);
                    } else {
                      bg.baseParent = undefined;
                      bg.baseParentText = "Other";
                      definingDepth = lineages[0].length;
                    }
          
                    return { depth: definingDepth, bg };
                  })
                );
          
                arr.sort((a, b) => a.depth - b.depth);
                setGroupedItems(arr.map(({ depth, bg }) => ({ depth, group: bg })));
                setCollapsedBases(new Set(arr.map(e => e.bg.base._id)));
                setLoading(false);
              };
              init();
            }, [displayedRem, plugin]);
          
            const handleClick = async (rem: Rem, type: ItemType) => {
              if (!displayedRem) return;
              if (type === "descriptor") await createRemWithReference(plugin, displayedRem, rem);
              else await createPropertyReference(plugin, displayedRem, rem);
              //plugin.window.closeFloatingWidget("implement_widget");
            };
          
            return (
              <div style={{ height: "100%", display: "flex", flexDirection: "column", padding: 8 }}>
                <div style={{ marginBottom: 8 }}>
                  <MyRemNoteButton text="Load Current Rem" onClick={() => setDisplayedRem(focusedRem)} img="M9 7V2.221a2 2 0 0 0-.5.365L4.586 6.5a2 2 0 0 0-.365.5H9Zm2 0V2h7a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5h7.586l-.293.293a1 1 0 0 0 1.414 1.414l2-2a1 1 0 0 0 0-1.414l-2-2a1 1 0 0 0-1.414 1.414l.293.293H4V9h5a2 2 0 0 0 2-2Z" />
                </div>
                {displayedRem ? (
                  loading ? (
                    <div>Loading...</div>
                  ) : (
                    <>
                      <div style={{ textAlign: "center", fontWeight: "bold", fontSize: 18, padding: 8 }}>
                        {currentRem} ({currentRemBase})
                      </div>
                      <div style={{ overflowY: "auto", maxHeight: "calc(100vh - 40px)", padding: "0 8px" }}>
                        {(() => {
                          const byDepth = new Map<number, BaseGroup[]>();
                          groupedItems.forEach(({ depth, group }) => {
                            if (!byDepth.has(depth)) byDepth.set(depth, []);
                            byDepth.get(depth)!.push(group);
                          });
                          byDepth.forEach((groups, depth) => {
                            groups.sort((a, b) => {
                              const getPriority = (bg: BaseGroup) => {
                                if (bg.base._id === bg.baseParent?._id) return 0;
                                return 2;
                              };
                              return getPriority(a) - getPriority(b);
                            });
                          });
                          return Array.from(byDepth.entries()).map(([depth, groupsAtDepth]) => (
                            <div key={depth} style={{ marginBottom: 16, border: "1px dashed #ccc", padding: 8, borderRadius: 4 }}>
                              <div style={{ textAlign: "center", fontWeight: "bold", marginBottom: 8 }}>
                                {groupsAtDepth[0].baseParentText || "Other"}
                              </div>
                              {groupsAtDepth.map(bg => {
                                const collapsed = collapsedBases.has(bg.base._id);
                                return (
                                  <div key={bg.base._id} style={{ marginBottom: 12, border: "1px solid #ddd", padding: 8, borderRadius: 4 }}>
                                    <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
                                      <button onClick={() => toggleBaseCollapse(bg.base._id)} style={{ marginRight: 8 }}>
                                        {collapsed ? "+" : "-"}
                                      </button>
                                      <span style={{ fontWeight: "bold" }}>{bg.baseText}</span>
                                    </div>
                                    {!collapsed &&
                                      Array.from(bg.parents.values()).map(pg => (
                                        <div key={pg.parent._id} style={{ marginLeft: 12, marginBottom: 12 }}>
                                          <div style={{ fontStyle: "italic", marginBottom: 4 }}>{pg.parentText}</div>
                                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                            {pg.items.map(it => (
                                              <MyRemNoteButton
                                                key={it.rem._id}
                                                text={it.text}
                                                img={it.type === "property" ? "M15 4h3a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3m0 3h6m-3 5h3m-6 0h.01M12 16h3m-6 0h.01M10 3v4h4V3h-4Z" : "M5 4a2 2 0 0 0-2 2v1h10.968l-1.9-2.28A2 2 0 0 0 10.532 4H5ZM3 19V9h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Zm11.707-7.707a1 1 0 0 0-1.414 1.414l.293.293H8a1 1 0 1 0 0 2h5.586l-.293.293a1 1 0 0 0 1.414 1.414l2-2a1 1 0 0 0 0-1.414l-2-2Z"}
                                                onClick={() => handleClick(it.rem, it.type)}
                                              />
                                            ))}
                                          </div>
                                        </div>
                                      ))}
                                  </div>
                                );
                              })}
                            </div>
                          ));
                        })()}
                      </div>
                    </>
                  )
                ) : (
                  <div>No Rem loaded. Click the button to load the current Rem.</div>
                )}
              </div>
            );
          }
renderWidget(ImplementWidget);