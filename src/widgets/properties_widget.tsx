import React, { useState, useEffect, useCallback, useMemo } from "react";
import { renderWidget, useTracker, Rem, usePlugin, RNPlugin, RemType, Queue } from "@remnote/plugin-sdk";
import { getAncestorLineage, getBaseType, getRemText, getEncapsulatingClass, getCleanChildren } from "../utils/utils";
import MyRemNoteButton from "../components/MyRemNoteButton";

interface PropertyLayer{
    baseType: Rem,                  // The Root Class of the Property Layer
    baseTypeName: string,
    baseTypeParentRem: Rem,         // The Class where the Property Base is defined in.
    baseTypeParentRemName: string,
    property: Rem,                  // The Property Ancestor
    propertyName: string,
    propertyParentRem: Rem          // The Class where the Property Ancestor is defined in
    propertyParentRemName: string
};

async function hasElementWithBase(plugin: RNPlugin, propertyList: PropertyLayer[], property: Rem): Promise<boolean> {

    const propertyBase = await getBaseType(plugin, property);

    for(const p of propertyList) {

        if(propertyBase._id == p.baseType._id) {
            return true;
        }
    }

    return false;
}

// Find PropertyLayer in 'propertyList' that has 'base' as base type.
async function findElementWithBase(plugin: RNPlugin, propertyList: PropertyLayer[], base: Rem): Promise<PropertyLayer | undefined> {

    for(const p of propertyList) {

        if(p.baseType._id == base._id) {
            return p;
        }
    }

    return undefined;
}

// Does 'high' appear in the Ancestor Lineage of 'low'?
async function isHigherInHierarchie(plugin: RNPlugin, high: Rem, low: Rem): Promise<boolean> {

    const lineages = await getAncestorLineage(plugin, low);

    for(const l of lineages) {
        for(const a of l) {
            if(high._id == a._id)
                return true;
        }
    }

    return false;
}

async function getProperties(plugin: RNPlugin, rem: Rem): Promise<PropertyLayer[]> {

    let results: PropertyLayer[] = [];

    const remBaseType = await getBaseType(plugin, rem);

    const lineages = await getAncestorLineage(plugin, rem);

    for(const l of lineages) {
        for(const a of l.slice(1)) {
            const children = await getCleanChildren(plugin, a);

            for(const c of children) {
                const baseType = await getBaseType(plugin, c);

                // 
                if(baseType._id != remBaseType._id) {
                    // 'results' doesnt have a property with that base yet.
                    if(!await hasElementWithBase(plugin, results, c)) {
                        const baseTypeParentRem = await getEncapsulatingClass(plugin, baseType);
                        const propertyParentRem = await getEncapsulatingClass(plugin, c);

                        results.push({  baseType: baseType,
                                        baseTypeName: await getRemText(plugin, baseType),
                                        baseTypeParentRem: baseTypeParentRem,
                                        baseTypeParentRemName: await getRemText(plugin, baseTypeParentRem),
                                        property: c,
                                        propertyName: await getRemText(plugin, c),
                                        propertyParentRem: propertyParentRem,
                                        propertyParentRemName: await getRemText(plugin, propertyParentRem)});
                    } else {
                        // If the element present in 'results' is higher in hierarchie than 'c' replace it with 'c'.
                        const elementWithBase = await findElementWithBase(plugin, results, baseType);
                        if(elementWithBase && await isHigherInHierarchie(plugin, elementWithBase.property, c)) {
                            // TODO: Replace 'elementWithBase' inside 'results' with 'c'
                            const newPropertyParentRem = await getEncapsulatingClass(plugin, c);
                            elementWithBase.property = c;
                            elementWithBase.propertyName = await getRemText(plugin, c);
                            elementWithBase.propertyParentRem = newPropertyParentRem;
                            elementWithBase.propertyParentRemName = await getRemText(plugin, newPropertyParentRem);
                        }
                    }
                }
            }
        }
    }

    return results;
}

function PropertiesWidget() {
    const plugin = usePlugin();

    const [selectedRem, setSelectedRem] = useState<Rem | undefined>(undefined);
    const [selectedRemName, setSelectedRemName] = useState<string>("");
    const [propertyList, setPropertyList] = useState<PropertyLayer[]>([]);

    const [loading, setLoading] = useState<boolean>(false);

    const focusedRem = useTracker(async (reactPlugin) => {
            return await reactPlugin.focus.getFocusedRem();
        }
    );

    async function readProperties() {
        if(!focusedRem) return;

        setLoading(true);
        setPropertyList(await getProperties(plugin, focusedRem));
        setLoading(false);
    };

    // 
    useEffect(() => {
        readProperties();
    }, [selectedRem]);

    // Group properties by initialAncestorParentRem
    const groupedProperties = useMemo(() => {
        const groups = propertyList.reduce(
            (
            acc: Record<string, { parentRem: Rem; parentText: string; properties: PropertyLayer[] }>,
            p: PropertyLayer
            ) => {
            const parentId = p.propertyParentRem._id;
            if (!acc[parentId]) {
                acc[parentId] = {
                parentRem: p.propertyParentRem,
                parentText: p.propertyParentRemName,
                properties: [],
                };
            }
            acc[parentId].properties.push(p);
            return acc;
            },
            {} as Record<string, { parentRem: Rem; parentText: string; properties: PropertyLayer[] }>
        );
        return Object.values(groups);
    }, [propertyList]);

    const handleLoadClick = async (rem: Rem | undefined) => {
        if(!rem) return;

        setSelectedRem(focusedRem);
        setSelectedRemName(await getRemText(plugin, focusedRem));
    };

    const handleCopyClick = async (rem: Rem) => {
        if (rem) {
        await rem.copyReferenceToClipboard();
        }
    };

    const handleOpenRem = async (rem: Rem) => {
      if(rem)
        await plugin.window.openRem(rem);
    };

    // propertyList.map(p => <div>{p.baseTypeName}</div>)}
    /*
    return (
        <div className="overflow-y-auto max-h-[500px]">
            <div>Properties:</div>
            {propertyList.length == 0 ? <div>Class has no Properties</div> : 
                propertyList.map(p => <MyRemNoteButton text={p.initialAncestorName} onClick={() => {handleCopyClick(p.initialAncestor)}} title={p.initialAncestorParentRemName} />)}
        </div>); */
    return (
        <div style={{ overflowY: "auto", maxHeight: "100%", padding: 8 }}>
        <div style={{ fontWeight: "bold", marginBottom: 8 }}>{selectedRemName} Properties: <MyRemNoteButton key={"LoadButton"} text="Load" title="" onClick={() => handleLoadClick(focusedRem)} img="M12 13V4M7 14H5a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1h-2m-1-5-4 5-4-5m9 8h.01"/></div>
        {loading ? (<div>Loading...</div>) : propertyList.length === 0 ? (
            <div>Class has no Properties</div>
        ) : (
            groupedProperties.map(group => (
            <div
                key={group.parentRem._id}
                style={{ marginBottom: 16, border: "1px solid #ccc", padding: 8 }}
            >
                <h3 style={{ marginBottom: 8 }}>{group.parentText}</h3>
                {group.properties.map(p => (<div>
                    <MyRemNoteButton
                        key={p.property._id + "Open"}
                        text={""}
                        img="M9 2.221V7H4.221a2 2 0 0 1 .365-.5L8.5 2.586A2 2 0 0 1 9 2.22ZM11 2v5a2 2 0 0 1-2 2H4v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2h-7Z"
                        onClick={() => handleOpenRem(p.property)}
                        title={p.propertyParentRemName}
                    />
                    <MyRemNoteButton
                        key={p.property._id}
                        text={p.propertyName}
                        onClick={() => handleCopyClick(p.property)}
                        title={p.propertyParentRemName}
                    />
                </div>))}
            </div>
            ))
        )}
        </div>
    );
}

renderWidget(PropertiesWidget);
