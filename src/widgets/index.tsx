import { declareIndexPlugin, ReactRNPlugin, WidgetLocation,
  PluginRem, RemType, SetRemType,
  RichTextElementRemInterface, RichTextInterface, 
  RNPlugin,
  RICH_TEXT_FORMATTING} from '@remnote/plugin-sdk';

import { specialTags, specialNames, highlightColorMap, DEFAULT_NODE_COLOR, FOCUSED_NODE_STYLE,
   getRemText, getNextParents, getAllParents, referencesEigenschaften, isReferencingRem,
   isNextParent, isRemProperty, getNonReferencingParent, highestXPosition,
   highestYPosition, calcNodeHeight2, lowestYPosition,
   isAncestor_,
   getTagParent,
   getNextChildren,
   formatIfLayerConcept,
   isLayerConcept,
   getAllChildren,
   getAncestorLineage
} from "../utils/utils";

import '../style.css';
import '../App.css';

// Function to set a Rem to reference another Rem
async function setRemToReference(plugin: ReactRNPlugin, newReference: PluginRem, oldReference: PluginRem, referencingRem: PluginRem) {
  const remText = referencingRem.text;
  const updatedText = remText.map(element => {
      if (typeof element === 'object') {
          if (element.i === 'q' && element._id === oldReference._id) {
              return { ...element, _id: newReference._id };
          } else if (element.i === 'm' && element[RICH_TEXT_FORMATTING.INLINE_LINK] === oldReference._id) {
              return { ...element, [RICH_TEXT_FORMATTING.INLINE_LINK]: newReference._id };
          } else {
              return element;
          }
      } else {
          return element;
      }
  });
  await referencingRem.setText(updatedText);
}

// Main function to handle the "/implement" command
async function handleImplementCommand(plugin: ReactRNPlugin): Promise<void> {
  //console.log("Handle implement command");
  await plugin.window.openFloatingWidget("implement_widget",  {top: -600, left: -1500}, "rn-help-button"); // "rn-editor__rem__body__text"
}

// Handler for the "extrudeLayer" command
/*
async function handleExtrudeCommand(plugin: ReactRNPlugin): Promise<void> {
  const focusedRem = await plugin.focus.getFocusedRem();
  if (!focusedRem) {
    await plugin.app.toast('No Rem is currently selected.');
    return;
  }

  // Check if the focused Rem is referencing another Rem
  const referencedRems = await focusedRem.remsBeingReferenced();
  if (referencedRems.length === 0) {
    await plugin.app.toast('The selected Rem does not reference any other Rem.');
    return;
  }

  // Assuming the focused Rem references only one Rem
  const targetRem = referencedRems[0];

  // Get all Rems that reference the focused Rem
  const referencingRems = await focusedRem.remsReferencingThis();
  if (referencingRems.length === 0) {
    await plugin.app.toast('No Rems are referencing the selected Rem.');
    return;
  }

  // Update each referencing Rem to reference the target Rem
  for (const refRem of referencingRems) {
    await setRemToReference(plugin, targetRem, refRem);
  }

  await plugin.app.toast(`Updated ${referencingRems.length} Rems to reference the target Rem.`);
}
  */

async function handleExtrudeCommand(plugin: ReactRNPlugin): Promise<void> {
  const focusedRem = await plugin.focus.getFocusedRem();
  if (!focusedRem) {
    await plugin.app.toast('No Rem is currently selected.');
    return;
  }

  // Check if the focused Rem is referencing another Rem
  const referencedRems = await focusedRem.remsBeingReferenced();
  if (referencedRems.length === 0) {
    await plugin.app.toast('The selected Rem does not reference any other Rem.');
    return;
  }

  // Assuming the focused Rem references only one Rem
  const targetRem = referencedRems[0];

  // Get all Rems that reference the focused Rem
  const referencingRems = await focusedRem.remsReferencingThis();
  if (referencingRems.length === 0) {
    await plugin.app.toast('No Rems are referencing the selected Rem.');
    return;
  }

  // Update each referencing Rem to reference the target Rem
  for (const refRem of referencingRems) {
    await setRemToReference(plugin, targetRem, focusedRem, refRem);
  }

  await plugin.app.toast(`Updated ${referencingRems.length} Rems to reference the target Rem.`);
}

async function isAncestor2(plugin: RNPlugin, ancestor: PluginRem, rem: PluginRem): Promise<boolean> {

  const lineages = (await getAncestorLineage(plugin, rem)); // const ancestors = (await getAncestorLineage(plugin, rem))[0];

  for(const l of lineages) {
    for(const a of l) {
      if(ancestor._id == a._id)
        return true;
    }
  }

  return false;
}

// RemA has child RemB which has child RemC and C is referencing a PROPERTY from A. If
// i now want to implement that PROPERTY in B, i would have to update C to reference the PROPERTY from B. (TO KEEP A PROPER INHERITANCE)
// TODO: Currently only updates Rem Hierarchie Children and Nor Children that are Referencing
async function handleInsertCommand(plugin: ReactRNPlugin): Promise<void> {
  const newPropertyB = await plugin.focus.getFocusedRem();

  // 
  if (!newPropertyB) { //  || (await newLayerB.getType()) !== RemType.DESCRIPTOR
    await plugin.app.toast('Selected Rem is not valid.');
    return;
  }

  const layerBClass = await newPropertyB.getParentRem();
  if (!layerBClass) { // || (await remB.getType()) !== RemType.CONCEPT
    await plugin.app.toast('Selected Rem does not have a valid parent.');
    return;
  }

  // Get the Rem that the focused descriptor is referencing
  const referencedRems = await newPropertyB.remsBeingReferenced();
  if (referencedRems.length === 0) {
    await plugin.app.toast('The selected descriptor does not reference any Rem.');
    return;
  }

  // Assuming the descriptor references only one Rem
  const layerAProperty = referencedRems[0];

  // Get all Rems directly referencing the target Rem
  const allLayerCProperties = await layerAProperty.remsReferencingThis();

  //console.log(await getRemText(plugin, eigenschaftenA) + " has deepRemsBeingReferenced: " + eigenschaftenCAndSoOn.length);

  // Remove the focusedRem from the children list
  const layerCProperties = allLayerCProperties.filter(child => child._id !== newPropertyB._id);

  if (layerCProperties.length === 0) {
    await plugin.app.toast('No other Rems reference the target Rem.');
    return;
  }

  // Update each child that references the target Rem to reference the focused Rem
  let updatedCount = 0;

  // TODO: update only children that are in the hierarchie below the focused rem
  for (const layerCProperty of layerCProperties) {

    const layerCClass = await layerCProperty.getParentRem();

    if(!layerCClass) continue;

    // Check if the rem is a descendant of the focusedRem
    if (await isAncestor2(plugin, layerBClass, layerCClass)) {
      await setRemToReference(plugin, newPropertyB, layerAProperty, layerCProperty);
      updatedCount++;
    } else {
      //console.log(await getRemText(plugin, remC) + " is not a descendant of " + await getRemText(plugin, remB));
    }
  }

  await plugin.app.toast(`Updated ${updatedCount} children to reference the selected descriptor.`);
}

async function onActivate(plugin: ReactRNPlugin) {
  // Register settings
  await plugin.settings.registerStringSetting({
    id: 'name',
    title: 'What is your Name?',
    defaultValue: 'Bob',
  });

  await plugin.settings.registerBooleanSetting({
    id: 'pizza',
    title: 'Do you like pizza?',
    defaultValue: true,
  });

  await plugin.settings.registerNumberSetting({
    id: 'favorite-number',
    title: 'What is your favorite number?',
    defaultValue: 42,
  });

  // A command that inserts text into the editor if focused.
  await plugin.app.registerCommand({
    id: 'editor-command',
    name: 'Editor Command',
    action: async () => {
      plugin.editor.insertPlainText('Hello World!');
    },
  });

  // New command: Display graph for the selected Rem
  await plugin.app.registerCommand({
    id: 'display-graph',
    name: 'Display Graph for Selected Rem',
    action: async () => {
      const focusedRem = await plugin.focus.getFocusedRem();
      if (focusedRem) {
        await plugin.storage.setSession('selectedRemId', focusedRem._id);
      } else {
        await plugin.app.toast('No Rem is currently selected.');
      }
    },
  });

  // Register a sidebar widget.
  await plugin.app.registerWidget('mindmap_widget', WidgetLocation.RightSidebar, {
    dimensions: { height: 'auto', width: '100%' },
    widgetTabIcon: "https://i.imgur.com/mzRl0P8.png"});

  // WidgetLocation.Pane causes RemNote errors
  //await plugin.window.openWidgetInPane('mindmap_widget');

  // await plugin.app.registerWidget('properties_widget', WidgetLocation.RightSidebar, {
  //   dimensions: { height: 'auto', width: '100%' },
  //   widgetTabIcon: "https://i.imgur.com/mzRl0P8.png",
  // });

  // New command: Implement descriptors
  await plugin.app.registerCommand({
    id: 'implement-command',
    name: 'Implement Descriptors',
    quickCode: 'implement',
    action: async () => {
      await handleImplementCommand(plugin);
    },
  });

  // Register the "extrudeLayer" command
  await plugin.app.registerCommand({
    id: 'extrude-command',
    name: 'Extrude Layer',
    description: 'Makes all Rem, that reference this Rem, to reference the Rem, the current Rem is referencing, instead.',
    quickCode: 'extrude',
    action: async () => {
      await handleExtrudeCommand(plugin);
    },
  });

  // Register the "insertLayer" command
  await plugin.app.registerCommand({
    id: 'insert-command',
    name: 'Insert Property Layer',
    description: 'Inserts a Property into the Hierarchie by making all Descendant Properties reference this Property instead of the Property of the Ancestor. A-X -> A-B-X',
    quickCode: 'insert',
    action: async () => {
      await handleInsertCommand(plugin);
    },
  });
}

async function onDeactivate(_: ReactRNPlugin) {}

declareIndexPlugin(onActivate, onDeactivate);