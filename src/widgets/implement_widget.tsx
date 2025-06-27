import { usePlugin, renderWidget, useTracker, Rem, RemType, SetRemType,
    RichTextElementRemInterface, RichTextInterface, RNPlugin } from '@remnote/plugin-sdk';
import { useEffect, useMemo, useState } from 'react';
import { layerItem, getRemText, isRemAncestor,getBaseType, isConcept, isDescriptor, isReferencingRem, getParentClass, getAncestorLineage, isSameBaseType, getClassDescriptors, getClassProperties, getCleanChildren, getAncestorLineageStrings, getLayers, getInheritedData, printLayerItem, getLayers2} from '../utils/utils';
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

async function createPropertyReference(plugin: RNPlugin, parentRem: Rem, propertyRem: Rem, isSlot = false): Promise<void> {
    const newRem = await plugin.rem.createRem();
    if (newRem) {
        const referenceElement: RichTextElementRemInterface = {
            i: 'q',
            _id: propertyRem._id
        };
        const richText: RichTextInterface = [referenceElement];
        await newRem.setText(richText);
        await newRem.setParent(parentRem._id);
        isSlot ? await newRem.setType(SetRemType.DESCRIPTOR) : await newRem.setType(SetRemType.CONCEPT);
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

async function isOfSpecificType(plugin: RNPlugin, rem: Rem, root: Rem): Promise<boolean> {

    const ancestors = (await getAncestorLineage(plugin, root))[0];
    const remType = await getParentClass(plugin, rem);

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
    const parentRemAncestor = await getParentClass(plugin, parentRem as Rem);
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

type ItemType = "property" | "descriptor";

interface BaseGroup {
  base: Rem;
  baseText: string;
  baseParent: Rem | undefined;
  baseParentText: string;
  parents: Map<string, ParentGroup>;
}

interface ParentGroup {
  key: string;
  parentText: string;
  items: Array<{
    rem: Rem;
    text: string;
    type: ItemType;
  }>;
  isDescriptor: boolean;
  parent: Rem | undefined;
}

interface UILayerItem extends layerItem {
  text: string;
}

interface UITreeLayerItem extends UILayerItem {
  children: UITreeLayerItem[];
}

interface UIBaseTypeGroup {
  baseType: Rem;
  baseTypeText: string;
  roots: UITreeLayerItem[];
}

// Parent is the Rem where a Property was first defined
interface UIParentGroup {
  parentRem: Rem | undefined;
  parentText: string;
  baseTypeGroups: UIBaseTypeGroup[];
}

export function ImplementWidget__() {
  const plugin = usePlugin() as RNPlugin;
  const [currentRem, setCurrentRem] = useState<string>("No Rem Focused");
  const [currentRemBase, setCurrentRemBase] = useState<string>("No Rem Focused");
  const [parentGroups, setParentGroups] = useState<UIParentGroup[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [collapsedBases, setCollapsedBases] = useState<string[]>([]);
  const [collapsedItems, setCollapsedItems] = useState<{ [itemId: string]: boolean }>({});
  const [displayedRem, setDisplayedRem] = useState<Rem | undefined>(undefined);
  const [displayedRemBaseId, setDisplayedRemBaseId] = useState<string | undefined>(undefined);
  const [includeCurrentLayer, setIncludeCurrentLayer] = useState(false);

  const focusedRem = useTracker(async (reactPlugin) => {
    return await reactPlugin.focus.getFocusedRem();
  });

  const toggleBaseCollapse = (baseTypeId: string) => {
    setCollapsedBases(prev => {
      if (prev.includes(baseTypeId)) {
        return prev.filter(id => id !== baseTypeId);
      } else {
        return [...prev, baseTypeId];
      }
    });
  };

  const toggleItemCollapse = (itemId: string) => {
    setCollapsedItems(prev => {
      const current = prev[itemId] ?? true;
      return { ...prev, [itemId]: !current };
    });
  };

  const expandAll = () => {
    const allBaseIds = parentGroups.flatMap(parentGroup => parentGroup.baseTypeGroups.map(group => group.baseType._id));
    const allItemsExpanded = Object.values(collapsedItems).every(value => !value);
    const allBasesExpanded = collapsedBases.length === 0;

    if (allBasesExpanded && allItemsExpanded) {
      setCollapsedBases(allBaseIds);
      setCollapsedItems(prev => {
        const newCollapsed = { ...prev };
        Object.keys(newCollapsed).forEach(key => newCollapsed[key] = true);
        return newCollapsed;
      });
    } else {
      setCollapsedBases([]);
      setCollapsedItems(prev => {
        const newCollapsed = { ...prev };
        Object.keys(newCollapsed).forEach(key => newCollapsed[key] = false);
        return newCollapsed;
      });
    }
  };

  const collectItemsWithChildren = (roots: UITreeLayerItem[]): string[] => {
    const ids: string[] = [];
    const traverse = (item: UITreeLayerItem) => {
      if (item.children.length > 0) {
        ids.push(item.item._id);
        item.children.forEach(traverse);
      }
    };
    roots.forEach(traverse);
    return ids;
  };

  const groupLayerItems = async (layerItems: layerItem[], displayedRem: Rem): Promise<UIParentGroup[]> => {
    const allItems = layerItems.map(li => li.item);
    const allBaseTypes = layerItems.map(li => li.layerBaseType);

    const uniqueItems = Array.from(new Set(allItems));
    const uniqueBaseTypes = Array.from(new Set(allBaseTypes));

    const [itemTexts, baseTypeTexts] = await Promise.all([
      Promise.all(uniqueItems.map(rem => getRemText(plugin, rem))),
      Promise.all(uniqueBaseTypes.map(rem => getRemText(plugin, rem))),
    ]);

    const itemTextMap = new Map(uniqueItems.map((rem, index) => [rem._id, itemTexts[index]]));
    const baseTypeTextMap = new Map(uniqueBaseTypes.map((rem, index) => [rem._id, baseTypeTexts[index]]));

    const uiLayerItems = layerItems.map(li => ({
      ...li,
      text: itemTextMap.get(li.item._id) || "Unknown"
    }));

    const baseTypeMap = new Map<string, UILayerItem[]>();
    for (const item of uiLayerItems) {
      const baseTypeId = item.layerBaseType._id;
      if (!baseTypeMap.has(baseTypeId)) {
        baseTypeMap.set(baseTypeId, []);
      }
      baseTypeMap.get(baseTypeId)!.push(item);
    }

    const baseTypeGroups: UIBaseTypeGroup[] = [];
    for (const [baseTypeId, items] of baseTypeMap) {
      const baseType = items[0].layerBaseType;
      const baseTypeText = baseTypeTextMap.get(baseTypeId) || "Unknown";

      const itemMap = new Map<string, UITreeLayerItem>();
      items.forEach(item => {
        itemMap.set(item.item._id, { ...item, children: [] });
      });

      const childrenMap = new Map<string, UITreeLayerItem[]>();
      items.forEach(item => {
        if (item.layerParent) {
          for (const parent of item.layerParent) {
            if (itemMap.has(parent._id)) {
              const parentId = parent._id;
              if (!childrenMap.has(parentId)) {
                childrenMap.set(parentId, []);
              }
              childrenMap.get(parentId)!.push(itemMap.get(item.item._id)!);
              break;
            }
          }
        }
      });

      itemMap.forEach(item => {
        item.children = childrenMap.get(item.item._id) || [];
      });

      const allChildrenIds = new Set<string>();
      childrenMap.forEach(children => {
        children.forEach(child => allChildrenIds.add(child.item._id));
      });
      const roots = Array.from(itemMap.values()).filter(item => !allChildrenIds.has(item.item._id));

      baseTypeGroups.push({ baseType, baseTypeText, roots });
    }

    const parentGroupMap = new Map<string, UIParentGroup>();
    for (const group of baseTypeGroups) {
      const parentRem = await group.baseType.getParentRem();
      const parentId = parentRem ? parentRem._id : 'no-parent';
      const parentText = parentRem ? await getRemText(plugin, parentRem) : 'No Parent';

      if (!parentGroupMap.has(parentId)) {
        parentGroupMap.set(parentId, { parentRem, parentText, baseTypeGroups: [] });
      }
      parentGroupMap.get(parentId)!.baseTypeGroups.push(group);
    }

    const parentGroups = Array.from(parentGroupMap.values());

    const lineages = await getAncestorLineage(plugin, displayedRem);
    const maxLength = lineages.length > 0 ? Math.max(...lineages.map(lineage => lineage.length)) : 0;

    const getSortIndex = (parentRem: Rem | undefined): number => {
      if (!parentRem) return maxLength;
      let minIndex = Infinity;
      for (const lineage of lineages) {
        const index = lineage.findIndex(rem => rem._id === parentRem._id);
        if (index >= 0) {
          minIndex = Math.min(minIndex, index);
        }
      }
      return minIndex === Infinity ? maxLength : minIndex;
    };

    parentGroups.sort((a, b) => {
      const aIndex = getSortIndex(a.parentRem);
      const bIndex = getSortIndex(b.parentRem);
      if (bIndex !== aIndex) {
        return bIndex - aIndex;
      }
      return a.parentText.localeCompare(b.parentText);
    });

    return parentGroups;
  };

  function filterLayerItems(layerItems: layerItem[]): layerItem[] {
    const seenIds = new Set<string>();
    return layerItems.filter(layerItem => {
      const id = layerItem.item._id;
      if (seenIds.has(id)) {
        return false;
      } else {
        seenIds.add(id);
        return true;
      }
    });
  }

  const initializeWidget = async () => {
    if (!displayedRem) return;
    setLoading(true);

    const [txt, curBase, layerItems] = await Promise.all([
      getRemText(plugin, displayedRem),
      getBaseType(plugin, displayedRem),
      getLayers(plugin, displayedRem, includeCurrentLayer)
    ]);

    setCurrentRem(txt);
    const baseText = await getRemText(plugin, curBase);
    setCurrentRemBase(baseText);
    setDisplayedRemBaseId(curBase._id);

    const grouped = await groupLayerItems(filterLayerItems(layerItems), displayedRem);
    setParentGroups(grouped);

    const initialCollapsedBases = grouped.flatMap(parentGroup => parentGroup.baseTypeGroups.map(group => group.baseType._id));
    setCollapsedBases(initialCollapsedBases);

    const allItemsWithChildren = grouped.flatMap(parentGroup => parentGroup.baseTypeGroups.flatMap(group => collectItemsWithChildren(group.roots)));
    const initialCollapsedItems = Object.fromEntries(allItemsWithChildren.map(id => [id, true]));
    setCollapsedItems(initialCollapsedItems);

    setLoading(false);
  };

  useEffect(() => {
    initializeWidget();
  }, [displayedRem, plugin]);

  const handleCopyClick = async (rem: Rem) => {
    if (rem) {
      await rem.copyReferenceToClipboard();
    }
  };

  const getSortIndex = (itemType: string) => {
    switch (itemType) {
      case "Slot": return 0;
      case "Descriptor": return 1;
      case "Concept": return 2;
      default: return 3;
    }
  };

  const LayerItemNode = ({ item }: { item: UITreeLayerItem }) => {
    const isCollapsed = collapsedItems[item.item._id] ?? true;
    const hasChildren = item.children.length > 0;

    return (
      <div style={{ marginLeft: 6, marginBottom: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '10px 1fr', gap: '10px', alignItems: 'center' }}>
          <div>
            {hasChildren && (
              <button
                onClick={() => toggleItemCollapse(item.item._id)}
                style={{ width: '100%', textAlign: 'center' }}
                title={isCollapsed ? "Expand" : "Collapse"}
              >
                {isCollapsed ? '+' : '-'}
              </button>
            )}
          </div>
          <div>
            <MyRemNoteButton
              text={item.text}
              img={
                item.itemType === "Slot"
                  ? "M18 9V4a1 1 0 0 0-1-1H8.914a1 1 0 0 0-.707.293L4.293 7.207A1 1 0 0 0 4 7.914V20a1 1 0 0 0 1 1h4M9 3v4a1 1 0 0 1-1 1H4m11 6v4m-2-2h4m3 0a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z"
                  : item.itemType === "Concept"
                  ? "M15 4h3a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3m0 3h6m-3 5h3m-6 0h.01M12 16h3m-6 0h.01M10 3v4h4V3h-4Z"
                  : "M9 7V2.221a2 2 0 0 0-.5.365L4.586 6.5a2 2 0 0 0-.365.5H9Zm2 0V2h7a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5h7.586l-.293.293a1 1 0 0 0 1.414 1.414l2-2a1 1 0 0 0 0-1.414l-2-2a1 1 0 0 0-1.414 1.414l.293.293H4V9h5a2 2 0 0 0 2-2Z"
              }
              onClick={() => handleCopyClick(item.item)}
              title={item.fullPath}
            />
          </div>
        </div>
        {!isCollapsed && hasChildren && (
          <div style={{ marginLeft: 24, marginTop: 6 }}>
            {[...item.children]
              .sort((a, b) => getSortIndex(a.itemType) - getSortIndex(b.itemType))
              .map(child => (
                <LayerItemNode key={child.item._id} item={child} />
              ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", padding: 8 }}>
      <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <MyRemNoteButton 
            text="Load Interfaces" 
            onClick={() => { setIncludeCurrentLayer(true); setDisplayedRem(focusedRem)}} 
            img="M9 7V2.221a2 2 0 0 0-.5.365L4.586 6.5a2 2 0 0 0-.365.5H9Zm2 0V2h7a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5h7.586l-.293.293a1 1 0 0 0 1.414 1.414l2-2a1 1 0 0 0 0-1.414l-2-2a1 1 0 0 0-1.414 1.414l.293.293H4V9h5a2 2 0 0 0 2-2Z" 
            title="Load the currently focused Rem"
          />
          <MyRemNoteButton 
            text="Load Properties" 
            onClick={() => { setIncludeCurrentLayer(false); setDisplayedRem(focusedRem)}} 
            img="M9 7V2.221a2 2 0 0 0-.5.365L4.586 6.5a2 2 0 0 0-.365.5H9Zm2 0V2h7a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5h7.586l-.293.293a1 1 0 0 0 1.414 1.414l2-2a1 1 0 0 0 0-1.414l-2-2a1 1 0 0 0-1.414 1.414l.293.293H4V9h5a2 2 0 0 0 2-2Z" 
            title="Load the currently focused Rem"
          />
        </div>
        <MyRemNoteButton 
          text="Expand All" 
          onClick={expandAll} 
          img="expand-icon"
          title="Expand or collapse all items"
        />
      </div>
      {displayedRem ? (
        loading ? (
          <div>Loading...</div>
        ) : (
          <>
            <div style={{ textAlign: "center", fontWeight: "bold", fontSize: 18, padding: 8 }}>
              {currentRem}
            </div>
            <div style={{ overflowY: "auto", maxHeight: "calc(100vh - 40px)", padding: "0 8px" }}>
              {parentGroups.map(parentGroup => (
                <div 
                  key={parentGroup.parentRem?._id || 'no-parent'} 
                  style={{ marginBottom: 16, border: '1px solid #ccc', padding: 8 }}
                >
                  <h3>{parentGroup.parentText}</h3>
                  {parentGroup.baseTypeGroups.map(group => {
                    const baseTypeId = group.baseType._id;
                    const isBaseCollapsed = collapsedBases.includes(baseTypeId);
                    const borderStyle = group.baseType._id === displayedRemBaseId ? "1px dashed #ccc" : "1px solid #ddd";
                    return (
                      <div 
                        key={baseTypeId} 
                        style={{ marginBottom: 16, border: borderStyle, padding: 8, borderRadius: 4 }}
                      >
                        <div style={{ display: 'grid', gridTemplateColumns: '10px 1fr', gap: '10px', alignItems: 'center', marginBottom: 8 }}>
                          <button 
                            onClick={() => toggleBaseCollapse(baseTypeId)} 
                            style={{ width: '100%', textAlign: 'center' }}
                            title={isBaseCollapsed ? "Expand" : "Collapse"}
                          >
                            {isBaseCollapsed ? '+' : '-'}
                          </button>
                          <MyRemNoteButton 
                            text={group.baseTypeText} 
                            onClick={() => handleCopyClick(group.baseType)}
                            title={group.baseTypeText}
                          />
                        </div>
                        {!isBaseCollapsed && (
                          <div style={{ marginLeft: 6 }}>
                            {[...group.roots]
                              .sort((a, b) => getSortIndex(a.itemType) - getSortIndex(b.itemType))
                              .map(root => (
                                <LayerItemNode key={root.item._id} item={root} />
                              ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </>
        )
      ) : (
        <div>No Rem loaded. Click the button to load the current Rem.</div>
      )}
    </div>
  );
}

export function ImplementWidget_() {
  const plugin = usePlugin() as RNPlugin;
  const [currentRem, setCurrentRem] = useState<string>("No Rem Focused");
  const [currentRemBase, setCurrentRemBase] = useState<string>("No Rem Focused");
  const [parentGroups, setParentGroups] = useState<UIParentGroup[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [collapsedBases, setCollapsedBases] = useState<string[]>([]);
  const [collapsedItems, setCollapsedItems] = useState<{ [itemId: string]: boolean }>({});
  const [displayedRem, setDisplayedRem] = useState<Rem | undefined>(undefined);
  const [displayedRemBaseId, setDisplayedRemBaseId] = useState<string | undefined>(undefined);
  const [includeCurrentLayer, setIncludeCurrentLayer] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const focusedRem = useTracker(async (reactPlugin) => {
    return await reactPlugin.focus.getFocusedRem();
  });

  const toggleBaseCollapse = (baseTypeId: string) => {
    setCollapsedBases(prev => {
      if (prev.includes(baseTypeId)) {
        return prev.filter(id => id !== baseTypeId);
      } else {
        return [...prev, baseTypeId];
      }
    });
  };

  const toggleItemCollapse = (itemId: string) => {
    setCollapsedItems(prev => {
      const current = prev[itemId] ?? true;
      return { ...prev, [itemId]: !current };
    });
  };

  const expandAll = () => {
    const allBaseIds = parentGroups.flatMap(parentGroup => parentGroup.baseTypeGroups.map(group => group.baseType._id));
    const allItemsExpanded = Object.values(collapsedItems).every(value => !value);
    const allBasesExpanded = collapsedBases.length === 0;

    if (allBasesExpanded && allItemsExpanded) {
      setCollapsedBases(allBaseIds);
      setCollapsedItems(prev => {
        const newCollapsed = { ...prev };
        Object.keys(newCollapsed).forEach(key => newCollapsed[key] = true);
        return newCollapsed;
      });
    } else {
      setCollapsedBases([]);
      setCollapsedItems(prev => {
        const newCollapsed = { ...prev };
        Object.keys(newCollapsed).forEach(key => newCollapsed[key] = false);
        return newCollapsed;
      });
    }
  };

  const collectItemsWithChildren = (roots: UITreeLayerItem[]): string[] => {
    const ids: string[] = [];
    const traverse = (item: UITreeLayerItem) => {
      if (item.children.length > 0) {
        ids.push(item.item._id);
        item.children.forEach(traverse);
      }
    };
    roots.forEach(traverse);
    return ids;
  };

  const groupLayerItems = async (layerItems: layerItem[], displayedRem: Rem): Promise<UIParentGroup[]> => {
    const allItems = layerItems.map(li => li.item);
    const allBaseTypes = layerItems.map(li => li.layerBaseType);

    const uniqueItems = Array.from(new Set(allItems));
    const uniqueBaseTypes = Array.from(new Set(allBaseTypes));

    const [itemTexts, baseTypeTexts] = await Promise.all([
      Promise.all(uniqueItems.map(rem => getRemText(plugin, rem))),
      Promise.all(uniqueBaseTypes.map(rem => getRemText(plugin, rem))),
    ]);

    const itemTextMap = new Map(uniqueItems.map((rem, index) => [rem._id, itemTexts[index]]));
    const baseTypeTextMap = new Map(uniqueBaseTypes.map((rem, index) => [rem._id, baseTypeTexts[index]]));

    const uiLayerItems = layerItems.map(li => ({
      ...li,
      text: itemTextMap.get(li.item._id) || "Unknown"
    }));

    const baseTypeMap = new Map<string, UILayerItem[]>();
    for (const item of uiLayerItems) {
      const baseTypeId = item.layerBaseType._id;
      if (!baseTypeMap.has(baseTypeId)) {
        baseTypeMap.set(baseTypeId, []);
      }
      baseTypeMap.get(baseTypeId)!.push(item);
    }

    const baseTypeGroups: UIBaseTypeGroup[] = [];
    for (const [baseTypeId, items] of baseTypeMap) {
      const baseType = items[0].layerBaseType;
      const baseTypeText = baseTypeTextMap.get(baseTypeId) || "Unknown";

      const itemMap = new Map<string, UITreeLayerItem>();
      items.forEach(item => {
        itemMap.set(item.item._id, { ...item, children: [] });
      });

      const childrenMap = new Map<string, UITreeLayerItem[]>();
      items.forEach(item => {
        if (item.layerParent) {
          for (const parent of item.layerParent) {
            if (itemMap.has(parent._id)) {
              const parentId = parent._id;
              if (!childrenMap.has(parentId)) {
                childrenMap.set(parentId, []);
              }
              childrenMap.get(parentId)!.push(itemMap.get(item.item._id)!);
              break;
            }
          }
        }
      });

      itemMap.forEach(item => {
        item.children = childrenMap.get(item.item._id) || [];
      });

      const allChildrenIds = new Set<string>();
      childrenMap.forEach(children => {
        children.forEach(child => allChildrenIds.add(child.item._id));
      });
      const roots = Array.from(itemMap.values()).filter(item => !allChildrenIds.has(item.item._id));

      baseTypeGroups.push({ baseType, baseTypeText, roots });
    }

    const parentGroupMap = new Map<string, UIParentGroup>();
    for (const group of baseTypeGroups) {
      const parentRem = await group.baseType.getParentRem();
      const parentId = parentRem ? parentRem._id : 'no-parent';
      const parentText = parentRem ? await getRemText(plugin, parentRem) : 'No Parent';

      if (!parentGroupMap.has(parentId)) {
        parentGroupMap.set(parentId, { parentRem, parentText, baseTypeGroups: [] });
      }
      parentGroupMap.get(parentId)!.baseTypeGroups.push(group);
    }

    const parentGroups = Array.from(parentGroupMap.values());

    const lineages = await getAncestorLineage(plugin, displayedRem);
    const maxLength = lineages.length > 0 ? Math.max(...lineages.map(lineage => lineage.length)) : 0;

    const getSortIndex = (parentRem: Rem | undefined): number => {
      if (!parentRem) return maxLength;
      let minIndex = Infinity;
      for (const lineage of lineages) {
        const index = lineage.findIndex(rem => rem._id === parentRem._id);
        if (index >= 0) {
          minIndex = Math.min(minIndex, index);
        }
      }
      return minIndex === Infinity ? maxLength : minIndex;
    };

    parentGroups.sort((a, b) => {
      const aIndex = getSortIndex(a.parentRem);
      const bIndex = getSortIndex(b.parentRem);
      if (bIndex !== aIndex) {
        return bIndex - aIndex;
      }
      return a.parentText.localeCompare(b.parentText);
    });

    return parentGroups;
  };

  function filterLayerItems(layerItems: layerItem[]): layerItem[] {
    const seenIds = new Set<string>();
    return layerItems.filter(layerItem => {
      const id = layerItem.item._id;
      if (seenIds.has(id)) {
        return false;
      } else {
        seenIds.add(id);
        return true;
      }
    });
  }

  const initializeWidget = async () => {
    if (!displayedRem) return;
    setLoading(true);

    const [txt, curBase, layerItems] = await Promise.all([
      getRemText(plugin, displayedRem),
      getBaseType(plugin, displayedRem),
      getLayers(plugin, displayedRem, includeCurrentLayer)
    ]);

    setCurrentRem(txt);
    const baseText = await getRemText(plugin, curBase);
    setCurrentRemBase(baseText);
    setDisplayedRemBaseId(curBase._id);

    const grouped = await groupLayerItems(filterLayerItems(layerItems), displayedRem);
    setParentGroups(grouped);

    const initialCollapsedBases = grouped.flatMap(parentGroup => parentGroup.baseTypeGroups.map(group => group.baseType._id));
    setCollapsedBases(initialCollapsedBases);

    const allItemsWithChildren = grouped.flatMap(parentGroup => parentGroup.baseTypeGroups.flatMap(group => collectItemsWithChildren(group.roots)));
    const initialCollapsedItems = Object.fromEntries(allItemsWithChildren.map(id => [id, true]));
    setCollapsedItems(initialCollapsedItems);

    setLoading(false);
  };

  useEffect(() => {
    initializeWidget();
  }, [displayedRem, plugin]);

  const handleCopyClick = async (rem: Rem) => {
    if (rem) {
      await rem.copyReferenceToClipboard();
    }
  };

  const getSortIndex = (itemType: string) => {
    switch (itemType) {
      case "Slot": return 0;
      case "Descriptor": return 1;
      case "Concept": return 2;
      default: return 3;
    }
  };

  const LayerItemNode = ({ item }: { item: UITreeLayerItem }) => {
    const isCollapsed = collapsedItems[item.item._id] ?? true;
    const hasChildren = item.children.length > 0;

    return (
      <div style={{ marginLeft: 6, marginBottom: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '10px 1fr', gap: '10px', alignItems: 'center' }}>
          <div>
            {hasChildren && (
              <button
                onClick={() => toggleItemCollapse(item.item._id)}
                style={{ width: '100%', textAlign: 'center' }}
                title={isCollapsed ? "Expand" : "Collapse"}
              >
                {isCollapsed ? '+' : '-'}
              </button>
            )}
          </div>
          <div>
            <MyRemNoteButton
              text={item.text}
              img={
                item.itemType === "Slot"
                  ? "M18 9V4a1 1 0 0 0-1-1H8.914a1 1 0 0 0-.707.293L4.293 7.207A1 1 0 0 0 4 7.914V20a1 1 0 0 0 1 1h4M9 3v4a1 1 0 0 1-1 1H4m11 6v4m-2-2h4m3 0a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z"
                  : item.itemType === "Concept"
                  ? "M15 4h3a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3m0 3h6m-3 5h3m-6 0h.01M12 16h3m-6 0h.01M10 3v4h4V3h-4Z"
                  : "M9 7V2.221a2 2 0 0 0-.5.365L4.586 6.5a2 2 0 0 0-.365.5H9Zm2 0V2h7a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5h7.586l-.293.293a1 1 0 0 0 1.414 1.414l2-2a1 1 0 0 0 0-1.414l-2-2a1 1 0 0 0-1.414 1.414l.293.293H4V9h5a2 2 0 0 0 2-2Z"
              }
              onClick={() => handleCopyClick(item.item)}
              title={item.fullPath}
            />
          </div>
        </div>
        {!isCollapsed && hasChildren && (
          <div style={{ marginLeft: 24, marginTop: 6 }}>
            {[...item.children]
              .sort((a, b) => getSortIndex(a.itemType) - getSortIndex(b.itemType))
              .map(child => (
                <LayerItemNode key={child.item._id} item={child} />
              ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", padding: 8 }}>
      <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <MyRemNoteButton 
            text="Load Interfaces" 
            onClick={() => { setIncludeCurrentLayer(true); setDisplayedRem(focusedRem)}} 
            img="M9 7V2.221a2 2 0 0 0-.5.365L4.586 6.5a2 2 0 0 0-.365.5H9Zm2 0V2h7a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5h7.586l-.293.293a1 1 0 0 0 1.414 1.414l2-2a1 1 0 0 0 0-1.414l-2-2a1 1 0 0 0-1.414 1.414l.293.293H4V9h5a2 2 0 0 0 2-2Z" 
            title="Load the currently focused Rem"
          />
          <MyRemNoteButton 
            text="Load Properties" 
            onClick={() => { setIncludeCurrentLayer(false); setDisplayedRem(focusedRem)}} 
            img="M9 7V2.221a2 2 0 0 0-.5.365L4.586 6.5a2 2 0 0 0-.365.5H9Zm2 0V2h7a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5h7.586l-.293.293a1 1 0 0 0 1.414 1.414l2-2a1 1 0 0 0 0-1.414l-2-2a1 1 0 0 0-1.414 1.414l.293.293H4V9h5a2 2 0 0 0 2-2Z" 
            title="Load the currently focused Rem"
          />
        </div>
      </div>
      <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => {setSearchQuery(e.target.value)}}
          placeholder="Search ..."
          className="flex-grow mr-2 p-1 border rounded"
        />
        <MyRemNoteButton 
          text="Search" 
          onClick={expandAll} 
          img="m21 21-3.5-3.5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z"
          title="Search"
        />
        <MyRemNoteButton 
          text="Expand All" 
          onClick={expandAll} 
          img="M8 4H4m0 0v4m0-4 5 5m7-5h4m0 0v4m0-4-5 5M8 20H4m0 0v-4m0 4 5-5m7 5h4m0 0v-4m0 4-5-5"
          title="Expand or collapse all items"
        />
      </div>
      {displayedRem ? (
        loading ? (
          <div>Loading...</div>
        ) : (
          <>
            <div style={{ textAlign: "center", fontWeight: "bold", fontSize: 18, padding: 8 }}>
              {currentRem}
            </div>
            <div style={{ overflowY: "auto", maxHeight: "calc(100vh - 40px)", padding: "0 8px" }}>
              {parentGroups.map(parentGroup => (
                <div 
                  key={parentGroup.parentRem?._id || 'no-parent'} 
                  style={{ marginBottom: 16, border: '1px solid #ccc', padding: 8 }}
                >
                  <h3>{parentGroup.parentText}</h3>
                  {parentGroup.baseTypeGroups.map(group => {
                    const baseTypeId = group.baseType._id;
                    const isBaseCollapsed = collapsedBases.includes(baseTypeId);
                    const borderStyle = group.baseType._id === displayedRemBaseId ? "1px dashed #ccc" : "1px solid #ddd";
                    return (
                      <div 
                        key={baseTypeId} 
                        style={{ marginBottom: 16, border: borderStyle, padding: 8, borderRadius: 4 }}
                      >
                        <div style={{ marginLeft: 6 }}>
                            {[...group.roots]
                              .sort((a, b) => getSortIndex(a.itemType) - getSortIndex(b.itemType))
                              .map(root => (
                                <LayerItemNode key={root.item._id} item={root} />
                              ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </>
        )
      ) : (
        <div>No Rem loaded. Click the button to load the current Rem.</div>
      )}
    </div>
  );
}

export function ImplementWidget() {
  const plugin = usePlugin() as RNPlugin;
  const [currentRem, setCurrentRem] = useState<string>("No Rem Focused");
  const [currentRemBase, setCurrentRemBase] = useState<string>("No Rem Focused");
  const [parentGroups, setParentGroups] = useState<UIParentGroup[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [collapsedBases, setCollapsedBases] = useState<string[]>([]);
  const [collapsedItems, setCollapsedItems] = useState<{ [itemId: string]: boolean }>({});
  const [displayedRem, setDisplayedRem] = useState<Rem | undefined>(undefined);
  const [displayedRemBaseId, setDisplayedRemBaseId] = useState<string | undefined>(undefined);
  const [includeCurrentLayer, setIncludeCurrentLayer] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [appliedSearchQuery, setAppliedSearchQuery] = useState("");

  const focusedRem = useTracker(async (reactPlugin) => {
    return await reactPlugin.focus.getFocusedRem();
  });

  const toggleBaseCollapse = (baseTypeId: string) => {
    setCollapsedBases(prev => {
      if (prev.includes(baseTypeId)) {
        return prev.filter(id => id !== baseTypeId);
      } else {
        return [...prev, baseTypeId];
      }
    });
  };

  const toggleItemCollapse = (itemId: string) => {
    setCollapsedItems(prev => {
      const current = prev[itemId] ?? true;
      return { ...prev, [itemId]: !current };
    });
  };

  const expandAll = () => {
    const allBaseIds = parentGroups.flatMap(parentGroup => parentGroup.baseTypeGroups.map(group => group.baseType._id));
    const allItemsExpanded = Object.values(collapsedItems).every(value => !value);
    const allBasesExpanded = collapsedBases.length === 0;

    if (allBasesExpanded && allItemsExpanded) {
      setCollapsedBases(allBaseIds);
      setCollapsedItems(prev => {
        const newCollapsed = { ...prev };
        Object.keys(newCollapsed).forEach(key => newCollapsed[key] = true);
        return newCollapsed;
      });
    } else {
      setCollapsedBases([]);
      setCollapsedItems(prev => {
        const newCollapsed = { ...prev };
        Object.keys(newCollapsed).forEach(key => newCollapsed[key] = false);
        return newCollapsed;
      });
    }
  };

  const collectItemsWithChildren = (roots: UITreeLayerItem[]): string[] => {
    const ids: string[] = [];
    const traverse = (item: UITreeLayerItem) => {
      if (item.children.length > 0) {
        ids.push(item.item._id);
        item.children.forEach(traverse);
      }
    };
    roots.forEach(traverse);
    return ids;
  };

  const groupLayerItems = async (layerItems: layerItem[], displayedRem: Rem): Promise<UIParentGroup[]> => {
    const allItems = layerItems.map(li => li.item);
    const allBaseTypes = layerItems.map(li => li.layerBaseType);

    const uniqueItems = Array.from(new Set(allItems));
    const uniqueBaseTypes = Array.from(new Set(allBaseTypes));

    const [itemTexts, baseTypeTexts] = await Promise.all([
      Promise.all(uniqueItems.map(rem => getRemText(plugin, rem))),
      Promise.all(uniqueBaseTypes.map(rem => getRemText(plugin, rem))),
    ]);

    const itemTextMap = new Map(uniqueItems.map((rem, index) => [rem._id, itemTexts[index]]));
    const baseTypeTextMap = new Map(uniqueBaseTypes.map((rem, index) => [rem._id, baseTypeTexts[index]]));

    const uiLayerItems = layerItems.map(li => ({
      ...li,
      text: itemTextMap.get(li.item._id) || "Unknown"
    }));

    const baseTypeMap = new Map<string, UILayerItem[]>();
    for (const item of uiLayerItems) {
      const baseTypeId = item.layerBaseType._id;
      if (!baseTypeMap.has(baseTypeId)) {
        baseTypeMap.set(baseTypeId, []);
      }
      baseTypeMap.get(baseTypeId)!.push(item);
    }

    const baseTypeGroups: UIBaseTypeGroup[] = [];
    for (const [baseTypeId, items] of baseTypeMap) {
      const baseType = items[0].layerBaseType;
      const baseTypeText = baseTypeTextMap.get(baseTypeId) || "Unknown";

      const itemMap = new Map<string, UITreeLayerItem>();
      items.forEach(item => {
        itemMap.set(item.item._id, { ...item, children: [] });
      });

      const childrenMap = new Map<string, UITreeLayerItem[]>();
      items.forEach(item => {
        if (item.layerParent) {
          for (const parent of item.layerParent) {
            if (itemMap.has(parent._id)) {
              const parentId = parent._id;
              if (!childrenMap.has(parentId)) {
                childrenMap.set(parentId, []);
              }
              childrenMap.get(parentId)!.push(itemMap.get(item.item._id)!);
              break;
            }
          }
        }
      });

      itemMap.forEach(item => {
        item.children = childrenMap.get(item.item._id) || [];
      });

      const allChildrenIds = new Set<string>();
      childrenMap.forEach(children => {
        children.forEach(child => allChildrenIds.add(child.item._id));
      });
      const roots = Array.from(itemMap.values()).filter(item => !allChildrenIds.has(item.item._id));

      baseTypeGroups.push({ baseType, baseTypeText, roots });
    }

    const parentGroupMap = new Map<string, UIParentGroup>();
    for (const group of baseTypeGroups) {
      const parentRem = await group.baseType.getParentRem();
      const parentId = parentRem ? parentRem._id : 'no-parent';
      const parentText = parentRem ? await getRemText(plugin, parentRem) : 'No Parent';

      if (!parentGroupMap.has(parentId)) {
        parentGroupMap.set(parentId, { parentRem, parentText, baseTypeGroups: [] });
      }
      parentGroupMap.get(parentId)!.baseTypeGroups.push(group);
    }

    const parentGroups = Array.from(parentGroupMap.values());

    const lineages = await getAncestorLineage(plugin, displayedRem);
    const maxLength = lineages.length > 0 ? Math.max(...lineages.map(lineage => lineage.length)) : 0;

    const getSortIndex = (parentRem: Rem | undefined): number => {
      if (!parentRem) return maxLength;
      let minIndex = Infinity;
      for (const lineage of lineages) {
        const index = lineage.findIndex(rem => rem._id === parentRem._id);
        if (index >= 0) {
          minIndex = Math.min(minIndex, index);
        }
      }
      return minIndex === Infinity ? maxLength : minIndex;
    };

    parentGroups.sort((a, b) => {
      const aIndex = getSortIndex(a.parentRem);
      const bIndex = getSortIndex(b.parentRem);
      if (bIndex !== aIndex) {
        return bIndex - aIndex;
      }
      return a.parentText.localeCompare(b.parentText);
    });

    return parentGroups;
  };

  function filterLayerItems(layerItems: layerItem[]): layerItem[] {
    const seenIds = new Set<string>();
    return layerItems.filter(layerItem => {
      const id = layerItem.item._id;
      if (seenIds.has(id)) {
        return false;
      } else {
        seenIds.add(id);
        return true;
      }
    });
  }

  const initializeWidget = async () => {
    if (!displayedRem) return;

    // Dont load Interfaces if BaseType hasnt changed
    // BUGGED: Cant load interfaces after loading properties and vice versa
    //if(includeCurrentLayer && (await getBaseType(plugin, displayedRem))._id == displayedRemBaseId) {
    //  setCurrentRem(await getRemText(plugin, displayedRem))
    //  return;
    //}

    setLoading(true);

    const [txt, curBase, layerItems] = await Promise.all([
      getRemText(plugin, displayedRem),
      getBaseType(plugin, displayedRem),
      getLayers2(plugin, displayedRem, includeCurrentLayer)
    ]);

    for(const l of layerItems) console.log(await getRemText(plugin, l.item));

    setCurrentRem(txt);
    const baseText = await getRemText(plugin, curBase);
    setCurrentRemBase(baseText);
    setDisplayedRemBaseId(curBase._id);

    const grouped = await groupLayerItems(filterLayerItems(layerItems), displayedRem);
    setParentGroups(grouped);

    const initialCollapsedBases = grouped.flatMap(parentGroup => parentGroup.baseTypeGroups.map(group => group.baseType._id));
    setCollapsedBases(initialCollapsedBases);

    const allItemsWithChildren = grouped.flatMap(parentGroup => parentGroup.baseTypeGroups.flatMap(group => collectItemsWithChildren(group.roots)));
    const initialCollapsedItems = Object.fromEntries(allItemsWithChildren.map(id => [id, true]));
    setCollapsedItems(initialCollapsedItems);

    setLoading(false);
  };

  useEffect(() => {
    initializeWidget();
  }, [displayedRem]); // }, [displayedRem, plugin]);

  const handleCopyClick = async (rem: Rem) => {
    if (rem) {
      await rem.copyReferenceToClipboard();
    }
  };

  const getSortIndex = (itemType: string) => {
    switch (itemType) {
      case "Slot": return 0;
      case "Descriptor": return 1;
      case "Concept": return 2;
      default: return 3;
    }
  };

  const LayerItemNode = ({ item }: { item: UITreeLayerItem }) => {
    const isCollapsed = collapsedItems[item.item._id] ?? true;
    const hasChildren = item.children.length > 0;

    return (
      <div style={{ marginLeft: 6, marginBottom: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '10px 1fr', gap: '10px', alignItems: 'center' }}>
          <div>
            {hasChildren && (
              <button
                onClick={() => toggleItemCollapse(item.item._id)}
                style={{ width: '100%', textAlign: 'center' }}
                title={isCollapsed ? "Expand" : "Collapse"}
              >
                {isCollapsed ? '+' : '-'}
              </button>
            )}
          </div>
          <div>
            <MyRemNoteButton
              text={item.text}
              img={
                item.itemType === "Slot"
                  ? "M18 9V4a1 1 0 0 0-1-1H8.914a1 1 0 0 0-.707.293L4.293 7.207A1 1 0 0 0 4 7.914V20a1 1 0 0 0 1 1h4M9 3v4a1 1 0 0 1-1 1H4m11 6v4m-2-2h4m3 0a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z"
                  : item.itemType === "Concept"
                  ? "M15 4h3a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3m0 3h6m-3 5h3m-6 0h.01M12 16h3m-6 0h.01M10 3v4h4V3h-4Z"
                  : "M9 7V2.221a2 2 0 0 0-.5.365L4.586 6.5a2 2 0 0 0-.365.5H9Zm2 0V2h7a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5h7.586l-.293.293a1 1 0 0 0 1.414 1.414l2-2a1 1 0 0 0 0-1.414l-2-2a1 1 0 0 0-1.414 1.414l.293.293H4V9h5a2 2 0 0 0 2-2Z"
              }
              onClick={() => handleCopyClick(item.item)}
              title={item.fullPath}
            />
          </div>
        </div>
        {!isCollapsed && hasChildren && (
          <div style={{ marginLeft: 24, marginTop: 6 }}>
            {[...item.children]
              .sort((a, b) => getSortIndex(a.itemType) - getSortIndex(b.itemType))
              .map(child => (
                <LayerItemNode key={child.item._id} item={child} />
              ))}
          </div>
        )}
      </div>
    );
  };

  const filterTree = (item: UITreeLayerItem, query: string): UITreeLayerItem | null => {
    const isMatching = item.fullPath.toLowerCase().includes(query.toLowerCase()) || item.text.toLowerCase().includes(query.toLowerCase()); // const isMatching = item.text.toLowerCase().includes(query.toLowerCase());
    const filteredChildren = item.children
      .map(child => filterTree(child, query))
      .filter(child => child !== null) as UITreeLayerItem[];
    if (isMatching || filteredChildren.length > 0) {
      return { ...item, children: filteredChildren };
    }
    return null;
  };

  const filteredParentGroups = useMemo(() => {
    if (!appliedSearchQuery) return parentGroups;
    const query = appliedSearchQuery.toLowerCase();
    return parentGroups
      .map(parentGroup => ({
        ...parentGroup,
        baseTypeGroups: parentGroup.baseTypeGroups
          .map(baseTypeGroup => ({
            ...baseTypeGroup,
            roots: baseTypeGroup.roots
              .map(root => filterTree(root, query))
              .filter(root => root !== null) as UITreeLayerItem[]
          }))
          .filter(baseTypeGroup => baseTypeGroup.roots.length > 0)
      }))
      .filter(parentGroup => parentGroup.baseTypeGroups.length > 0);
  }, [parentGroups, appliedSearchQuery]);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", padding: 8 }}>
      <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <MyRemNoteButton 
            text="Load Interfaces" 
            onClick={() => { setIncludeCurrentLayer(true); setDisplayedRem(focusedRem)}} 
            img="M12 13V4M7 14H5a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1h-2m-1-5-4 5-4-5m9 8h.01" 
            title="Load the currently focused Rem"
          />
          <MyRemNoteButton 
            text="Load Properties" 
            onClick={() => { setIncludeCurrentLayer(false); setDisplayedRem(focusedRem)}} 
            img="M12 13V4M7 14H5a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1h-2m-1-5-4 5-4-5m9 8h.01" 
            title="Load the currently focused Rem"
          />
        </div>
      </div>
      <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => {setSearchQuery(e.target.value)}}
          placeholder="Search..."
          className="flex-grow mr-2 p-1 border rounded"
        />
        <MyRemNoteButton 
          text="Search" 
          onClick={() => setAppliedSearchQuery(searchQuery)} 
          img="m21 21-3.5-3.5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z"
          title="Search"
        />
        <MyRemNoteButton 
          text="Expand All" 
          onClick={expandAll} 
          img="M8 4H4m0 0v4m0-4 5 5m7-5h4m0 0v4m0-4-5 5M8 20H4m0 0v-4m0 4 5-5m7 5h4m0 0v-4m0 4-5-5"
          title="Expand or collapse all items"
        />
      </div>
      {displayedRem ? (
        loading ? (
          <div>Loading...</div>
        ) : (
          <>
            <div style={{ textAlign: "center", fontWeight: "bold", fontSize: 18, padding: 8 }}>
              {currentRem}
            </div>
            <div style={{ overflowY: "auto", maxHeight: "calc(100vh - 40px)", padding: "0 8px" }}>
              {filteredParentGroups.map(parentGroup => (
                <div 
                  key={parentGroup.parentRem?._id || 'no-parent'} 
                  style={{ marginBottom: 16, border: '1px solid #ccc', padding: 8 }}
                >
                  <h3>{parentGroup.parentText}</h3>
                  {parentGroup.baseTypeGroups.map(group => {
                    const baseTypeId = group.baseType._id;
                    const isBaseCollapsed = collapsedBases.includes(baseTypeId);
                    const borderStyle = group.baseType._id === displayedRemBaseId ? "1px dashed #ccc" : "1px solid #ddd";
                    return (
                      <div 
                        key={baseTypeId} 
                        style={{ marginBottom: 16, border: borderStyle, padding: 8, borderRadius: 4 }}
                      >
                        <div style={{ marginLeft: 6 }}>
                          {[...group.roots]
                            .sort((a, b) => getSortIndex(a.itemType) - getSortIndex(b.itemType))
                            .map(root => (
                              <LayerItemNode key={root.item._id} item={root} />
                            ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
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