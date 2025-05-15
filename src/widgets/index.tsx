import { declareIndexPlugin, ReactRNPlugin, WidgetLocation,
  Rem, RemType, SetRemType,
  RichTextElementRemInterface, RichTextInterface, 
  RNPlugin} from '@remnote/plugin-sdk';

import { specialTags, specialNames, highlightColorMap, DEFAULT_NODE_COLOR, FOCUSED_NODE_STYLE,
   getRemText, getNextParents, getAllParents, referencesEigenschaften, isReferencingRem,
   isNextParent, isRemProperty, getNonReferencingParent, highestXPosition,
   highestYPosition, calcNodeHeight2, lowestYPosition,
   isAncestor,
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
async function setRemToReference(plugin: ReactRNPlugin, newReference: Rem, referencingRem: Rem): Promise<void> {
  const referenceElement: RichTextElementRemInterface = {
      i: 'q',
      _id: newReference._id
  };
  const richText: RichTextInterface = [referenceElement];
  await referencingRem.setText(richText);
  await referencingRem.setType(SetRemType.DESCRIPTOR);
}

// Main function to handle the "/implement" command
async function handleImplementCommand(plugin: ReactRNPlugin): Promise<void> {
  //console.log("Handle implement command");
  await plugin.window.openFloatingWidget("implement_widget",  {top: -600, left: -1500}, "rn-help-button"); // "rn-editor__rem__body__text"
}

// Handler for the "extrudeLayer" command
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

async function isAncestor2(plugin: RNPlugin, ancestor: Rem, rem: Rem): Promise<boolean> {

  const ancestors = (await getAncestorLineage(plugin, rem))[0];

  for(const a of ancestors) {
    if(ancestor._id == a._id)
      return true;
  }

  return false;
}

// RemA has child RemB which has child RemC and C is referencing e.g. Eigenschaften from A. If
// i now want B to reference Eigenschaften from A i have to update C to reference Eigenschaften from B.
// TODO: Currently only updates Rem Hierarchie Children and Nor Children that are Referencing
async function handleInsertCommand(plugin: ReactRNPlugin): Promise<void> {
  const eigenschaftenB = await plugin.focus.getFocusedRem();

  // Ensure the focused Rem is a descriptor
  if (!eigenschaftenB || (await eigenschaftenB.getType()) !== RemType.DESCRIPTOR) {
    await plugin.app.toast('Selected Rem is not a descriptor.');
    return;
  }

  const remB = await eigenschaftenB.getParentRem();
  if (!remB) { // || (await remB.getType()) !== RemType.CONCEPT
    await plugin.app.toast('Selected Rem does not have a valid parent.');
    return;
  }

  // Get the Rem that the focused descriptor is referencing
  const referencedRems = await eigenschaftenB.remsBeingReferenced();
  if (referencedRems.length === 0) {
    await plugin.app.toast('The selected descriptor does not reference any Rem.');
    return;
  }

  // Assuming the descriptor references only one Rem
  const eigenschaftenA = referencedRems[0];

  // Get all Rems directly referencing the target Rem
  const eigenschaftenCAndSoOn = await eigenschaftenA.remsReferencingThis();

  //console.log(await getRemText(plugin, eigenschaftenA) + " has deepRemsBeingReferenced: " + eigenschaftenCAndSoOn.length);

  // Remove the focusedRem from the children list
  const _eigenschaftenCAndSoOn = eigenschaftenCAndSoOn.filter(child => child._id !== eigenschaftenB._id);

  if (_eigenschaftenCAndSoOn.length === 0) {
    await plugin.app.toast('No other Rems reference the target Rem.');
    return;
  }

  // Update each child that references the target Rem to reference the focused Rem
  let updatedCount = 0;

  // TODO: update only children that are in the hierarchie below the focused rem
  for (const eigenschaftenC of _eigenschaftenCAndSoOn) {
    const remC = await eigenschaftenC.getParentRem();

    if (!remC) { // || (await remC.getType()) !== RemType.CONCEPT
      continue;
    }

    // Check if the child's parent concept is a descendant of the focusedRem's parent
    if (await isAncestor2(plugin, remB, remC)) {
      await setRemToReference(plugin, eigenschaftenB, eigenschaftenC);
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
  //await plugin.app.registerWidget('sample_widget', WidgetLocation.Pane, {
  //  dimensions: { height: 'auto', width: '100%' },
  //});

  //await plugin.window.openWidgetInPane('sample_widget');

  // Register a sidebar widget.
  //await plugin.app.registerWidget('remInfo_widget', WidgetLocation.RightSidebar, {
  //  dimensions: { height: 'auto', width: '100%' },
  //});

  await plugin.app.registerWidget('implement_widget', WidgetLocation.LeftSidebar, {
    dimensions: { height: 'auto', width: '100%' },
    widgetTabIcon: "https://i.imgur.com/mzRl0P8.png",
  });

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
    quickCode: 'extrude',
    action: async () => {
      await handleExtrudeCommand(plugin);
    },
  });

  // Register the "insertLayer" command
  await plugin.app.registerCommand({
    id: 'insert-command',
    name: 'Insert Layer',
    quickCode: 'insert',
    action: async () => {
      await handleInsertCommand(plugin);
    },
  });
}

async function onDeactivate(_: ReactRNPlugin) {}

declareIndexPlugin(onActivate, onDeactivate);