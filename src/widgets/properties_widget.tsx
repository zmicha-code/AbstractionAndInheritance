import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { renderWidget, useTracker, Rem, usePlugin, RNPlugin, RemType, Queue } from "@remnote/plugin-sdk";
import { getAncestorLineage, getBaseType, getRemText, getEncapsulatingClass, getCleanChildren, getCleanChildrenAll, getProperties, getInterfaceDescendants, getExtendsParents } from "../utils/utils";
import MyRemNoteButton from "../components/MyRemNoteButton";

// Simple XML escaper to keep output valid
const escapeXml = (str: string) =>
  str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

// Build XML for a single Rem and its subtree (pretty-printed)
const indent = (level: number) => "\t".repeat(Math.max(0, level));
const generateRemXml = async (
  plugin: RNPlugin,
  rem: Rem,
  depth: number = 0,
  maxDepth?: number,
  excludeFlashcards?: boolean
): Promise<string> => {
  const name = await getRemText(plugin, rem);
  const safeName = escapeXml(name || "");
  const children = await getCleanChildren(plugin, rem);
  // Determine tag based on Rem properties
  let tagName = "Rem";
  try {
    const isAnswer = await ((rem as any).isCardItem?.() ?? Promise.resolve(false));
    if (isAnswer === true) {
      tagName = "Answer";
    } else {
      const cards = (await ((rem as any).getCards?.() ?? Promise.resolve([]))) as any[];
      if (Array.isArray(cards) && cards.length > 0) {
        tagName = "Flashcard";
      } else {
        const isDoc = await ((rem as any).isDocument?.() ?? Promise.resolve(false));
        if (isDoc) tagName = "Property";
      }
    }
  } catch (_) {
    // Fall back to default tag if any of the API calls fail
  }

  // Optional extends attribute for Rem and Property using "extends" descriptor hierarchy
  let extendsAttr = "";
  if (tagName === "Rem" || tagName === "Property") {
    try {
      const parents = await getExtendsParents(plugin, rem);
      if (Array.isArray(parents) && parents.length > 0) {
        const parentNames = await Promise.all(parents.map((p) => getRemText(plugin, p)));
        const safe = escapeXml(parentNames.filter(Boolean).join(", "));
        if (safe) extendsAttr = ` extends=\"${safe}\"`;
      }
    } catch (_) {}
  }

  // Optionally skip Flashcard/Answer nodes entirely
  if (excludeFlashcards && (tagName === "Flashcard" || tagName === "Answer")) {
    return "";
  }

  const openTag = `<${tagName} name=\"${safeName}\"${extendsAttr}>`;
  const closeTag = `</${tagName}>`;

  // Depth limiting: stop adding children once maxDepth is reached
  const reachedDepthLimit = typeof maxDepth === 'number' && depth >= maxDepth;

  if (children.length === 0 || reachedDepthLimit) {
    // Keep multiline for consistency, even without children
    return `${indent(depth)}${openTag}\n${indent(depth)}${closeTag}`;
  }

  const parts: string[] = [];
  for (const child of children) {
    const chunk = await generateRemXml(plugin, child, depth + 1, maxDepth, excludeFlashcards);
    if (chunk) parts.push(chunk);
  }
  const inner = parts.join("\n");
  return `${indent(depth)}${openTag}\n${inner}\n${indent(depth)}${closeTag}`;
};

// New function to generate the XML export string
const generateXml = async (plugin: RNPlugin, rem: Rem, maxDepth?: number, excludeFlashcards?: boolean): Promise<string> => {
  const body = await generateRemXml(plugin, rem, 0, maxDepth, excludeFlashcards);
  return `${body}`;
};

function PropertiesWidget() {
    const plugin = usePlugin();

    const [selectedRem, setSelectedRem] = useState<Rem | undefined>(undefined);
    const [selectedRemName, setSelectedRemName] = useState<string>("");
    const [xmlExport, setXmlExport] = useState<string>("");
    const [maxDepth, setMaxDepth] = useState<number | undefined>(undefined);
    const [excludeFlashcards, setExcludeFlashcards] = useState<boolean>(true);

    const [loading, setLoading] = useState<boolean>(false);

    // Upper-half: Grouped properties state
    type PropertyItem = { rem: Rem; name: string; icon: string };
    type PropertyGroup = { classRem: Rem; className: string; depth: number; items: PropertyItem[] };
    type InterfaceItem = { rem: Rem; name: string };
    type InterfaceGroup = { classRem: Rem; className: string; depth: number; items: InterfaceItem[] };
    const [propertyGroups, setPropertyGroups] = useState<PropertyGroup[]>([]);
    const [interfaceGroups, setInterfaceGroups] = useState<InterfaceGroup[]>([]);
    const [propertiesLoading, setPropertiesLoading] = useState<boolean>(false);
    const [propertiesForRemName, setPropertiesForRemName] = useState<string>("");
    const [activeList, setActiveList] = useState<"properties" | "interfaces" | null>(null);
    const [showExport, setShowExport] = useState<boolean>(false);

    const focusedRem = useTracker(async (reactPlugin) => {
            return await reactPlugin.focus.getFocusedRem();
        }
    );

    // Manual refresh: build property groups on demand
    const refreshProperties = useCallback(async () => {
      if (!focusedRem) return;
      setShowExport(false);
      setPropertiesLoading(true);
      try {
        // Name of the Rem whose properties will be displayed
        const forName = await getRemText(plugin, focusedRem);
        setPropertiesForRemName(forName);

        // 1) Load flat properties
        const props = await getProperties(plugin, focusedRem);

        // 2) Compute ancestor order (depth) across all lineages
        const lineages = await getAncestorLineage(plugin, focusedRem);
        const depthMap = new Map<string, number>();
        for (const lineage of lineages) {
          for (let i = 1; i < lineage.length; i++) {
            const anc = lineage[i];
            const prev = depthMap.get(anc._id) ?? -1;
            if (i > prev) depthMap.set(anc._id, i);
          }
        }

        // Precompute: which properties are already extended in the current Rem (via extends)
        const currentChildren = await focusedRem.getChildrenRem();
        const childRefTargets = new Set<string>();
        for (const ch of currentChildren) {
          try {
            if (await ch.isDocument()) {
              const parents = await getExtendsParents(plugin, ch);
              for (const p of parents) childRefTargets.add(p._id);
            }
          } catch {}
        }

        // Icon paths per state
        const ICON_NEW = "M2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10S2 17.523 2 12Zm11-4.243a1 1 0 1 0-2 0V11H7.757a1 1 0 1 0 0 2H11v3.243a1 1 0 1 0 2 0V13h3.243a1 1 0 1 0 0-2H13V7.757Z";
        const ICON_EXTENDS = "M2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10S2 17.523 2 12Zm11-4a1 1 0 1 0-2 0v5a1 1 0 1 0 2 0V8Zm-1 7a1 1 0 1 0 0 2h.01a1 1 0 1 0 0-2H12Z";
        const ICON_ALREADY_EXTENDED = "M9 7V2.221a2 2 0 0 0-.5.365L4.586 6.5a2 2 0 0 0-.365.5H9Zm2 0V2h7a2 2 0 0 1 2 2v9.293l-2-2a1 1 0 0 0-1.414 1.414l.293.293h-6.586a1 1 0 1 0 0 2h6.586l-.293.293A1 1 0 0 0 18 16.707l2-2V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9h5a2 2 0 0 0 2-2Z";

        // 3) Group by defining class (parent of property document)
        const groupMap = new Map<string, PropertyGroup>();
        for (const p of props) {
          const parent = await p.getParentRem();
          if (!parent) continue;
          const key = parent._id;
          if (!groupMap.has(key)) {
            const className = await getRemText(plugin, parent);
            const depth = depthMap.get(parent._id) ?? 0;
            groupMap.set(key, { classRem: parent, className, depth, items: [] });
          }
          const name = await getRemText(plugin, p);
          // Determine icon based on reference state and local extension
          let icon = ICON_NEW;
          try {
            const parents = await getExtendsParents(plugin, p);
            const hasRef = parents.length > 0;
            const alreadyExtended = childRefTargets.has(p._id);
            if (alreadyExtended) icon = ICON_ALREADY_EXTENDED;
            else if (hasRef) icon = ICON_EXTENDS;
          } catch {}
          groupMap.get(key)!.items.push({ rem: p, name, icon });
        }

        // 4) Sort groups by depth: farthest ancestor first (largest depth first)
        const groups = Array.from(groupMap.values()).sort((a, b) => b.depth - a.depth);
        setPropertyGroups(groups);
        setActiveList("properties");
      } finally {
        setPropertiesLoading(false);
      }
    }, [focusedRem, plugin]);

    // Manual refresh: load interfaces only
    const refreshInterfaces = useCallback(async () => {
      if (!focusedRem) return;
      setShowExport(false);
      setPropertiesLoading(true);
      try {
        const forName = await getRemText(plugin, focusedRem);
        setPropertiesForRemName(forName);

        const interfaceEntries = await getInterfaceDescendants(plugin, focusedRem);

        // Compute ancestor order (depth) across all lineages
        const lineages = await getAncestorLineage(plugin, focusedRem);
        const depthMap = new Map<string, number>();
        for (const lineage of lineages) {
          for (let i = 1; i < lineage.length; i++) {
            const anc = lineage[i];
            const prev = depthMap.get(anc._id) ?? -1;
            if (i > prev) depthMap.set(anc._id, i);
          }
        }

        // Group by defining class (parent of interface rem)
        const ifaceGroupMap = new Map<string, InterfaceGroup>();
        for (const entry of interfaceEntries) {
          const it = entry.rem;
          const parent = await it.getParentRem();
          if (!parent) continue;
          const key = parent._id;
          if (!ifaceGroupMap.has(key)) {
            const className = await getRemText(plugin, parent);
            const depth = depthMap.get(parent._id) ?? 0;
            ifaceGroupMap.set(key, { classRem: parent, className, depth, items: [] });
          }
          const name = await getRemText(plugin, it);
          ifaceGroupMap.get(key)!.items.push({ rem: it, name });
        }
        const ifaceGroups = Array.from(ifaceGroupMap.values()).sort((a, b) => b.depth - a.depth);
        setInterfaceGroups(ifaceGroups);
        setActiveList("interfaces");
      } finally {
        setPropertiesLoading(false);
      }
    }, [focusedRem, plugin]);

    const lastFocusedIdRef = useRef<string | undefined>();

    useEffect(() => {
      const currentId = focusedRem?._id;
      if (!currentId) {
        lastFocusedIdRef.current = undefined;
        return;
      }
      if (lastFocusedIdRef.current === currentId) {
        return;
      }
      lastFocusedIdRef.current = currentId;
      //void refreshProperties();
    }, [focusedRem, refreshProperties]);

    const handleLoadMindMap = async (rem: Rem | undefined) => {
        await plugin.window.openWidgetInPane('mindmap_widget');
    };

    const handleExportClick = async (rem: Rem | undefined) => {
        if (!rem) return;
        setShowExport(true);
        setActiveList(null);
        setSelectedRem(rem);
        const name = await getRemText(plugin, rem);
        setSelectedRemName(name);

        // Set xmlExport using the new generateXml function
        setLoading(true);
        const xml = await generateXml(plugin, rem, maxDepth, excludeFlashcards);
        setXmlExport(xml);
        setLoading(false);
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

    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
        {/* Header: always visible */}
        <div style={{ padding: 8, borderBottom: "1px solid #ddd", background: "var(--rn-clr-background-primary, #fff)", position: "sticky", top: 0, zIndex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <MyRemNoteButton
              key={"LoadPropertiesButton"}
              text="Load Properties"
              title="Load properties for focused Rem"
              onClick={refreshProperties}
              img="M12 13V4M7 14H5a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1h-2m-1-5-4 5-4-5m9 8h.01"
            />
            <MyRemNoteButton
              key={"LoadInterfacesButton"}
              text="Load Interfaces"
              title="Load interfaces for focused Rem"
              onClick={refreshInterfaces}
              img="M4 4v6h6M20 20v-6h-6M20 14a6 6 0 0 0-6 6M4 10a6 6 0 0 1 6-6"
            />
            <MyRemNoteButton
              key={"LoadMindMap"}
              text="Load MindMap"
              title=""
              onClick={handleLoadMindMap}
              img="M4 4v6h6M20 20v-6h-6M20 14a6 6 0 0 0-6 6M4 10a6 6 0 0 1 6-6"
            />
            {/* Export controls */}
            <select
              aria-label="Max Depth"
              value={maxDepth === undefined ? "" : String(maxDepth)}
              onChange={(e) => {
                const v = e.target.value;
                setMaxDepth(v === "" ? undefined : parseInt(v, 10));
              }}
            >
              <option value="">Depth: Unlimited</option>
              <option value="1">Depth: 1</option>
              <option value="2">Depth: 2</option>
              <option value="3">Depth: 3</option>
              <option value="4">Depth: 4</option>
              <option value="5">Depth: 5</option>
              <option value="6">Depth: 6</option>
              <option value="7">Depth: 7</option>
              <option value="8">Depth: 8</option>
              <option value="9">Depth: 9</option>
              <option value="10">Depth: 10</option>
            </select>
            <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <input
                type="checkbox"
                checked={excludeFlashcards}
                onChange={(e) => setExcludeFlashcards(e.target.checked)}
              />
              Exclude flashcards
            </label>
            <MyRemNoteButton
              key={"ExportButton"}
              text="Export"
              title="Export focused Rem as XML"
              onClick={() => handleExportClick(focusedRem)}
              img="M12 13V4M7 14H5a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1h-2m-1-5-4 5-4-5m9 8h.01"
            />
            {propertiesForRemName && (
              <div style={{ color: "#666" }}>(for: {propertiesForRemName})</div>
            )}
          </div>
        </div>

        {/* Export output area (only when exporting) */}
        {showExport && (
          <div style={{ flex: 1, display: "flex", padding: 8, overflow: "hidden", minHeight: 0 }}>
            {loading ? (
              <div>Loading...</div>
            ) : (
              <textarea
                value={xmlExport}
                readOnly
                placeholder="XML export will appear here after clicking Export"
                style={{ flex: 1, width: "100%", height: "100%", fontFamily: "monospace", whiteSpace: "pre", resize: "none" }}
              />
            )}
          </div>
        )}

        {/* Scrollable content area */}
        {!showExport && (
        <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
          {propertiesLoading ? (
            <div>Loading properties...</div>
          ) : activeList === "properties" ? (
            propertyGroups.length === 0 ? (
              <div style={{ color: "#888" }}>No properties</div>
            ) : (
              <div>
                {propertyGroups.map((group) => (
                  <div key={group.classRem._id} style={{ marginBottom: 10 }}>
                    <div style={{ fontWeight: 600, margin: "6px 0" }}><button onClick={() => handleOpenRem(group.classRem)}>{group.className}</button></div>
                    <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                      {group.items.map((item) => (
                        <li key={item.rem._id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #eee" }}>
                          <MyRemNoteButton
                              key={"CopyPropertiesButton"}
                              text={item.name}
                              title="Copy property reference"
                              onClick={() => handleCopyClick(item.rem)}
                              img={item.icon}
                          />
                          <span style={{ display: "flex", gap: 6 }}>
                            <MyRemNoteButton
                              key={"OpenPropertiesButton"}
                              text="" title="Open Property"
                              onClick={() => handleOpenRem(item.rem)}
                              img="M4 4a2 2 0 0 0-2 2v12a2 2 0 0 0 .087.586l2.977-7.937A1 1 0 0 1 6 10h12V9a2 2 0 0 0-2-2h-4.532l-1.9-2.28A2 2 0 0 0 8.032 4H4Zm2.693 8H6.5l-3 8H18l3-8H6.693Z" />
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )
          ) : activeList === "interfaces" ? (
            interfaceGroups.length === 0 ? (
              <div style={{ color: "#888" }}>No interfaces</div>
            ) : (
              <div>
                {interfaceGroups.map((group) => (
                  <div key={group.classRem._id} style={{ marginBottom: 10 }}>
                    <div style={{ fontWeight: 600, margin: "6px 0" }}><button onClick={() => handleOpenRem(group.classRem)}>{group.className}</button></div>
                    <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                      {group.items.map((item) => (
                        <li key={item.rem._id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #eee" }}>
                          <MyRemNoteButton
                            key={`CopyInterface-${item.rem._id}`}
                            text={item.name}
                            title="Copy interface reference"
                            onClick={() => handleCopyClick(item.rem)}
                          />
                          <span style={{ display: "flex", gap: 6 }}>
                            <MyRemNoteButton
                              key={`OpenInterface-${item.rem._id}`}
                              text=""
                              title="Open Interface"
                              onClick={() => handleOpenRem(item.rem)}
                              img="M4 4a2 2 0 0 0-2 2v12a2 2 0 0 0 .087.586l2.977-7.937A1 1 0 0 1 6 10h12V9a2 2 0 0 0-2-2h-4.532l-1.9-2.28A2 2 0 0 0 8.032 4H4Zm2.693 8H6.5l-3 8H18l3-8H6.693Z"
                            />
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )
          ) : (
            <div style={{ color: "#888" }}>Click "Load Properties" or "Load Interfaces"</div>
          )}
        </div>
        )}
      </div>
    );
}

renderWidget(PropertiesWidget);