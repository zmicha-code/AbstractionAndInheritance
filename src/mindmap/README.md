# Mindmap modules

`src/widgets/mindmap_widget.tsx` is being split so individual files stay small enough to commit directly.

## Present on main

- `types.ts`
- `timeout.ts`
- `constants.ts`
- `cache.ts`
- `state.ts`
- `flowNodes.tsx`
- `hierarchy.ts`
- `remLayout.ts`
- `attributeData.ts`
- `virtualData.ts`
- `graph.ts`

## Still to add before the widget can drop duplicated code

- `attributeLayout.ts`
- `virtualLayout.ts`

After those two files exist, replace everything in `mindmap_widget.tsx` before `function MindmapWidget()` with imports from `src/mindmap/`.
