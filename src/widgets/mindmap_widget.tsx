import React, { useCallback, useEffect, useState, useRef } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  ReactFlowInstance,
  applyNodeChanges,
} from "reactflow";
import "reactflow/dist/style.css";
import { renderWidget, usePlugin, useTrackerPlugin, PluginRem, RNPlugin, RemType, SetRemType } from "@remnote/plugin-sdk";
import { RichTextInterface } from "@remnote/plugin-sdk";

import {
  getRemText,
  getParentClass,
  getExtendsChildren,
  getExtendsParents,
  updateDescendantPropertyReferences,
  updateDescendantInterfaceReferences,
  hasTag,
  getTag,
  isPropertyDescriptor,
  getClassProperties,
  getClassDescriptors,
  getAncestorLineageStrings,
} from "../utils/utils";

import { EDGE_TYPES } from "../components/Edges";
import { makeDefaultView, findInAttributeForest } from "../utils/defaultView";

import {
  HierarchyNode,
  GraphNode,
  GraphEdge,
  GraphNodeData,
  AttributeData,
  AttributeNodeInfo,
  MindMapState,
  ExportMetadata,
  LoadComputationContext,
} from "../mindmap/types";
import { NODE_TYPES } from "../mindmap/flowNodes";
import { createLoadComputationContext, findRemCached, buildCompleteChildToParentsMap } from "../mindmap/cache";
import {
  buildAncestorNodes,
  buildDescendantNodes,
  collectRemsForProperties,
  buildHierarchyRemIdSet,
  buildDescendantOwnerMap,
  findNodeById,
} from "../mindmap/hierarchy";
import {
  buildAttributeData,
  splitInterfaceData,
  filterExportedInterfaces,
  attributeNodeId,
} from "../mindmap/attributeData";
import { buildVirtualAttributeData } from "../mindmap/virtualData";
import { createGraphData, addMissingRemEdges } from "../mindmap/graph";
import { saveMindMapState, loadMindMapState } from "../mindmap/state";
import { createTimeoutSignal } from "../mindmap/timeout";

function MindmapWidget() {
  const plugin = usePlugin();

  const focusedRem = useTrackerPlugin(async (reactPlugin) => {
    return await reactPlugin.focus.getFocusedRem();
  });

  const [focusedRemName, setFocusedRemName] = useState<string>("");
  const [loadedRemName, setLoadedRemName] = useState<string>("");
  const [loadedRemRichText, setLoadedRemRichText] = useState<RichTextInterface | undefined>(undefined);
  const [loadedRemId, setLoadedRemId] = useState<string>("");
  const [ancestorTrees, setAncestorTrees] = useState<HierarchyNode[]>([]);
  const [descendantTrees, setDescendantTrees] = useState<HierarchyNode[]>([]);
  const [descendantOwnerMap, setDescendantOwnerMap] = useState<Record<string, string>>({});
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(() => new Set<string>());
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [propertyData, setPropertyData] = useState<AttributeData | null>(null);
  const [interfaceData, setInterfaceData] = useState<AttributeData | null>(null);
  const [directPropertyData, setDirectPropertyData] = useState<AttributeData | null>(null);
  const [hiddenAttributes, setHiddenAttributes] = useState<Set<string>>(() => new Set<string>());
  const [hiddenVirtualAttributes, setHiddenVirtualAttributes] = useState<Set<string>>(() => new Set<string>());
  const [attributeType, setAttributeType] = useState<'property' | 'interface'>('property');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isPartialLoad, setIsPartialLoad] = useState<boolean>(false);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  const [historyStack, setHistoryStack] = useState<string[]>([]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; remId: string; label: string } | null>(null);
  const [virtualContextMenu, setVirtualContextMenu] = useState<{ x: number; y: number; nodeId: string; label: string; sourcePropertyId: string; ownerRemId: string } | null>(null);
  const [groupContextMenu, setGroupContextMenu] = useState<{ x: number; y: number; nodeId: string; label: string; ownerRemId: string } | null>(null);
  const [paneContextMenu, setPaneContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [parentMap, setParentMap] = useState<Map<string, string>>(new Map());
  const [isInitialized, setIsInitialized] = useState<boolean>(false);

  const nodePositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const hiddenAttributeOffsetsRef = useRef<Map<string, { dx: number; dy: number }>>(new Map());
  const loadComputationContextRef = useRef<LoadComputationContext>(createLoadComputationContext());

  const storePositions = useCallback((nodeList: GraphNode[]) => {
    for (const node of nodeList) {
      nodePositionsRef.current.set(node.id, {
        x: node.position.x,
        y: node.position.y,
      });
    }
  }, []);

  const focusedRemId = focusedRem?._id;

  // Save state whenever key values change
  useEffect(() => {
    if (!isInitialized || !loadedRemId) return;

    const stateToSave: MindMapState = {
      loadedRemId,
      attributeType,
      historyStack,
    };

    saveMindMapState(plugin, stateToSave);
  }, [
    isInitialized,
    loadedRemId,
    attributeType,
    historyStack,
    plugin,
  ]);

  // Load saved state on mount
  useEffect(() => {
    let cancelled = false;

    async function updateFocusedName() {
      if (!focusedRem) {
        if (!cancelled) setFocusedRemName("");
        return;
      }
      try {
        const name = await getRemText(plugin, focusedRem);
        if (!cancelled) setFocusedRemName(name || "(Untitled Rem)");
      } catch (_) {
        if (!cancelled) setFocusedRemName("");
      }
    }

    updateFocusedName();
    return () => {
      cancelled = true;
    };
  }, [plugin, focusedRem]);

  const updateGraph = useCallback(async () => {
    if (!loadedRemId) return;
    // When attributeType is 'property', use both propertyData and directPropertyData
    const primaryData = attributeType === 'property' ? propertyData : interfaceData;
    const secondaryData = attributeType === 'property' ? directPropertyData : undefined;
    const primaryKind: 'property' | 'interface' | 'directProperty' = attributeType === 'property' ? 'property' : 'interface';
    const secondaryKind: 'property' | 'interface' | 'directProperty' | undefined = attributeType === 'property' ? 'directProperty' : undefined;
    
    const graph = await createGraphData(
      plugin,
      loadedRemId,
      loadedRemName || "(Untitled Rem)",
      loadedRemRichText,
      ancestorTrees,
      descendantTrees,
      collapsedNodes,
      primaryData ?? undefined,
      hiddenAttributes,
      hiddenVirtualAttributes,
      nodePositionsRef.current,
      primaryKind,
      secondaryData ?? undefined,
      secondaryKind,
      loadComputationContextRef.current
    );
    const updatedEdges = await addMissingRemEdges(
      plugin,
      graph.nodes,
      graph.edges,
      loadComputationContextRef.current.childToParentsMap,
      loadComputationContextRef.current
    );
    
    // Rebuild parentMap from edges — covers all attribute/virtual hierarchies:
    // attr-link/attr-child (regular properties), vpropgroup-link/vpropgroup-child (virtual property groups),
    // vgroup-link/vgroup-child (virtual interface groups), vattr-link/vattr-child (virtual attr descendants)
    setParentMap(() => {
      const newMap = new Map<string, string>();
      const ATTR_EDGE_PREFIXES = [
        'attr-link:', 'attr-child:',
        'vpropgroup-link:', 'vpropgroup-child:',
        'vgroup-link:', 'vgroup-child:',
        'vattr-link:', 'vattr-child:',
      ];
      for (const edge of updatedEdges) {
        if (ATTR_EDGE_PREFIXES.some(prefix => edge.id.startsWith(prefix))) {
          newMap.set(edge.target, edge.source);
        }
      }
      return newMap;
    });
    
    setNodes(graph.nodes);
    storePositions(graph.nodes);
    setEdges(updatedEdges);
  }, [loadedRemId, loadedRemName, loadedRemRichText, ancestorTrees, descendantTrees, collapsedNodes, propertyData, interfaceData, directPropertyData, hiddenAttributes, hiddenVirtualAttributes, plugin, storePositions, attributeType]);

  const loadHierarchy = useCallback(
    async (remId: string, ancestorsOnly?: boolean) => {
      loadComputationContextRef.current = createLoadComputationContext();
      setLoading(true);
      setError(null);
      setIsPartialLoad(false);
      setPropertyData(null);
      setInterfaceData(null);
      setDirectPropertyData(null);
      setHiddenAttributes(new Set<string>());
      setHiddenVirtualAttributes(new Set<string>());
      setNodes([]);
      setEdges([]);
      
      // Create timeout signal for graceful termination
      const timeoutSignal = createTimeoutSignal();
      
      try {
        const rem = await findRemCached(plugin, remId, loadComputationContextRef.current);
        if (!rem) {
          throw new Error("Unable to load the selected rem.");
        }

        if ((await rem.getType()) === RemType.PORTAL) {
          setAncestorTrees([]);
          setDescendantTrees([]);
          setDescendantOwnerMap({});
          setCollapsedNodes(new Set<string>());
          setPropertyData({ byOwner: {}, byId: {} });
          setInterfaceData({ byOwner: {}, byId: {} });
          setDirectPropertyData({ byOwner: {}, byId: {} });
          setHiddenAttributes(new Set<string>());
          setHiddenVirtualAttributes(new Set<string>());
          setLoadedRemId(rem._id);
          setLoadedRemName((await getRemText(plugin, rem)) || "(Untitled Rem)");
          setLoadedRemRichText(rem.text);
          setParentMap(new Map());
          setNodes([]);
          setEdges([]);
          return;
        }

        const tLoad = performance.now();

        // 1.1 Collect Ancestors and Descendants
        // Use separate visited sets to avoid race conditions between parallel builds
        const visitedAncestors = new Set<string>([rem._id]);
        const visitedDescendants = new Set<string>([rem._id]);
        const t0 = performance.now();
        const [name, ancestorTreesResult, descendantTreesResult] = await Promise.all([
          getRemText(plugin, rem),
          buildAncestorNodes(plugin, rem, visitedAncestors, loadComputationContextRef.current, timeoutSignal),
          ancestorsOnly ? Promise.resolve([]) : buildDescendantNodes(plugin, rem, visitedDescendants, timeoutSignal),
        ]);
        console.log(`[perf] phase 1 buildAncestors+buildDescendants: ${(performance.now() - t0).toFixed(0)}ms | ancestors=${ancestorTreesResult.length} descendants=${descendantTreesResult.length}`);

        // 1.2 Collect Properties
        const centerLabel = name || "(Untitled Rem)";
        const remsForAttributes = collectRemsForProperties(
          rem,
          ancestorTreesResult,
          descendantTreesResult
        );

        // Collect all hierarchy REM ids so extends-children of interface owners that are
        // class hierarchy nodes are not mistakenly treated as interface attributes.
        const hierarchyRemIds = new Set<string>([rem._id]);
        const hierarchyStack: HierarchyNode[] = [...ancestorTreesResult, ...descendantTreesResult];
        while (hierarchyStack.length > 0) {
          const hn = hierarchyStack.pop()!;
          hierarchyRemIds.add(hn.id);
          if (hn.children && hn.children.length > 0) {
            hierarchyStack.push(...hn.children);
          }
        }
        const t1 = performance.now();
        // Lazy loading: only load the attribute kind needed for the active view.
        // The other kind is loaded on demand the first time the user switches view modes.
        let properties: AttributeData = { byOwner: {}, byId: {} };
        let interfaces: AttributeData = { byOwner: {}, byId: {} };
        let directProperties: AttributeData = { byOwner: {}, byId: {} };
        if (attributeType === 'property') {
          // Property view: load properties + directProperties from one call; interfaces loaded lazily on switch
          const propertiesRaw = await buildAttributeData(plugin, remsForAttributes, true, undefined, timeoutSignal, undefined, loadComputationContextRef.current);
          const t1b = performance.now();
          console.log(`[perf] phase 2a buildAttributeData (properties+directProperties): ${(t1b - t1).toFixed(0)}ms | propOwners=${Object.keys(propertiesRaw.byOwner).length} cacheSize=${loadComputationContextRef.current.extendsChildrenCache.size}`);
          const { regularInterfaces: propertiesSplit, directProperties: dp } = splitInterfaceData(propertiesRaw);
          properties = propertiesSplit;
          directProperties = dp;
        } else {
          // Interface view: load interfaces/directProperties only; properties loaded lazily on switch
          const interfacesRaw = await buildAttributeData(plugin, remsForAttributes, false, undefined, timeoutSignal, hierarchyRemIds, loadComputationContextRef.current);
          const t1b = performance.now();
          console.log(`[perf] phase 2b buildAttributeData (interfaces): ${(t1b - t1).toFixed(0)}ms | ifaceOwners=${Object.keys(interfacesRaw.byOwner).length} cacheSize=${loadComputationContextRef.current.extendsChildrenCache.size}`);
          const { regularInterfaces: interfacesUnfiltered, directProperties: dp } = splitInterfaceData(interfacesRaw);
          interfaces = filterExportedInterfaces(interfacesUnfiltered);
          directProperties = dp;
        }
        console.log(`[perf] phase 2 buildAttributeData total: ${(performance.now() - t1).toFixed(0)}ms | rems=${remsForAttributes.length}`);

        // 1.3 Default collapse is applied after virtual attribute trees are built.
        const collapsed = new Set<string>();

        // 1.4 Build complete parent map once per load for virtual computations and edge completion
        const t2 = performance.now();
        const childToParentsMap = await buildCompleteChildToParentsMap(
          plugin,
          rem._id,
          ancestorTreesResult,
          descendantTreesResult,
          loadComputationContextRef.current,
          timeoutSignal
        );
        console.log(`[perf] phase 3 buildCompleteChildToParentsMap: ${(performance.now() - t2).toFixed(0)}ms | entries=${Object.keys(childToParentsMap).length}`);

        const t3 = performance.now();
        // Build virtual data only for the active view; the rest is built lazily on first switch
        if (attributeType === 'property') {
          const virtualPropertyData = buildVirtualAttributeData(
            properties,
            rem._id,
            ancestorTreesResult,
            descendantTreesResult,
            'property',
            childToParentsMap,
            new Set([rem._id])
          );
          loadComputationContextRef.current.virtualDataByKind.property = virtualPropertyData;
          const virtualDirectPropertyData = buildVirtualAttributeData(
            directProperties,
            rem._id,
            ancestorTreesResult,
            descendantTreesResult,
            'directProperty',
            childToParentsMap,
            new Set([rem._id])
          );
          loadComputationContextRef.current.virtualDataByKind.directProperty = virtualDirectPropertyData;
        } else {
          const virtualInterfaceData = buildVirtualAttributeData(
            interfaces,
            rem._id,
            ancestorTreesResult,
            descendantTreesResult,
            'interface',
            childToParentsMap,
            new Set([rem._id])
          );
          loadComputationContextRef.current.virtualDataByKind.interface = virtualInterfaceData;
        }
        console.log(`[perf] phase 4 buildVirtualAttributeData: ${(performance.now() - t3).toFixed(0)}ms`);

        //
        makeDefaultView(collapsed, ancestorTreesResult, descendantTreesResult, [
          properties.byOwner,
          interfaces.byOwner,
          directProperties.byOwner,
          loadComputationContextRef.current.virtualDataByKind.property?.byOwner,
          loadComputationContextRef.current.virtualDataByKind.directProperty?.byOwner,
          loadComputationContextRef.current.virtualDataByKind.interface?.byOwner,
        ]);

        const hidden = new Set<string>();

        setAncestorTrees(ancestorTreesResult);
        setDescendantTrees(descendantTreesResult);
        setDescendantOwnerMap(buildDescendantOwnerMap(descendantTreesResult));
        setCollapsedNodes(collapsed);
        nodePositionsRef.current = new Map<string, { x: number; y: number }>();
        // Only store data for the active mode; null signals lazy-load on first switch to the other mode
        setPropertyData(attributeType === 'property' ? properties : null);
        setInterfaceData(attributeType === 'interface' ? interfaces : null);
        setDirectPropertyData(directProperties); // always set — both modes now produce it
        setHiddenAttributes(hidden);
        setLoadedRemId(rem._id);
        setLoadedRemName(centerLabel);
        setLoadedRemRichText(rem.text);

        const newParentMap = new Map<string, string>();
        const buildRemParentMap = (forest: HierarchyNode[]) => {
          const stack: { node: HierarchyNode; parent?: string }[] = forest.map((n) => ({ node: n }));
          while (stack.length) {
            const { node, parent } = stack.pop()!;
            if (parent) newParentMap.set(node.id, parent);
            node.children.forEach((child) => stack.push({ node: child, parent: node.id }));
          }
        };
        buildRemParentMap(ancestorTreesResult);
        buildRemParentMap(descendantTreesResult);

        const buildAttrParentMap = (attrs: AttributeNodeInfo[], parentNodeId: string, kind: 'property' | 'interface' | 'directProperty') => {
          attrs.forEach((p) => {
            const attrNodeId = attributeNodeId(kind, p.id);
            newParentMap.set(attrNodeId, parentNodeId);
            buildAttrParentMap(p.children, attrNodeId, kind);
          });
        };
        Object.entries(properties?.byOwner || {}).forEach(([ownerId, attrs]) => {
          buildAttrParentMap(attrs, ownerId, 'property');
        });
        Object.entries(interfaces?.byOwner || {}).forEach(([ownerId, attrs]) => {
          buildAttrParentMap(attrs, ownerId, 'interface');
        });
        Object.entries(directProperties?.byOwner || {}).forEach(([ownerId, attrs]) => {
          buildAttrParentMap(attrs, ownerId, 'directProperty');
        });
        setParentMap(newParentMap);

        // Build graph immediately with local values to avoid stale closure issue
        const primaryData = attributeType === 'property' ? properties : interfaces;
        const secondaryData = attributeType === 'property' ? directProperties : undefined;
        const primaryKind: 'property' | 'interface' | 'directProperty' = attributeType === 'property' ? 'property' : 'interface';
        const secondaryKind: 'property' | 'interface' | 'directProperty' | undefined = attributeType === 'property' ? 'directProperty' : undefined;
        
        const t4 = performance.now();
        const graph = await createGraphData(
          plugin,
          rem._id,
          centerLabel,
          rem.text,
          ancestorTreesResult,
          descendantTreesResult,
          collapsed,
          primaryData ?? undefined,
          hidden,
          new Set<string>(),
          nodePositionsRef.current,
          primaryKind,
          secondaryData ?? undefined,
          secondaryKind,
          loadComputationContextRef.current,
          timeoutSignal
        );
        console.log(`[perf] phase 5 createGraphData: ${(performance.now() - t4).toFixed(0)}ms | nodes=${graph.nodes.length} edges=${graph.edges.length}`);
        const t5 = performance.now();
        const updatedEdges = await addMissingRemEdges(
          plugin,
          graph.nodes,
          graph.edges,
          loadComputationContextRef.current.childToParentsMap,
          loadComputationContextRef.current
        );
        console.log(`[perf] phase 6 addMissingRemEdges: ${(performance.now() - t5).toFixed(0)}ms | edges=${updatedEdges.length}`);
        
        console.log(`[perf] TOTAL loadHierarchy: ${(performance.now() - tLoad).toFixed(0)}ms | rem="${centerLabel}" rems=${remsForAttributes.length}`);

        // Check if timeout occurred and set partial load flag
        if (timeoutSignal.timedOut) {
          setIsPartialLoad(true);
          console.log('[loadHierarchy] Timeout occurred - showing partial results');
        }
        
        setNodes(graph.nodes);
        storePositions(graph.nodes);
        setEdges(updatedEdges);
      } catch (err) {
        console.error(err);
        setError("Failed to build inheritance hierarchy.");
      } finally {
        setLoading(false);
      }
    },
    [plugin, storePositions, attributeType]
  );

  // Load saved state on mount - must be after loadHierarchy is defined
  useEffect(() => {
    let cancelled = false;

    async function restoreState() {
      const savedState = await loadMindMapState(plugin);
      if (cancelled) return;

      if (savedState && savedState.loadedRemId) {
        // Restore user preferences
        setAttributeType(savedState.attributeType || 'property');
        setHistoryStack(savedState.historyStack || []);

        // Verify the rem still exists before trying to load
        const rem = await plugin.rem.findOne(savedState.loadedRemId);
        if (cancelled) return;

        if (rem) {
          // Delegate to loadHierarchy which has timeout support
          await loadHierarchy(rem._id);
        }
      }

      if (!cancelled) {
        setIsInitialized(true);
      }
    }

    restoreState();
    return () => {
      cancelled = true;
    };
  }, [plugin, loadHierarchy]);

  useEffect(() => {
    if (loadedRemId && !loading) {
      updateGraph();
    }
  }, [loadedRemId, ancestorTrees, descendantTrees, propertyData, interfaceData, collapsedNodes, hiddenAttributes, loading, updateGraph]);

  // Subtree-aware drag propagation without double-applying deltas
  const handleNodesChange = useCallback((changes) => {
    setNodes((current) => {
      const updated = applyNodeChanges(changes, current);
      const prevById = new Map(current.map((n) => [n.id, n]));
      const deltas = new Map<string, { dx: number; dy: number }>();

      // Per-node direct deltas from this change
      for (const n of updated) {
        const prev = prevById.get(n.id);
        if (!prev) continue;
        const dx = (n.position?.x ?? 0) - (prev.position?.x ?? 0);
        const dy = (n.position?.y ?? 0) - (prev.position?.y ?? 0);
        if (dx || dy) deltas.set(n.id, { dx, dy });
      }
      if (deltas.size === 0) {
        storePositions(updated);
        return updated;
      }

      // Ancestor-accumulated delta (from nodes that actually moved directly)
      const getAccumulatedDelta = (id: string): { dx: number; dy: number } | null => {
        let cur = id;
        let dx = 0, dy = 0;
        const seen = new Set<string>();
        while (parentMap.has(cur)) {
          cur = parentMap.get(cur)!;
          if (seen.has(cur)) break;
          seen.add(cur);
          const d = deltas.get(cur);
          if (d) { dx += d.dx; dy += d.dy; }
        }
        return (dx || dy) ? { dx, dy } : null;
      };

      // Build children map once
      const childrenMap = new Map<string, string[]>();
      parentMap.forEach((p, c) => {
        const list = childrenMap.get(p) ?? [];
        list.push(c);
        childrenMap.set(p, list);
      });

      // Hidden node store shifting
      const updatedIdSet = new Set(updated.map((n) => n.id));
      const shiftStoredIfHidden = (id: string, delta: { dx: number; dy: number }) => {
        if (updatedIdSet.has(id)) return; // visible => handled via rendering adjustments
        const prev = nodePositionsRef.current.get(id);
        if (prev) {
          nodePositionsRef.current.set(id, { x: prev.x + delta.dx, y: prev.y + delta.dy });
        }
      };

      // Compute "move roots": direct-move nodes with no ancestor that also directly moved
      const movedDirect = [...deltas.keys()];
      const hasMovedAncestor = (id: string) => {
        let cur = id;
        const seen = new Set<string>();
        while (parentMap.has(cur)) {
          cur = parentMap.get(cur)!;
          if (seen.has(cur)) break;
          seen.add(cur);
          if (deltas.has(cur)) return true;
        }
        return false;
      };
      const movedRoots = movedDirect.filter((id) => !hasMovedAncestor(id));

      // Propagate deltas to hidden descendants exactly once
      const shiftedHidden = new Set<string>();
      for (const rootId of movedRoots) {
        const delta = deltas.get(rootId)!;
        const stack = [...(childrenMap.get(rootId) ?? [])];
        while (stack.length) {
          const id = stack.pop()!;
          if (shiftedHidden.has(id)) continue;
          shiftedHidden.add(id);
          shiftStoredIfHidden(id, delta);
          const kids = childrenMap.get(id);
          if (kids?.length) stack.push(...kids);
        }
      }

      // Adjust visible nodes that inherit motion from any directly-moved ancestor
      let mutated = false;
      const adjusted = updated.map((node) => {
        // If this node was directly moved, ReactFlow already applied its delta
        if (deltas.has(node.id)) return node;

        // Sum deltas from moved ancestors (including owning REM for attributes via parentMap)
        const effective = getAccumulatedDelta(node.id);

        // Fallback: if an attribute somehow isn't in parentMap, inherit from its owner
        if (!effective) {
          const data = node.data as GraphNodeData | undefined;
          if (data && (data.kind === 'property' || data.kind === 'interface' || data.kind === 'directProperty')) {
            const attrData = data.kind === 'property' ? propertyData : data.kind === 'interface' ? interfaceData : directPropertyData;
            const ownerId = attrData?.byId?.[data.remId]?.ownerNodeId;
            if (ownerId) {
              const d = deltas.get(ownerId) ?? getAccumulatedDelta(ownerId);
              if (d) {
                mutated = true;
                return {
                  ...node,
                  position: { x: node.position.x + d.dx, y: node.position.y + d.dy },
                };
              }
            }
          }
          return node;
        }

        mutated = true;
        return {
          ...node,
          position: { x: node.position.x + effective.dx, y: node.position.y + effective.dy },
        };
      });

      // Persist final positions
      storePositions(mutated ? adjusted : updated);
      return mutated ? adjusted : updated;
    });
  }, [parentMap, propertyData, interfaceData, directPropertyData, storePositions]);


  const handleLoad = useCallback(async () => {
    // Fetch fresh focused rem to avoid stale closure issues
    const currentFocusedRem = await plugin.focus.getFocusedRem();
    const currentRemId = currentFocusedRem?._id;

    if (!currentRemId) {
      setError("Focus a rem before refreshing.");
      return;
    }

    if (loadedRemId && loadedRemId !== currentRemId) {
      setHistoryStack((prev) => [...prev, loadedRemId]);
    }

    nodePositionsRef.current = new Map();
    loadHierarchy(currentRemId);
  }, [plugin, loadedRemId, loadHierarchy]);



  const handleToggleAttributes = useCallback(async () => {
    if (!loadedRemId) {
      return;
    }
    // When attributeType is 'property', use both propertyData and directPropertyData
    const primaryData = attributeType === 'property' ? propertyData : interfaceData;
    const secondaryData = attributeType === 'property' ? directPropertyData : undefined;
    
    if (!primaryData) {
      return;
    }
    const oldHiddenSize = hiddenAttributes.size;
    const oldHiddenVirtualSize = hiddenVirtualAttributes.size;
    const allHidden = oldHiddenSize > 0 || oldHiddenVirtualSize > 0;
    
    if (!allHidden) {
      // Store offsets for regular attributes before hiding
      nodes.forEach((node) => {
        const data = node.data as GraphNodeData;
        // Check for both 'property' and 'directProperty' kinds when in property mode
        const isRelevantKind = attributeType === 'property' 
          ? (data?.kind === 'property' || data?.kind === 'directProperty')
          : data?.kind === attributeType;
        if (isRelevantKind) {
          const relevantData = data?.kind === 'directProperty' ? secondaryData : primaryData;
          const detail = relevantData?.byId[data.remId];
          if (detail) {
            const ownerNode = nodes.find((n) => n.id === detail.ownerNodeId);
            if (ownerNode) {
              const dx = node.position.x - ownerNode.position.x;
              const dy = node.position.y - ownerNode.position.y;
              hiddenAttributeOffsetsRef.current.set(data.remId, { dx, dy });
            }
          }
        }
      });
    }
    
    // Toggle regular attributes - combine IDs from both data sets when in property mode
    let allAttrIds = Object.keys(primaryData.byId);
    if (secondaryData) {
      allAttrIds = [...allAttrIds, ...Object.keys(secondaryData.byId)];
    }
    const nextHidden = !allHidden ? new Set(allAttrIds) : new Set<string>();
    
    // Toggle virtual attributes - collect all virtual attribute IDs from current nodes
    // For property mode, collect both virtualProperty and virtualDirectProperty
    const virtualKinds: GraphNodeData['kind'][] = attributeType === 'property' 
      ? ['virtualProperty', 'virtualDirectProperty']
      : ['virtualInterface'];
    const allVirtualIds = nodes
      .filter(node => {
        const data = node.data as GraphNodeData;
        return virtualKinds.includes(data.kind);
      })
      .map(node => node.id);
    
    // Also include any already-hidden virtual IDs
    const nextHiddenVirtual = !allHidden 
      ? new Set([...allVirtualIds, ...hiddenVirtualAttributes])
      : new Set<string>();
    
    const primaryKind: 'property' | 'interface' | 'directProperty' = attributeType === 'property' ? 'property' : 'interface';
    const secondaryKind: 'property' | 'interface' | 'directProperty' | undefined = attributeType === 'property' ? 'directProperty' : undefined;
    
    const graph = await createGraphData(
      plugin,
      loadedRemId,
      loadedRemName || "(Untitled Rem)",
      loadedRemRichText,
      ancestorTrees,
      descendantTrees,
      collapsedNodes,
      primaryData,
      nextHidden,
      nextHiddenVirtual,
      nodePositionsRef.current,
      primaryKind,
      secondaryData ?? undefined,
      secondaryKind,
      loadComputationContextRef.current
    );
    let displayNodes = graph.nodes;
    if (allHidden && nextHidden.size === 0) {
      displayNodes = graph.nodes.map((node) => {
        const data = node.data as GraphNodeData;
        // Check for both kinds when in property mode
        const isRelevantKind = attributeType === 'property'
          ? (data.kind === 'property' || data.kind === 'directProperty')
          : data.kind === attributeType;
        if (!isRelevantKind) {
          return node;
        }
        const relevantData = data.kind === 'directProperty' ? secondaryData : primaryData;
        const detail = relevantData?.byId[data.remId];
        if (!detail) {
          return node;
        }
        const ownerNode = graph.nodes.find((n) => n.id === detail.ownerNodeId);
        if (!ownerNode) {
          return node;
        }
        const storedOffset = hiddenAttributeOffsetsRef.current.get(data.remId);
        if (storedOffset) {
          const newPos = {
            x: ownerNode.position.x + storedOffset.dx,
            y: ownerNode.position.y + storedOffset.dy,
          };
          return {
            ...node,
            position: newPos,
          };
        }
        return node;
      });
    }
    const updatedEdges = await addMissingRemEdges(
      plugin,
      displayNodes,
      graph.edges,
      loadComputationContextRef.current.childToParentsMap,
      loadComputationContextRef.current
    );
    setHiddenAttributes(nextHidden);
    setHiddenVirtualAttributes(nextHiddenVirtual);
    setNodes(displayNodes);
    storePositions(displayNodes);
    setEdges(updatedEdges);
  }, [
    attributeType,
    propertyData,
    interfaceData,
    directPropertyData,
    hiddenAttributes,
    hiddenVirtualAttributes,
    loadedRemId,
    loadedRemName,
    ancestorTrees,
    descendantTrees,
    collapsedNodes,
    nodes,
    plugin,
    storePositions
  ]);

  const handleSwitchAttributes = useCallback(async (newType: 'property' | 'interface') => {
    if (!loadedRemId) {
      return;
    }
    if (newType === attributeType) {
      return; // No change needed
    }
    const oldType = attributeType;
    // Get old data (both primary and secondary when in property mode)
    const oldPrimaryData = oldType === 'property' ? propertyData : interfaceData;
    const oldSecondaryData = oldType === 'property' ? directPropertyData : undefined;
    
    if (hiddenAttributes.size === 0 && oldPrimaryData) {
      nodes.forEach((node) => {
        const data = node.data as GraphNodeData;
        // Check for both kinds when in property mode
        const isRelevantKind = oldType === 'property'
          ? (data?.kind === 'property' || data?.kind === 'directProperty')
          : data?.kind === oldType;
        if (isRelevantKind) {
          const relevantData = data?.kind === 'directProperty' ? oldSecondaryData : oldPrimaryData;
          const detail = relevantData?.byId[data.remId];
          if (detail) {
            const ownerNode = nodes.find((n) => n.id === detail.ownerNodeId);
            if (ownerNode) {
              const dx = node.position.x - ownerNode.position.x;
              const dy = node.position.y - ownerNode.position.y;
              hiddenAttributeOffsetsRef.current.set(data.remId, { dx, dy });
            }
          }
        }
      });
    }
    setAttributeType(newType);
    const nextHidden = new Set<string>();
    const nextHiddenVirtual = new Set<string>();
    setHiddenAttributes(nextHidden);
    setHiddenVirtualAttributes(nextHiddenVirtual);
    
    // Get new data — may be null if this mode hasn't been loaded yet (lazy loading)
    let newPrimaryData: AttributeData | null = newType === 'property' ? propertyData : interfaceData;
    let newSecondaryData: AttributeData | null | undefined = newType === 'property' ? directPropertyData : undefined;
    const primaryKind: 'property' | 'interface' | 'directProperty' = newType === 'property' ? 'property' : 'interface';
    const secondaryKind: 'property' | 'interface' | 'directProperty' | undefined = newType === 'property' ? 'directProperty' : undefined;

    // If the target mode's data was deferred at initial load, fetch it now
    let collapsedForGraph = collapsedNodes;
    if (!newPrimaryData) {
      const rem = await findRemCached(plugin, loadedRemId, loadComputationContextRef.current);
      if (!rem) return;
      const remsForAttributes = collectRemsForProperties(rem, ancestorTrees, descendantTrees);
      const childToParentsMap = loadComputationContextRef.current.childToParentsMap ?? {};
      const newCollapsed = new Set(collapsedNodes);

      if (newType === 'property') {
        const propertiesRaw = await buildAttributeData(plugin, remsForAttributes, true, undefined, undefined, undefined, loadComputationContextRef.current);
        const { regularInterfaces: propertiesSplit, directProperties: dp } = splitInterfaceData(propertiesRaw);
        newPrimaryData = propertiesSplit;
        newSecondaryData = dp;
        const virtualProp = buildVirtualAttributeData(newPrimaryData, rem._id, ancestorTrees, descendantTrees, 'property', childToParentsMap, new Set([rem._id]));
        loadComputationContextRef.current.virtualDataByKind.property = virtualProp;
        const virtualDp = buildVirtualAttributeData(dp, rem._id, ancestorTrees, descendantTrees, 'directProperty', childToParentsMap, new Set([rem._id]));
        loadComputationContextRef.current.virtualDataByKind.directProperty = virtualDp;
        makeDefaultView(newCollapsed, ancestorTrees, descendantTrees, [
          newPrimaryData.byOwner,
          dp.byOwner,
          virtualProp.byOwner,
          virtualDp.byOwner,
        ]);
        setPropertyData(newPrimaryData);
        setDirectPropertyData(dp);
      } else {
        const hierarchyRemIds = buildHierarchyRemIdSet(loadedRemId, ancestorTrees, descendantTrees);
        const interfacesRaw = await buildAttributeData(plugin, remsForAttributes, false, undefined, undefined, hierarchyRemIds, loadComputationContextRef.current);
        const { regularInterfaces: interfacesUnfiltered, directProperties: dp } = splitInterfaceData(interfacesRaw);
        newPrimaryData = filterExportedInterfaces(interfacesUnfiltered);
        const virtualIface = buildVirtualAttributeData(newPrimaryData, rem._id, ancestorTrees, descendantTrees, 'interface', childToParentsMap, new Set([rem._id]));
        loadComputationContextRef.current.virtualDataByKind.interface = virtualIface;
        makeDefaultView(newCollapsed, ancestorTrees, descendantTrees, [
          newPrimaryData.byOwner,
          virtualIface.byOwner,
        ]);
        setInterfaceData(newPrimaryData);
        setDirectPropertyData(dp);
      }

      collapsedForGraph = newCollapsed;
      setCollapsedNodes(newCollapsed);
    }

    if (!newPrimaryData) return;
    const graph = await createGraphData(
      plugin,
      loadedRemId,
      loadedRemName || "(Untitled Rem)",
      loadedRemRichText,
      ancestorTrees,
      descendantTrees,
      collapsedForGraph,
      newPrimaryData,
      nextHidden,
      nextHiddenVirtual,
      nodePositionsRef.current,
      primaryKind,
      newSecondaryData ?? undefined,
      secondaryKind,
      loadComputationContextRef.current
    );
    const displayNodes = graph.nodes.map((node) => {
      const data = node.data as GraphNodeData;
      // Check for both kinds when in property mode
      const isRelevantKind = newType === 'property'
        ? (data.kind === 'property' || data.kind === 'directProperty')
        : data.kind === newType;
      if (!isRelevantKind) {
        return node;
      }
      const relevantData = data.kind === 'directProperty' ? newSecondaryData : newPrimaryData;
      const detail = relevantData?.byId[data.remId];
      if (!detail) {
        return node;
      }
      const ownerNode = graph.nodes.find((n) => n.id === detail.ownerNodeId);
      if (!ownerNode) {
        return node;
      }
      const storedOffset = hiddenAttributeOffsetsRef.current.get(data.remId);
      if (storedOffset) {
        const newPos = {
          x: ownerNode.position.x + storedOffset.dx,
          y: ownerNode.position.y + storedOffset.dy,
        };
        return {
          ...node,
          position: newPos,
        };
      }
      return node;
    });
    const updatedEdges = await addMissingRemEdges(
      plugin,
      displayNodes,
      graph.edges,
      loadComputationContextRef.current.childToParentsMap,
      loadComputationContextRef.current
    );
    setNodes(displayNodes);
    storePositions(displayNodes);
    setEdges(updatedEdges);
  }, [
    attributeType,
    propertyData,
    interfaceData,
    directPropertyData,
    hiddenAttributes,
    loadedRemId,
    loadedRemName,
    ancestorTrees,
    descendantTrees,
    collapsedNodes,
    nodes,
    plugin,
    storePositions
  ]);

  const handleToggleCollapseAll = useCallback(async () => {
    if (!loadedRemId) return;

    // Only collect IDs of REM nodes that have children
    const collectIdsWithChildren = (trees: HierarchyNode[]): string[] => {
      const ids: string[] = [];
      for (const node of trees) {
        // Only add this node if it has children
        if (node.children && node.children.length > 0) {
          ids.push(node.id);
        }
        // Recursively check children
        ids.push(...collectIdsWithChildren(node.children));
      }
      return ids;
    };

    // When in property mode, consider both propertyData and directPropertyData for collapsing
    const primaryData = attributeType === 'property' ? propertyData : interfaceData;
    const secondaryData = attributeType === 'property' ? directPropertyData : undefined;

    if (collapsedNodes.size > 0) {
      // Expand all: clear collapsed nodes
      setCollapsedNodes(new Set<string>());
    } else {
      // Collapse all: add only REM nodes that have children, and attribute nodes with children
      const allIds = new Set<string>([
        ...collectIdsWithChildren(ancestorTrees),
        ...collectIdsWithChildren(descendantTrees),
      ]);
      makeDefaultView(allIds, ancestorTrees, descendantTrees, [
        primaryData?.byOwner,
        secondaryData?.byOwner,
        loadComputationContextRef.current.virtualDataByKind.property?.byOwner,
        loadComputationContextRef.current.virtualDataByKind.directProperty?.byOwner,
        loadComputationContextRef.current.virtualDataByKind.interface?.byOwner,
      ]);
      setCollapsedNodes(allIds);
    }
    // Note: updateGraph() is called automatically by the useEffect that depends on collapsedNodes
  }, [
    ancestorTrees,
    descendantTrees,
    collapsedNodes,
    loadedRemId,
    propertyData,
    interfaceData,
    attributeType,
  ]);

  const handleNodeClick = useCallback(
    (event: React.MouseEvent, node: GraphNode) => {
      event.preventDefault();
      event.stopPropagation();
      if (!loadedRemId) return;

      const data = (node.data ?? undefined) as GraphNodeData | undefined;
      const targetId = data?.remId ?? node.id;

      // Center node: toggle collapse to hide/show all ancestors and descendants
      if (targetId === loadedRemId) {
        const hasHierarchy = ancestorTrees.length > 0 || descendantTrees.length > 0;
        if (!hasHierarchy) return;
        const next = new Set(collapsedNodes);
        next.has(loadedRemId) ? next.delete(loadedRemId) : next.add(loadedRemId);
        setCollapsedNodes(next);
        return;
      }

      // Helpers
      const collectIds = (trees: HierarchyNode[]) => {
        const ids: string[] = [];
        const stack = [...trees];
        while (stack.length) {
          const n = stack.pop()!;
          ids.push(n.id);
          if (n.children?.length) stack.push(...n.children);
        }
        return ids;
      };
      const collectSubtreeIds = (root: HierarchyNode) => {
        const ids: string[] = [];
        const stack = [root];
        while (stack.length) {
          const n = stack.pop()!;
          ids.push(n.id);
          if (n.children?.length) stack.push(...n.children);
        }
        return ids;
      };

      // REM nodes: default = per-node toggle; Shift = rest-of-side
      if (!data || data.kind === "rem") {
        // Center node special-case unchanged
        if (targetId === loadedRemId) {
          // const collectImmediateChildren = (trees: HierarchyNode[]): string[] => {
          //   const ids: string[] = [];
          //   for (const tree of trees) {
          //     ids.push(tree.id);
          //     ids.push(...tree.children.map((c) => c.id));
          //   }
          //   return ids;
          // };
          // const immediateDescendantIds = collectImmediateChildren(descendantTrees);
          // setCollapsedNodes(new Set(immediateDescendantIds));
          return;
        }

        // Default: per-node toggle
        const t = findNodeById(ancestorTrees, targetId) ?? findNodeById(descendantTrees, targetId);
        const hasChildren = !!t?.children?.length;
        if (!hasChildren) return;
        const next = new Set(collapsedNodes);
        next.has(targetId) ? next.delete(targetId) : next.add(targetId);
        setCollapsedNodes(next);
        return;
      }

      // Attribute nodes: toggle based on the display tree, not byId.hasChildren
      let hasChildren = false;
      if (data?.kind === "property" || data?.kind === "interface" || data?.kind === "directProperty") {
        const currentData = data.kind === "property" ? propertyData : data.kind === "interface" ? interfaceData : directPropertyData;
        hasChildren = !!findInAttributeForest(currentData?.byOwner, targetId)?.children?.length;
      } else if (data?.kind === "virtualInterfaceGroup") {
        // Group header nodes are always collapsible (they always have children)
        const groupNodeId = data.remId;
        const next = new Set(collapsedNodes);
        next.has(groupNodeId) ? next.delete(groupNodeId) : next.add(groupNodeId);
        setCollapsedNodes(next);
        return;
      } else if (data?.kind === "virtualProperty" || data?.kind === "virtualInterface" || data?.kind === "virtualDirectProperty") {
        const virtualKind = data.kind === "virtualProperty" ? "property" : data.kind === "virtualInterface" ? "interface" : "directProperty";
        const virtualForest = loadComputationContextRef.current.virtualDataByKind[virtualKind]?.byOwner;
        hasChildren = !!findInAttributeForest(virtualForest, data.remId)?.children?.length;
        if (!hasChildren) {
          const sourceData = virtualKind === "property" ? propertyData : virtualKind === "interface" ? interfaceData : directPropertyData;
          hasChildren = !!findInAttributeForest(sourceData?.byOwner, data.sourcePropertyId ?? "")?.children?.length;
        }
        // Toggle collapsed state using the virtual attribute's own ID (info.id format)
        if (!hasChildren) return;
        const virtualNodeId = data.remId; // This is the virtual:ownerRemId:sourcePropertyId format
        const next = new Set(collapsedNodes);
        next.has(virtualNodeId) ? next.delete(virtualNodeId) : next.add(virtualNodeId);
        setCollapsedNodes(next);
        return;
      } else {
        const t = findNodeById(ancestorTrees, targetId) ?? findNodeById(descendantTrees, targetId);
        hasChildren = !!t?.children?.length;
      }
      if (!hasChildren) return;

      const next = new Set(collapsedNodes);
      next.has(targetId) ? next.delete(targetId) : next.add(targetId);
      setCollapsedNodes(next);
    },
    [loadedRemId, ancestorTrees, descendantTrees, collapsedNodes, propertyData, interfaceData, directPropertyData]
  );

  const handleContextMenuClose = useCallback(() => {
    setContextMenu(null);
    setVirtualContextMenu(null);
    setGroupContextMenu(null);
    setPaneContextMenu(null);
  }, []);

  const handleOpenContextRem = useCallback(async () => {
    if (!contextMenu?.remId) return;
    const rem = (await plugin.rem.findOne(contextMenu.remId)) as PluginRem | null;
    if (rem) {
      void plugin.window.openRem(rem);
    }
    handleContextMenuClose();
  }, [contextMenu, plugin, handleContextMenuClose]);

  const handleCopyContextRem = useCallback(async () => {
    if (!contextMenu?.remId) return;
    const rem = (await plugin.rem.findOne(contextMenu.remId)) as PluginRem | null;
    if (rem) {
      await rem.copyReferenceToClipboard();
    }
    handleContextMenuClose();
  }, [contextMenu, plugin, handleContextMenuClose]);

  const handleCopyDebugInfo = useCallback(async () => {
    if (!contextMenu?.remId) return;
    const rem = (await plugin.rem.findOne(contextMenu.remId)) as PluginRem | null;
    if (!rem) {
      handleContextMenuClose();
      return;
    }
    
    try {
      // Gather all Rem information (similar to remInfo_widget)
      const remName = await getRemText(plugin, rem);
      const remType = await rem.getType();
      
      // Fetch data with individual error handling
      let parentClass: PluginRem[] = [];
      let lineage: string[] = [];
      let properties: PluginRem[] = [];
      let descriptors: PluginRem[] = [];
      let tags: PluginRem[] = [];
      let taggedRems: PluginRem[] = [];
      let ancestorTags: PluginRem[] = [];
      let descendantTags: PluginRem[] = [];
      let referencingRems: PluginRem[] = [];
      let referencedRems: PluginRem[] = [];
      let deepReferencedRems: PluginRem[] = [];

      try { parentClass = await getParentClass(plugin, rem) || []; } catch {}
      try { lineage = await getAncestorLineageStrings(plugin, rem) || []; } catch {}
      try { properties = await getClassProperties(plugin, rem) || []; } catch {}
      try { descriptors = await getClassDescriptors(plugin, rem) || []; } catch {}
      try { tags = await rem.getTagRems() || []; } catch {}
      try { taggedRems = await rem.taggedRem() || []; } catch {}
      try { ancestorTags = await rem.ancestorTagRem() || []; } catch {}
      try { descendantTags = await rem.descendantTagRem() || []; } catch {}
      try { referencingRems = await rem.remsReferencingThis() || []; } catch {}
      try { referencedRems = await rem.remsBeingReferenced() || []; } catch {}
      try { deepReferencedRems = await rem.deepRemsBeingReferenced() || []; } catch {}

      // Helper to format Rem array as text list
      const formatRemList = async (rems: PluginRem[] | null): Promise<string> => {
        if (!rems || rems.length === 0) return "(none)";
        const names = await Promise.all(rems.map(async r => {
          try { return await getRemText(plugin, r); } catch { return r._id; }
        }));
        return names.join(", ");
      };

      // Build debug text
      const debugLines: string[] = [
        "=== Rem Debug Info ===",
        `ID: ${rem._id}`,
        `Name: ${remName}`,
        `Type: ${remType}`,
        "",
        `Parent Types: ${await formatRemList(parentClass)}`,
        `Ancestor Lineage: ${lineage.length > 0 ? lineage.join(" | ") : "(none)"}`,
        `Properties: ${await formatRemList(properties)}`,
        `Descriptors: ${await formatRemList(descriptors)}`,
        `Tags: ${await formatRemList(tags)}`,
        `Tagged Rems: ${await formatRemList(taggedRems)}`,
        `Ancestor Tags: ${await formatRemList(ancestorTags)}`,
        `Descendant Tags: ${await formatRemList(descendantTags)}`,
        `Rems Referencing This: ${await formatRemList(referencingRems)}`,
        `Rems Being Referenced: ${await formatRemList(referencedRems)}`,
        `Deep Rems Being Referenced: ${await formatRemList(deepReferencedRems)}`
      ];

      const debugText = debugLines.join("\n");

      // Copy to clipboard using fallback method (more reliable in iframe contexts)
      const textArea = document.createElement('textarea');
      textArea.value = debugText;
      textArea.style.position = 'fixed';
      textArea.style.left = '-9999px';
      textArea.style.top = '0';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      
      const success = document.execCommand('copy');
      document.body.removeChild(textArea);
      
      if (success) {
        await plugin.app.toast("Debug info copied to clipboard!");
      } else {
        // Try navigator.clipboard as fallback
        try {
          await navigator.clipboard.writeText(debugText);
          await plugin.app.toast("Debug info copied to clipboard!");
        } catch {
          console.log("Debug info (copy failed):", debugText);
          await plugin.app.toast("Copy failed - check console for debug info");
        }
      }
    } catch (error) {
      console.error("Error copying debug info:", error);
      await plugin.app.toast("Failed to copy debug info: " + String(error));
    }
    
    handleContextMenuClose();
  }, [contextMenu, plugin, handleContextMenuClose]);

  const handleEditVirtualRem = useCallback(async () => {
    if (!virtualContextMenu?.sourcePropertyId) return;
    const rem = (await plugin.rem.findOne(virtualContextMenu.sourcePropertyId)) as PluginRem | null;
    if (rem) {
      void plugin.window.openRem(rem);
    }
    handleContextMenuClose();
  }, [virtualContextMenu, plugin, handleContextMenuClose]);

  const handleImplementVirtualProperty = useCallback(async () => {
    if (!virtualContextMenu) return;
    
    try {
      // Determine if this is a property or interface based on the clicked node
      const clickedNode = nodes.find(n => n.id === virtualContextMenu.nodeId);
      const nodeData = clickedNode?.data as GraphNodeData | undefined;
      const isProperty = nodeData?.kind === 'virtualProperty';
      
      // Get the owner REM and source property/interface
      const ownerRem = await plugin.rem.findOne(virtualContextMenu.ownerRemId);
      const sourceProperty = await plugin.rem.findOne(virtualContextMenu.sourcePropertyId);
      
      if (!ownerRem || !sourceProperty) {
        setError("Could not find required REMs");
        handleContextMenuClose();
        return;
      }
      
      if (isProperty) {
        // For virtual properties: Create new child REM with same name and extends relationship
        const newRem = await plugin.rem.createRem();
        if (!newRem) {
          setError("Failed to create new REM");
          handleContextMenuClose();
          return;
        }
        
        // Set the text to match the source property
        const sourceText = sourceProperty.text;
        if (sourceText) {
          await newRem.setText(sourceText);
        }
        
        // Set parent to owner REM
        await newRem.setParent(ownerRem);
        
        // Make it a document for properties
        await newRem.setIsDocument(true);
        
        // Create extends relationship to source property
        // This requires creating an "extends" descriptor child
        const extendsDesc = await plugin.rem.createRem();
        if (extendsDesc) {
          await extendsDesc.setText(["extends"]);
          await extendsDesc.setParent(newRem);
          await extendsDesc.setType(SetRemType.DESCRIPTOR);
          
          // Add reference to source property
          const refChild = await plugin.rem.createRem();
          if (refChild) {
            await refChild.setText([{ i: "q", _id: sourceProperty._id }]);
            await refChild.setParent(extendsDesc);
          }
        }
        
        // Update descendant properties that extend the same source property
        // to now extend this newly created property instead.
        const updatedCount = await updateDescendantPropertyReferences(plugin, newRem, ownerRem, sourceProperty);
        
        // Show toast message if any descendant properties were updated
        if (updatedCount > 0) {
          await plugin.app.toast(
            `Updated ${updatedCount} descendant ${updatedCount === 1 ? 'property' : 'properties'} to extend the new property.`
          );
        }
      } else {
        // For virtual interfaces: Create new child REM with same name and extends relationship
        // (similar to virtual properties implementation)
        const newRem = await plugin.rem.createRem();
        if (!newRem) {
          setError("Failed to create new REM");
          handleContextMenuClose();
          return;
        }
        
        // Set the text to match the source interface
        const sourceText = sourceProperty.text;
        if (sourceText) {
          await newRem.setText(sourceText);
        }
        
        // Set parent to owner REM
        await newRem.setParent(ownerRem);
        
        // If this is a direct property (descriptor), set the new rem as a descriptor
        if (nodeData?.isDescriptorProperty) {
          await newRem.setType(SetRemType.DESCRIPTOR);
        }
        
        // Create extends relationship to source interface
        // This requires creating an "extends" descriptor child
        const extendsDesc = await plugin.rem.createRem();
        if (extendsDesc) {
          await extendsDesc.setText(["extends"]);
          await extendsDesc.setParent(newRem);
          await extendsDesc.setType(SetRemType.DESCRIPTOR);
          
          // Add reference to source interface
          const refChild = await plugin.rem.createRem();
          if (refChild) {
            await refChild.setText([{ i: "q", _id: sourceProperty._id }]);
            await refChild.setParent(extendsDesc);
          }
        }
        
        // If source interface is exported, also export the new implementation
        // This ensures the inheritance chain properly propagates export requirements
        //const sourceIsExported = await hasTag(plugin, sourceProperty, "Export");
        //if (sourceIsExported) {
        //  const exportTag = await getTag(plugin, sourceProperty, "Export");
        //  if (exportTag) {
        //    await newRem.addTag(exportTag);
        //  }
        //}
        
        // Update descendant interfaces that extend the same source interface
        // to now extend this newly created interface instead.
        const updatedCount = await updateDescendantInterfaceReferences(plugin, newRem, ownerRem, sourceProperty);
        
        // Show toast message if any descendant interfaces were updated
        if (updatedCount > 0) {
          await plugin.app.toast(
            `Updated ${updatedCount} descendant ${updatedCount === 1 ? 'interface' : 'interfaces'} to extend the new interface.`
          );
        }
      }
      
      // Reload the hierarchy to reflect changes
      if (loadedRemId) {
        await loadHierarchy(loadedRemId);
      }
    } catch (err) {
      console.error("Failed to implement:", err);
      setError("Failed to implement");
    }
    
    handleContextMenuClose();
  }, [virtualContextMenu, plugin, loadHierarchy, loadedRemId, handleContextMenuClose, nodes]);

  const handleImplementAllGroup = useCallback(async () => {
    if (!groupContextMenu) return;

    const { nodeId, ownerRemId, label } = groupContextMenu;
    const isInterfaceGroup = nodeId.startsWith('vgroup:');
    const childEdgePrefix = isInterfaceGroup
      ? `vgroup-child:${nodeId}->`
      : `vpropgroup-child:${nodeId}->`;

    // Collect child virtual node data from edges
    const childItems: { sourcePropertyId: string; kind: GraphNodeData['kind']; isDescriptorProperty?: boolean }[] = [];
    for (const edge of edges) {
      if (!edge.id.startsWith(childEdgePrefix)) continue;
      const childNode = nodes.find(n => n.id === edge.target);
      const nodeData = childNode?.data as GraphNodeData | undefined;
      if (!nodeData?.sourcePropertyId) continue;
      childItems.push({
        sourcePropertyId: nodeData.sourcePropertyId,
        kind: nodeData.kind,
        isDescriptorProperty: nodeData.isDescriptorProperty,
      });
    }

    if (childItems.length === 0) {
      handleContextMenuClose();
      return;
    }

    try {
      const ownerRem = await plugin.rem.findOne(ownerRemId);
      if (!ownerRem) {
        setError("Could not find owner REM");
        handleContextMenuClose();
        return;
      }

      // Determine type from first child
      const firstKind = childItems[0].kind;
      const isProperty = firstKind === 'virtualProperty';
      const isDescriptorProperty = childItems[0].isDescriptorProperty;

      // Create one new REM named after the group
      const newRem = await plugin.rem.createRem();
      if (!newRem) {
        setError("Failed to create new REM");
        handleContextMenuClose();
        return;
      }

      await newRem.setText([label]);
      await newRem.setParent(ownerRem);

      if (isProperty) {
        await newRem.setIsDocument(true);
      } else if (isDescriptorProperty) {
        await newRem.setType(SetRemType.DESCRIPTOR);
      }

      // Create one extends descriptor with one reference child per grouped source
      const extendsDesc = await plugin.rem.createRem();
      if (extendsDesc) {
        await extendsDesc.setText(["extends"]);
        await extendsDesc.setParent(newRem);
        await extendsDesc.setType(SetRemType.DESCRIPTOR);

        for (const item of childItems) {
          const refChild = await plugin.rem.createRem();
          if (refChild) {
            await refChild.setText([{ i: "q", _id: item.sourcePropertyId }]);
            await refChild.setParent(extendsDesc);
          }
        }
      }

      // Update descendants that extend any of the grouped source properties
      let totalUpdated = 0;
      for (const item of childItems) {
        const sourceProperty = await plugin.rem.findOne(item.sourcePropertyId);
        if (!sourceProperty) continue;
        const updatedCount = isProperty
          ? await updateDescendantPropertyReferences(plugin, newRem, ownerRem, sourceProperty)
          : await updateDescendantInterfaceReferences(plugin, newRem, ownerRem, sourceProperty);
        totalUpdated += updatedCount;
      }

      let msg = `Implemented group "${label}".`;
      if (totalUpdated > 0) {
        const descWord = totalUpdated === 1 ? 'descendant' : 'descendants';
        msg += ` Updated ${totalUpdated} ${descWord}.`;
      }
      await plugin.app.toast(msg);

      if (loadedRemId) {
        await loadHierarchy(loadedRemId);
      }
    } catch (err) {
      console.error("Failed to implement all:", err);
      setError("Failed to implement all");
    }

    handleContextMenuClose();
  }, [groupContextMenu, plugin, loadHierarchy, loadedRemId, handleContextMenuClose, nodes, edges]);

  const collectAttributeIds = useCallback((attrs: AttributeNodeInfo[]): string[] => {
    const ids: string[] = [];
    for (const attr of attrs) {
      ids.push(attr.id);
      ids.push(...collectAttributeIds(attr.children));
    }
    return ids;
  }, []);

  // Collect virtual attribute IDs for a given REM from the current nodes (for hiding)
  const collectVirtualAttributeIdsFromNodes = useCallback((remId: string): string[] => {
    return nodes
      .filter(node => {
        const data = node.data as GraphNodeData;
        return (data.kind === 'virtualProperty' || data.kind === 'virtualInterface') && data.ownerRemId === remId;
      })
      .map(node => node.id);
  }, [nodes]);

  // Collect hidden virtual attribute IDs for a given REM from hiddenVirtualAttributes set (for showing)
  const collectHiddenVirtualAttributeIds = useCallback((remId: string): string[] => {
    const prefix = `virtual:${remId}:`;
    return [...hiddenVirtualAttributes].filter(id => id.startsWith(prefix));
  }, [hiddenVirtualAttributes]);

  const handleHideProperties = useCallback(async () => {
    if (!contextMenu?.remId || !propertyData) return;
    const attrs = propertyData.byOwner[contextMenu.remId];
    const idsToToggle = attrs ? collectAttributeIds(attrs) : [];
    
    // Collect virtual property IDs - from nodes if visible, from hiddenVirtualAttributes if hidden
    const visibleVirtualIds = collectVirtualAttributeIdsFromNodes(contextMenu.remId);
    const hiddenVirtualIds = collectHiddenVirtualAttributeIds(contextMenu.remId);
    const allVirtualIds = [...new Set([...visibleVirtualIds, ...hiddenVirtualIds])];
    
    const allRegularHidden = idsToToggle.length === 0 || idsToToggle.every(id => hiddenAttributes.has(id));
    const allVirtualHidden = allVirtualIds.length === 0 || allVirtualIds.every(id => hiddenVirtualAttributes.has(id));
    const allHidden = allRegularHidden && allVirtualHidden;
    
    const nextHidden: Set<string> = new Set(hiddenAttributes);
    const nextHiddenVirtual: Set<string> = new Set(hiddenVirtualAttributes);
    
    if (allHidden) {
      // Show them: remove from hidden
      idsToToggle.forEach(id => nextHidden.delete(id));
      allVirtualIds.forEach(id => nextHiddenVirtual.delete(id));
    } else {
      // Hide them: add to hidden
      idsToToggle.forEach(id => nextHidden.add(id));
      allVirtualIds.forEach(id => nextHiddenVirtual.add(id));
    }
    const graph = await createGraphData(
      plugin,
      loadedRemId,
      loadedRemName || "(Untitled Rem)",
      loadedRemRichText,
      ancestorTrees,
      descendantTrees,
      collapsedNodes,
      propertyData,
      nextHidden,
      nextHiddenVirtual,
      nodePositionsRef.current,
      'property',
      undefined,
      undefined,
      loadComputationContextRef.current
    );
    const updatedEdges = await addMissingRemEdges(
      plugin,
      graph.nodes,
      graph.edges,
      loadComputationContextRef.current.childToParentsMap,
      loadComputationContextRef.current
    );
    setHiddenAttributes(nextHidden);
    setHiddenVirtualAttributes(nextHiddenVirtual);
    setNodes(graph.nodes);
    storePositions(graph.nodes);
    setEdges(updatedEdges);
    handleContextMenuClose();
  }, [
    contextMenu,
    propertyData,
    hiddenAttributes,
    hiddenVirtualAttributes,
    loadedRemId,
    loadedRemName,
    ancestorTrees,
    descendantTrees,
    collapsedNodes,
    plugin,
    storePositions,
    collectAttributeIds,
    collectVirtualAttributeIdsFromNodes,
    collectHiddenVirtualAttributeIds,
    handleContextMenuClose
  ]);

  const handleHideVirtualProperties = useCallback(async () => {
    if (!contextMenu?.remId || !propertyData) return;
    
    // Collect virtual property IDs - from nodes if visible, from hiddenVirtualAttributes if hidden
    const visibleVirtualIds = collectVirtualAttributeIdsFromNodes(contextMenu.remId);
    const hiddenVirtualIds = collectHiddenVirtualAttributeIds(contextMenu.remId);
    const allVirtualIds = [...new Set([...visibleVirtualIds, ...hiddenVirtualIds])];
    
    if (allVirtualIds.length === 0) {
      handleContextMenuClose();
      return;
    }
    
    const allHidden = allVirtualIds.every(id => hiddenVirtualAttributes.has(id));
    const nextHiddenVirtual: Set<string> = new Set(hiddenVirtualAttributes);
    
    if (allHidden) {
      // Show them: remove from hidden
      allVirtualIds.forEach(id => nextHiddenVirtual.delete(id));
    } else {
      // Hide them: add to hidden
      allVirtualIds.forEach(id => nextHiddenVirtual.add(id));
    }
    const graph = await createGraphData(
      plugin,
      loadedRemId,
      loadedRemName || "(Untitled Rem)",
      loadedRemRichText,
      ancestorTrees,
      descendantTrees,
      collapsedNodes,
      propertyData,
      hiddenAttributes,
      nextHiddenVirtual,
      nodePositionsRef.current,
      'property',
      undefined,
      undefined,
      loadComputationContextRef.current
    );
    const updatedEdges = await addMissingRemEdges(
      plugin,
      graph.nodes,
      graph.edges,
      loadComputationContextRef.current.childToParentsMap,
      loadComputationContextRef.current
    );
    setHiddenVirtualAttributes(nextHiddenVirtual);
    setNodes(graph.nodes);
    storePositions(graph.nodes);
    setEdges(updatedEdges);
    handleContextMenuClose();
  }, [
    contextMenu,
    propertyData,
    hiddenAttributes,
    hiddenVirtualAttributes,
    loadedRemId,
    loadedRemName,
    ancestorTrees,
    descendantTrees,
    collapsedNodes,
    plugin,
    storePositions,
    collectVirtualAttributeIdsFromNodes,
    collectHiddenVirtualAttributeIds,
    handleContextMenuClose
  ]);

  const handleGotoContextRem = useCallback(() => {
    if (!contextMenu?.remId) return;

    if (loadedRemId && loadedRemId !== contextMenu.remId) {
      setHistoryStack((prev) => [...prev, loadedRemId]);
    }
    nodePositionsRef.current = new Map();
    loadHierarchy(contextMenu.remId);
    handleContextMenuClose();
  }, [contextMenu, loadHierarchy, handleContextMenuClose]);

  const handleRefresh = useCallback(async () => {
    if (loadedRemId) {
      nodePositionsRef.current = new Map();
      await updateGraph();
      reactFlowInstance?.fitView({ padding: 0.1, duration: 300 });
    }
  }, [loadedRemId, updateGraph, reactFlowInstance]);

  const handleGoBack = useCallback(() => {
    if (historyStack.length === 0) return;
    const previousId = historyStack[historyStack.length - 1];
    setHistoryStack((prev) => prev.slice(0, -1));
    nodePositionsRef.current = new Map();
    loadHierarchy(previousId);
    handleContextMenuClose();
  }, [historyStack, loadHierarchy, handleContextMenuClose]);

  const handleNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: GraphNode) => {
      event.preventDefault();
      event.stopPropagation();
      const nodeData = (node.data ?? undefined) as GraphNodeData | undefined;
      if (!nodeData) return;

      const label = (nodeData.label ?? "").trim();

      // Check if this is a virtual property/interface node
      if ((nodeData.kind === 'virtualProperty' || nodeData.kind === 'virtualInterface' || nodeData.kind === 'virtualDirectProperty') && nodeData.sourcePropertyId && nodeData.ownerRemId) {
        setVirtualContextMenu({
          x: event.clientX,
          y: event.clientY,
          nodeId: node.id,
          label: label.length > 0 ? label : '(Untitled)',
          sourcePropertyId: nodeData.sourcePropertyId,
          ownerRemId: nodeData.ownerRemId,
        });
        return;
      }

      // Check if this is a virtual interface group node
      if (nodeData.kind === 'virtualInterfaceGroup' && nodeData.ownerRemId) {
        setGroupContextMenu({
          x: event.clientX,
          y: event.clientY,
          nodeId: node.id,
          label: label.length > 0 ? label : '(Untitled Group)',
          ownerRemId: nodeData.ownerRemId,
        });
        return;
      }

      // Regular node context menu
      const remId = nodeData.remId ?? node.id;
      if (!remId) return;

      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        remId,
        label: label.length > 0 ? label : '(Untitled Rem)'
      });
    },
    []
  );

  // Helper to escape XML special characters
  const escapeXml = useCallback((str: string): string => {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }, []);

  // Helper to sanitize a string into a valid XML tag name
  // Rules: must start with letter or underscore, can contain letters, digits, hyphens, underscores, periods
  const sanitizeXmlTagName = useCallback((str: string): string => {
    if (!str || str.trim().length === 0) return '_unnamed';
    // Replace invalid characters with underscores
    let sanitized = str
      .replace(/[^a-zA-Z0-9_\-\.]/g, '_')  // Replace invalid chars with underscore
      .replace(/^[^a-zA-Z_]/, '_');         // Ensure starts with letter or underscore
    // Remove consecutive underscores
    sanitized = sanitized.replace(/_+/g, '_');
    // Remove trailing underscores
    sanitized = sanitized.replace(/_+$/, '');
    return sanitized || '_unnamed';
  }, []);

  // Build export metadata for all descendants (async pre-fetch)
  const buildExportMetadata = useCallback(async (
    descendants: HierarchyNode[]
  ): Promise<Map<string, ExportMetadata>> => {
    const metadata = new Map<string, ExportMetadata>();
    
    // Collect all nodes from descendants tree
    const allNodes: HierarchyNode[] = [];
    const stack = [...descendants];
    while (stack.length > 0) {
      const node = stack.pop()!;
      allNodes.push(node);
      if (node.children?.length) {
        stack.push(...node.children);
      }
    }
    
    // Fetch metadata for each node in parallel
    await Promise.all(allNodes.map(async (node) => {
      const rem = node.remRef;
      if (!rem) return;
      
      const [remType, isDocument] = await Promise.all([
        rem.getType(),
        rem.isDocument()
      ]);
      
      // isProperty: true if descriptor or document
      const isProperty = remType === RemType.DESCRIPTOR || isDocument;
      
      // isExported: documents and descriptors are always exported; others need Export tag
      const isDescriptorProperty = remType === RemType.DESCRIPTOR ? await isPropertyDescriptor(plugin, rem) : false;
      const isExported = isDocument || isDescriptorProperty || await hasTag(plugin, rem, "Export");
      
      // Get extends parents and resolve their names
      const extendsParents = await getExtendsParents(plugin, rem);
      const extendsNames: string[] = [];
      for (const parent of extendsParents) {
        const parentName = await getRemText(plugin, parent);
        if (parentName) {
          extendsNames.push(parentName);
        }
      }
      
      metadata.set(node.id, {
        isProperty,
        isExported,
        extendsNames
      });
    }));
    
    return metadata;
  }, [plugin]);

  // Convert the tree structure to XML format (descendants only, with new schema)
  const treeToXml = useCallback((exportMetadata: Map<string, ExportMetadata>): string => {
    if (!loadedRemId || !loadedRemName) return '';
    if (descendantTrees.length === 0) return '';

    // Helper to convert HierarchyNode to XML with new schema
    // Uses rem name as XML tag, adds extends/export/property attributes
    const hierarchyNodeToXml = (node: HierarchyNode, indent: string): string => {
      const tagName = sanitizeXmlTagName(node.name);
      const meta = exportMetadata.get(node.id);
      
      // Build attributes
      const extendsAttr = meta?.extendsNames.join(',') || '';
      const exportAttr = meta?.isExported ? 'true' : 'false';
      const propertyAttr = meta?.isProperty ? 'true' : 'false';
      
      const hasChildren = node.children.length > 0;
      
      if (!hasChildren) {
        return `${indent}<${tagName} extends="${escapeXml(extendsAttr)}" export="${exportAttr}" property="${propertyAttr}" />\n`;
      }

      let xml = `${indent}<${tagName} extends="${escapeXml(extendsAttr)}" export="${exportAttr}" property="${propertyAttr}">\n`;

      // Add children recursively
      for (const child of node.children) {
        xml += hierarchyNodeToXml(child, indent + '  ');
      }

      xml += `${indent}</${tagName}>\n`;
      return xml;
    };

    // Build the XML structure - descendants only
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<descendants>\n';

    for (const descendant of descendantTrees) {
      xml += hierarchyNodeToXml(descendant, '  ');
    }

    xml += '</descendants>';
    return xml;
  }, [loadedRemId, loadedRemName, descendantTrees, escapeXml, sanitizeXmlTagName]);

  // Handle export to XML
  const handleExportToXml = useCallback(async () => {
    if (descendantTrees.length === 0) {
      setError("No descendants to export");
      setPaneContextMenu(null);
      return;
    }

    // Pre-fetch export metadata for all descendants
    const exportMetadata = await buildExportMetadata(descendantTrees);
    
    const xml = treeToXml(exportMetadata);
    if (!xml) {
      setError("No data to export");
      setPaneContextMenu(null);
      return;
    }

    try {
      // Try using the Clipboard API first
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(xml);
      } else {
        // Fallback: create a temporary textarea element
        const textArea = document.createElement('textarea');
        textArea.value = xml;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        textArea.style.top = '-9999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      await plugin.app.toast("XML copied to clipboard!");
    } catch (err) {
      console.error("Failed to copy to clipboard:", err);
      // Try the fallback method even if the first attempt failed
      try {
        const textArea = document.createElement('textarea');
        textArea.value = xml;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        textArea.style.top = '-9999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        const success = document.execCommand('copy');
        document.body.removeChild(textArea);
        if (success) {
          await plugin.app.toast("XML copied to clipboard!");
        } else {
          setError("Failed to copy to clipboard");
        }
      } catch (fallbackErr) {
        console.error("Fallback copy also failed:", fallbackErr);
        setError("Failed to copy to clipboard");
      }
    }

    setPaneContextMenu(null);
  }, [descendantTrees, buildExportMetadata, treeToXml, plugin]);

  // Handle pane (empty space) right-click
  const handlePaneContextMenu = useCallback((event: React.MouseEvent | MouseEvent) => {
    event.preventDefault();
    setPaneContextMenu({
      x: 'clientX' in event ? event.clientX : 0,
      y: 'clientY' in event ? event.clientY : 0,
    });
  }, []);

  const showPlaceholder = nodes.length === 0;

  return (
    <div style={{ padding: 12, fontFamily: "Inter, sans-serif", fontSize: 14, height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <button
          style={{
            padding: "6px 12px",
            background: !focusedRemId || loading ? "#cbd5f5" : "#2563eb",
            color: !focusedRemId || loading ? "#475569" : "#ffffff",
            border: "none",
            borderRadius: 4,
            cursor: !focusedRemId || loading ? "not-allowed" : "pointer",
            fontWeight: 600,
          }}
          onClick={handleLoad}
          disabled={!focusedRemId || loading}
        >
          {loading ? "Refreshing..." : "Load Current Rem"}
        </button>

        <button
          style={{
            padding: '6px 12px',
            background: '#4b5563',
            color: '#ffffff',
            border: 'none',
            borderRadius: 4,
            cursor: !loadedRemId ? 'not-allowed' : 'pointer',
            fontWeight: 600,
          }}
          onClick={handleToggleCollapseAll}
          disabled={!loadedRemId}
        >
          {collapsedNodes.size > 0 ? 'Expand All' : 'Collapse All'}
        </button>
        <button
          style={{
            padding: '6px 12px',
            background: '#1f2937',
            color: '#ffffff',
            border: 'none',
            borderRadius: 4,
            cursor: !loadedRemId || (!propertyData && !interfaceData && !directPropertyData) ? 'not-allowed' : 'pointer',
            fontWeight: 600,
          }}
          onClick={handleToggleAttributes}
          disabled={!loadedRemId || (!propertyData && !interfaceData && !directPropertyData)}
        >
          Toggle {attributeType === 'property' ? 'Properties' : 'Interfaces'}
        </button>
        <select
          style={{
            padding: '6px 12px',
            background: '#1f2937',
            color: '#ffffff',
            border: 'none',
            borderRadius: 4,
            cursor: !loadedRemId || (!propertyData && !interfaceData && !directPropertyData) ? 'not-allowed' : 'pointer',
            fontWeight: 600,
          }}
          value={attributeType}
          onChange={(e) => handleSwitchAttributes(e.target.value as 'property' | 'interface')}
          disabled={!loadedRemId || (!propertyData && !interfaceData && !directPropertyData)}
        >
          <option value="property">Properties</option>
          <option value="interface">Interfaces</option>
        </select>
        <button
          style={{
            padding: "6px 12px",
            background: !loadedRemId || loading ? "#cbd5f5" : "#2563eb",
            color: !loadedRemId || loading ? "#475569" : "#ffffff",
            border: "none",
            borderRadius: 4,
            cursor: !loadedRemId || loading ? "not-allowed" : "pointer",
            fontWeight: 600,
          }}
          onClick={handleRefresh}
          disabled={!loadedRemId}
        >
          Reposition
        </button>
        <button
          style={{
            padding: "6px 12px",
            background: historyStack.length === 0 || loading ? "#cbd5f5" : "#2563eb",
            color: historyStack.length === 0 || loading ? "#475569" : "#ffffff",
            border: "none",
            borderRadius: 4,
            cursor: historyStack.length === 0 || loading ? "not-allowed" : "pointer",
            fontWeight: 600,
          }}
          onClick={handleGoBack}
          disabled={historyStack.length === 0}
        >
          Back
        </button>
      </div>

      {error && <div style={{ color: "#dc2626", marginBottom: 8 }}>{error}</div>}
      
      {isPartialLoad && !error && (
        <div style={{ 
          color: "#b45309", 
          background: "#fef3c7", 
          padding: "8px 12px", 
          borderRadius: 4, 
          marginBottom: 8,
          border: "1px solid #fcd34d",
          fontSize: 13
        }}>
          ⚠️ Loading timed out after 60 seconds. Showing partial results.
        </div>
      )}

      <div
        style={{
          height: "calc(100% - 60px)",
          minHeight: 300,
          border: "1px solid #e2e8f0",
          borderRadius: 8,
          background: "#f8fafc",
          position: "relative",
          color: "#0f172a"
        }}
        onClick={handleContextMenuClose}
      >
        {showPlaceholder ? (
          <div style={{ padding: 24, color: "#64748b" }}>
            {focusedRemId
              ? "Press Reposition to load the inheritance hierarchy."
              : "Focus a rem, then press Reposition to load the hierarchy."}
          </div>
        ) : (
          <ReactFlowProvider>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={NODE_TYPES}
              edgeTypes={EDGE_TYPES}
              onInit={setReactFlowInstance}
              onNodeClick={handleNodeClick}
              onNodeContextMenu={handleNodeContextMenu}
              onPaneContextMenu={handlePaneContextMenu}
              onNodesChange={handleNodesChange}
              nodesDraggable
              nodesConnectable={false}
              elementsSelectable={false}
              panOnDrag
              zoomOnScroll
              proOptions={{ hideAttribution: true }}
              fitView
              minZoom={0.1}
              maxZoom={1.4}
              style={{ background: "transparent" }}
            >
              <Background gap={24} color="#e2e8f0" />
              <Controls position="bottom-right" showInteractive={false} />
            </ReactFlow>
          </ReactFlowProvider>
        )}
        {contextMenu && (
          <div
            style={{
              position: 'fixed',
              left: contextMenu.x,
              top: contextMenu.y,
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 4,
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
              zIndex: 1000,
              minWidth: 160,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              style={{
                padding: '8px 12px',
                background: 'none',
                border: 'none',
                width: '100%',
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: 14,
                color: '#374151',
              }}
              onClick={handleGotoContextRem}
            >
              Open Rem
            </button>
            <button
              style={{
                padding: '8px 12px',
                background: 'none',
                border: 'none',
                width: '100%',
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: 14,
                color: '#374151',
              }}
              onClick={handleHideProperties}
            >
              Toggle Properties
            </button>
            <button
              style={{
                padding: '8px 12px',
                background: 'none',
                border: 'none',
                width: '100%',
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: 14,
                color: '#374151',
              }}
              onClick={handleHideVirtualProperties}
            >
              Toggle Virtual Properties
            </button>
            <button
              style={{
                padding: '8px 12px',
                background: 'none',
                border: 'none',
                width: '100%',
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: 14,
                color: '#374151',
                borderTop: '1px solid #e2e8f0',
              }}
              onClick={handleOpenContextRem}
            >
              Edit Rem
            </button>
            <button
              style={{
                padding: '8px 12px',
                background: 'none',
                border: 'none',
                width: '100%',
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: 14,
                color: '#374151',
              }}
              onClick={handleCopyContextRem}
            >
              Copy Rem
            </button>
            <button
              style={{
                padding: '8px 12px',
                background: 'none',
                border: 'none',
                width: '100%',
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: 14,
                color: '#6b7280',
                borderTop: '1px solid #e2e8f0',
              }}
              onClick={handleCopyDebugInfo}
            >
              Copy Debug Info
            </button>
          </div>
        )}
        {virtualContextMenu && (
          <div
            style={{
              position: 'fixed',
              left: virtualContextMenu.x,
              top: virtualContextMenu.y,
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 4,
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
              zIndex: 1000,
              minWidth: 160,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              style={{
                padding: '8px 12px',
                background: 'none',
                border: 'none',
                width: '100%',
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: 14,
                color: '#374151',
              }}
              onClick={handleImplementVirtualProperty}
            >
              Implement
            </button>
            <button
              style={{
                padding: '8px 12px',
                background: 'none',
                border: 'none',
                width: '100%',
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: 14,
                color: '#374151',
                borderTop: '1px solid #e2e8f0',
              }}
              onClick={handleEditVirtualRem}
            >
              Edit Rem
            </button>
          </div>
        )}
        {groupContextMenu && (
          <div
            style={{
              position: 'fixed',
              left: groupContextMenu.x,
              top: groupContextMenu.y,
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 4,
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
              zIndex: 1000,
              minWidth: 160,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              style={{
                padding: '8px 12px',
                background: 'none',
                border: 'none',
                width: '100%',
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: 14,
                color: '#374151',
              }}
              onClick={handleImplementAllGroup}
            >
              Implement All
            </button>
          </div>
        )}
        {paneContextMenu && (
          <div
            style={{
              position: 'fixed',
              left: paneContextMenu.x,
              top: paneContextMenu.y,
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 4,
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
              zIndex: 1000,
              minWidth: 120,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              style={{
                padding: '8px 12px',
                background: 'none',
                border: 'none',
                width: '100%',
                textAlign: 'left',
                cursor: loadedRemId ? 'pointer' : 'not-allowed',
                fontSize: 14,
                color: loadedRemId ? '#374151' : '#9ca3af',
              }}
              onClick={handleExportToXml}
              disabled={!loadedRemId}
            >
              Export
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

renderWidget(MindmapWidget);
