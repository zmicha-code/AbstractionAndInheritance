import React from "react";

export const VERTICAL_SPACING = 150;
export const REM_HORIZONTAL_SPACING = 110;
export const REM_CHILD_GAP_UNITS = 0.5;
export const REM_UNIT_HEIGHT_PX = VERTICAL_SPACING;
export const REM_NODE_HEIGHT_ESTIMATE = 46;
export const ATTRIBUTE_NODE_HEIGHT_ESTIMATE = 40;
export const ATTRIBUTE_VERTICAL_MARGIN = 12;
export const ATTRIBUTE_HORIZONTAL_SPACING = 47;
export const ATTRIBUTE_VERTICAL_SPACING = 50;
export const ATTRIBUTE_HEIGHT_SPACING_FACTOR = 1;
export const ATTRIBUTE_HEIGHT_SPACING_OFFSET = -1;

export const MINDMAP_STATE_KEY = "mindmap_widget_state";
export const restoreFromSynced = false;

export const REM_SOURCE_BOTTOM_HANDLE = "rem-source-bottom";
export const REM_TARGET_TOP_HANDLE = "rem-target-top";
export const REM_SOURCE_RIGHT_HANDLE = "rem-source-right";
export const REM_SOURCE_LEFT_HANDLE = "rem-source-left";
export const REM_TARGET_LEFT_HANDLE = "rem-target-left";
export const REM_TARGET_RIGHT_HANDLE = "rem-target-right";
export const ATTRIBUTE_TARGET_LEFT_HANDLE = "attribute-target-left";
export const ATTRIBUTE_SOURCE_RIGHT_HANDLE = "attribute-source-right";
export const ATTRIBUTE_SOURCE_BOTTOM_HANDLE = "attribute-source-bottom";
export const ATTRIBUTE_TARGET_TOP_HANDLE = "attribute-target-top";
export const ATTRIBUTE_TARGET_RIGHT_HANDLE = "attribute-target-right";

export const NODE_CONTAINER_STYLE: React.CSSProperties = {
  width: "100%",
  height: "100%",
  position: "relative",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  textAlign: "inherit",
  fontWeight: "inherit",
};

export const ATTRIBUTE_CONTAINER_STYLE: React.CSSProperties = {
  ...NODE_CONTAINER_STYLE,
  justifyContent: "flex-start",
};

export const HANDLE_COMMON_STYLE: React.CSSProperties = {
  width: 6,
  height: 6,
};

export const NODE_VERTICAL_PADDING = 6;
export const NODE_HORIZONTAL_PADDING = 10;

export const TOP_HANDLE_STYLE: React.CSSProperties = {
  top: -NODE_VERTICAL_PADDING,
  left: "50%",
  transform: "translate(-50%, -50%)",
};

export const BOTTOM_HANDLE_STYLE: React.CSSProperties = {
  bottom: -NODE_VERTICAL_PADDING,
  left: "50%",
  transform: "translate(-50%, 50%)",
};

export const RIGHT_HANDLE_STYLE: React.CSSProperties = {
  right: -NODE_HORIZONTAL_PADDING,
  top: "50%",
  transform: "translate(50%, -50%)",
};

export const LEFT_HANDLE_STYLE: React.CSSProperties = {
  left: -NODE_HORIZONTAL_PADDING,
  top: "50%",
  transform: "translate(-50%, -50%)",
};

export const RIGHT_TARGET_HANDLE_STYLE: React.CSSProperties = {
  right: -NODE_HORIZONTAL_PADDING,
  top: "50%",
  transform: "translate(50%, -50%)",
};

export const BOTTOM_SOURCE_HANDLE_STYLE: React.CSSProperties = {
  bottom: -NODE_VERTICAL_PADDING,
  left: "50%",
  transform: "translate(-50%, 50%)",
};

export const EDGE_COLOR_PALETTE = [
  "#e63946",
  "#f4a261",
  "#e9c46a",
  "#2a9d8f",
  "#264653",
  "#9b5de5",
  "#00bbf9",
  "#00f5d4",
  "#f15bb5",
  "#fee440",
  "#8338ec",
  "#3a86ff",
  "#ff006e",
  "#fb5607",
  "#06d6a0",
];

export function getColorForNode(nodeId: string): string {
  let hash = 0;
  for (let i = 0; i < nodeId.length; i++) {
    hash = ((hash << 5) - hash) + nodeId.charCodeAt(i);
    hash = hash & hash;
  }
  const index = Math.abs(hash) % EDGE_COLOR_PALETTE.length;
  return EDGE_COLOR_PALETTE[index];
}

export function estimateNodeWidth(
  label: string,
  kind: "rem" | "property" | "interface" | "virtualProperty" | "virtualInterface" | "directProperty" | "virtualDirectProperty" | "virtualInterfaceGroup"
): number {
  const fontSize = kind === "rem" ? 13 : 12;
  const avgCharWidth = fontSize * 0.6;
  const textWidth = label.length * avgCharWidth;
  const padding = 2 * 10;
  const minWidth = kind === "rem" ? 140 : 160;
  return Math.max(minWidth, textWidth + padding);
}

export function compareByHierarchyThenLabel<T extends { label: string; hierarchyLevel?: number }>(a: T, b: T): number {
  const levelA = a.hierarchyLevel ?? 0;
  const levelB = b.hierarchyLevel ?? 0;
  if (levelA !== levelB) {
    return levelA - levelB;
  }
  return a.label.localeCompare(b.label);
}
