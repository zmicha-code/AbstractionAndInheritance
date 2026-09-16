import { RNPlugin } from "@remnote/plugin-sdk";
import { MindMapState } from "./types";
import { MINDMAP_STATE_KEY, restoreFromSynced } from "./constants";

export async function saveMindMapState(
  plugin: RNPlugin,
  state: MindMapState
): Promise<void> {
  try {
    await plugin.storage.setSynced(MINDMAP_STATE_KEY, state);
  } catch (err) {
    console.error("Failed to save mindmap state:", err);
  }
}

export async function loadMindMapState(
  plugin: RNPlugin
): Promise<MindMapState | null> {
  try {
    if (!restoreFromSynced) {
      await plugin.storage.setSynced(MINDMAP_STATE_KEY, null);
      return null;
    }

    const state = await plugin.storage.getSynced(MINDMAP_STATE_KEY);
    if (state && typeof state === "object" && "loadedRemId" in state) {
      return state as MindMapState;
    }
    return null;
  } catch (err) {
    console.error("Failed to load mindmap state:", err);
    return null;
  }
}
