# Mindmap modules

Shared code extracted from `src/widgets/mindmap_widget.tsx`.

## On main

- `types.ts`, `timeout.ts`, `constants.ts`, `cache.ts`, `state.ts`
- `flowNodes.tsx`, `hierarchy.ts`, `remLayout.ts`, `graph.ts`
- `attributeData.ts`, `virtualData.ts`
- `attributeTrees.ts`, `attributeLayout.ts` (barrel)
- `virtualDescendants.ts`, `virtualLayout.ts` (barrel)

## Still required before slimming the widget

- `virtualAttributes.ts` — `layoutVirtualAttributes`
- `attributeIntegrate.ts` — `integrateAttributeGraph`

After those two exist, delete everything in `mindmap_widget.tsx` before `function MindmapWidget()` and import from `src/mindmap/` instead.
