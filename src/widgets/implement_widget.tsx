import { usePlugin, renderWidget, useTracker, Rem, RemType, SetRemType,
    RichTextElementRemInterface, RichTextInterface, RNPlugin } from '@remnote/plugin-sdk';
import { useEffect, useState } from 'react';
import { getRemText, isLayerConcept, getAllParents, isReferencingRem, getClassType, getAncestorLineage } from '../utils/utils';
import MyRemNoteButton from '../components/MyRemNoteButton';

// Define interface for descriptor items
interface DescriptorItem {
    rem: Rem;
    text: string;
    isSlot: boolean;
    isDescriptor: boolean;
}

// Helper function to check if a Rem is a descriptor
async function isDescriptor(plugin: RNPlugin, rem: Rem): Promise<boolean> {
    const type = await rem.getType();
    return type === RemType.DESCRIPTOR;
}

async function isConcept(plugin: RNPlugin, rem: Rem): Promise<boolean> {
    const type = await rem.getType();
    return type === RemType.CONCEPT;
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

async function isSameBaseType(plugin: RNPlugin, rem1: Rem, rem2: Rem): Promise <boolean> {
    const ancestors1 = await getAncestorLineage(plugin, rem1);
    const ancestors2 = await getAncestorLineage(plugin, rem2);

    //if(ancestors1.length>0 && ancestors2.length>0) {
    //    return ancestors1[ancestors1.length-1]._id == ancestors2[ancestors2.length-1]._id;
    //}

    //return false;

    return (ancestors1.length>0 ? ancestors1[ancestors1.length-1]._id : rem1._id) == (ancestors2.length>0 ? ancestors2[ancestors2.length-1]._id : rem2._id);
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
async function isSiblingOfAncestor(plugin: RNPlugin, rem: Rem, root: Rem): Promise<boolean> {

    if (await isSibling(plugin, rem, root)) 
        return true;

    const ancestors = await getAncestorLineage(plugin, root);

    if(ancestors.length == 0)
        return false;

    return isSiblingOfAncestor(plugin, rem, ancestors[0]);
}

async function isDifferentFamily(plugin: RNPlugin, rem: Rem, root: Rem): Promise<boolean> {

    const ancestors = await getAncestorLineage(plugin, root);
    const remAncestor = await getClassType(plugin, rem);

    for(const ancestor of ancestors) {
        if(ancestor._id == remAncestor?._id)
            return true;
    }


    return false;
}

async function isOfSpecificType(plugin: RNPlugin, rem: Rem, root: Rem): Promise<boolean> {

    const ancestors = await getAncestorLineage(plugin, root);
    const remType = await getClassType(plugin, rem);

    for(const ancestor of ancestors) {
        if(ancestor._id == remType?._id)
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
    const parentRemAncestor = await getClassType(plugin, parentRem as Rem);
    const ancestorRems = await getAncestorLineage(plugin, focusedRem); //await getAllParents(plugin, focusedRem);

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
                if (!isSpecial && !await hasChildWithText(plugin, focusedRem, text) && !desc.some(d => d.rem._id === descriptor.rem._id) && (descriptor.rem._id != parentRem?._id) && descriptor.rem._id != parentRemAncestor?._id ) {
    
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
            if (!isSpecial && !await hasChildWithText(plugin, focusedRem, text) && !desc.some(d => d.rem._id === descriptor.rem._id) && (descriptor.rem._id != parentRem?._id) && descriptor.rem._id != parentRemAncestor?._id ) {

                //console.log(await getRemText(plugin, descriptor.rem) + " !=  Parent Rem: " + await getRemText(plugin, parentRem as Rem));
                //console.log("Descriptor Rem ID: " + descriptor.rem._id + " != Parent Rem ID: " + parentRem?._id);
                desc.push(descriptor);
            }
        }
    }

    return desc;
}

// ImplementWidget component
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

renderWidget(ImplementWidget);