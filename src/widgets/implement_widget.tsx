import { usePlugin, renderWidget, useTracker, Rem, RemType, SetRemType,
    RichTextElementRemInterface, RichTextInterface, RNPlugin } from '@remnote/plugin-sdk';
import { useEffect, useState } from 'react';
import { getRemText, isLayerConcept, getAllParents } from '../utils/utils';
import MyRemNoteButton from '../components/MyRemNoteButton';

// Define interface for descriptor items
interface DescriptorItem {
    rem: Rem;
    text: string;
}

// Helper function to check if a Rem is a descriptor
async function isDescriptor(plugin: RNPlugin, rem: Rem): Promise<boolean> {
    const type = await rem.getType();
    return type === RemType.DESCRIPTOR;
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

async function collectDescendantDescriptors(plugin: RNPlugin, rem: Rem): Promise<DescriptorItem[]> {
    let result: DescriptorItem[] = [];
    const children = await rem.getChildrenRem();
    for (const child of children) {
        if (await isDescriptor(plugin, child) || await child.isSlot()) {
            const text = await getRemText(plugin, child, true);
            result.push({ rem: child, text });
            // Recursively collect descriptors from this child
            const childDescriptors = await collectDescendantDescriptors(plugin, child);
            result = result.concat(childDescriptors);
        }
    }
    return result;
}

async function getDescriptors(plugin: RNPlugin, focusedRem: Rem): Promise<DescriptorItem[]> {
    let desc: DescriptorItem[] = [];
    
    if (!focusedRem) {
        console.log("Not a valid Rem");
        return desc;
    }

    const parentRems = await getAllParents(plugin, focusedRem);
    if (parentRems.length === 0) {
        console.log(await getRemText(plugin, focusedRem) + " has no valid Parents");
        return desc;
    }

    for (const parentRem of parentRems) {
        // Collect all descendant descriptors recursively
        const descriptors = await collectDescendantDescriptors(plugin, parentRem);

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
            if (!isSpecial && !await hasChildWithText(plugin, focusedRem, text) && !desc.some(d => d.rem._id === descriptor.rem._id)) {
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

renderWidget(ImplementWidget);