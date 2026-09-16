# Mindmap modules

`src/widgets/mindmap_widget.tsx` is being split so individual files stay small enough to commit directly.

## Layout

- `types.ts` — shared types
- `timeout.ts` — load timeout helpers
- `constants.ts` — spacing, handles, colors, width helpers
- `cache.ts` — load context and Rem caches
- `flowNodes.tsx` — React Flow node components
- `hierarchy.ts` — ancestor/descendant trees
- `remLayout.ts` — rem forest layout
- `attributeData.ts` — property/interface data
- `attributeLayout.ts` — attribute node layout
- `virtualData.ts` — virtual attribute computation
- `virtualLayout.ts` — virtual attribute layout
- `graph.ts` — graph assembly
- `state.ts` — persisted widget state

The widget file should only keep React state, event handlers, and JSX.
