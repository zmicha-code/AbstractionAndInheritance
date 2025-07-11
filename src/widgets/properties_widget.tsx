import React, { useState, useEffect, useCallback, useMemo } from "react";
import { renderWidget, useTracker, Rem, usePlugin, RNPlugin, RemType, Queue } from "@remnote/plugin-sdk";
import { getAncestorLineage, getBaseType, getRemText, getEncapsulatingClass, getCleanChildren } from "../utils/utils";
import MyRemNoteButton from "../components/MyRemNoteButton";

enum FieldType {
    Property,
    Interface,
    Subclass
}

interface ClassField {
    fieldType: FieldType,
    baseType: Rem,                  // The Root Class of the Property Layer
    baseTypeName: string,
    baseTypeParentRem: Rem,         // The Class where the Property Base is defined in.
    baseTypeParentRemName: string,
    property: Rem,                  // The Property Ancestor
    propertyName: string,
    propertyParentRem: Rem          // The Class where the Property Ancestor is defined in
    propertyParentRemName: string
};

async function hasElementWithBase(plugin: RNPlugin, propertyList: ClassField[], property: Rem): Promise<boolean> {

    const propertyBase = await getBaseType(plugin, property);

    for(const p of propertyList) {

        if(propertyBase._id == p.baseType._id) {
            return true;
        }
    }

    return false;
}

// Find PropertyLayer in 'propertyList' that has 'base' as base type.
async function findElementWithBase(plugin: RNPlugin, propertyList: ClassField[], base: Rem): Promise<ClassField | undefined> {

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

async function getProperties(plugin: RNPlugin, rem: Rem): Promise<ClassField[]> {

    let results: ClassField[] = [];

    const remBaseType = await getBaseType(plugin, rem);

    const lineages = await getAncestorLineage(plugin, rem);

    for(const l of lineages) {
        for(const a of l.slice(1)) {
            const children = await getCleanChildren(plugin, a);

            for(const c of children) {
                
                const cType = await c.getType();

                //
                if(cType == RemType.DEFAULT_TYPE || cType == RemType.PORTAL)
                    continue;

                const baseType = await getBaseType(plugin, c);

                // Property
                if(baseType._id != remBaseType._id) {
                    // 'results' doesnt have a property with that base yet.
                    if(!await hasElementWithBase(plugin, results, c)) {
                        const baseTypeParentRem = await getEncapsulatingClass(plugin, baseType);
                        const propertyParentRem = await getEncapsulatingClass(plugin, c);

                        results.push({  fieldType: FieldType.Property,
                                        baseType: baseType,
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
                // Interface 
                else {
                    const baseTypeParentRem = await baseType.getParentRem() ?? baseType;
                    const propertyParentRem = await c.getParentRem() ?? c;

                    // default assume Subclass
                    let fieldType: FieldType = FieldType.Subclass;

                    if(cType == RemType.DESCRIPTOR)
                        fieldType = FieldType.Interface

                    results.push({  fieldType: fieldType,
                                    baseType: baseType,
                                    baseTypeName: await getRemText(plugin, baseType),
                                    baseTypeParentRem: baseTypeParentRem,
                                    baseTypeParentRemName: await getRemText(plugin, baseTypeParentRem),
                                    property: c,
                                    propertyName: await getRemText(plugin, c),
                                    propertyParentRem: propertyParentRem,
                                    propertyParentRemName: await getRemText(plugin, propertyParentRem)});
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
    const [propertyList, setPropertyList] = useState<ClassField[]>([]);

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
            acc: Record<string, { parentRem: Rem; parentText: string; properties: ClassField[] }>,
            p: ClassField
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
            {} as Record<string, { parentRem: Rem; parentText: string; properties: ClassField[] }>
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
                        img="M4 4a2 2 0 0 0-2 2v12a2 2 0 0 0 .087.586l2.977-7.937A1 1 0 0 1 6 10h12V9a2 2 0 0 0-2-2h-4.532l-1.9-2.28A2 2 0 0 0 8.032 4H4Zm2.693 8H6.5l-3 8H18l3-8H6.693Z"
                        onClick={() => handleOpenRem(p.property)}
                        title={"Open"}
                    />
                    <MyRemNoteButton
                        key={p.property._id}
                        text={p.propertyName}
                        onClick={() => handleCopyClick(p.property)}
                        title={p.baseTypeName}
                        img={p.fieldType == FieldType.Property  ? "M9 2.221V7H4.221a2 2 0 0 1 .365-.5L8.5 2.586A2 2 0 0 1 9 2.22ZM11 2v5a2 2 0 0 1-2 2H4v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2h-7Z"
                                                                : p.fieldType == FieldType.Interface ? "M9 7V2.221a2 2 0 0 0-.5.365L4.586 6.5a2 2 0 0 0-.365.5H9Zm2 0V2h7a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5h7.586l-.293.293a1 1 0 0 0 1.414 1.414l2-2a1 1 0 0 0 0-1.414l-2-2a1 1 0 0 0-1.414 1.414l.293.293H4V9h5a2 2 0 0 0 2-2Z"
                                                                : "M3 9V6c0-.55228.44772-1 1-1h16c.5523 0 1 .44771 1 1v3M3 9v9c0 .5523.44772 1 1 1h16c.5523 0 1-.4477 1-1V9M3 9h18M8 9V5m4 4V5m4 4V5m-6 9h2m0 0h2m-2 0v-2m0 2v2"}
                    />
                </div>))}
            </div>
            ))
        )}
        </div>
    );
}

renderWidget(PropertiesWidget);
