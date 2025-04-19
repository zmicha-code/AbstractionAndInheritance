import { declareIndexPlugin, ReactRNPlugin, WidgetLocation,
  Rem, RemType, SetRemType,
  RichTextElementRemInterface, RichTextInterface } from '@remnote/plugin-sdk';

import { specialTags, specialNames, highlightColorMap, DEFAULT_NODE_COLOR, FOCUSED_NODE_STYLE,
   getRemText, getNextParents, getAllParents, referencesEigenschaften, isReferencingRem,
   isNextParent, isRemProperty, getNonReferencingParent, highestXPosition,
   highestYPosition, calcNodeHeight2, lowestYPosition,
   isAncestor,
   getTagParent,
   getNextChildren,
   formatIfLayerConcept,
   isLayerConcept,
   getAllChildren
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

async function handleInsertCommand(plugin: ReactRNPlugin): Promise<void> {
  const focusedRem = await plugin.focus.getFocusedRem();

  // Ensure the focused Rem is a descriptor
  if (!focusedRem || (await focusedRem.getType()) !== RemType.DESCRIPTOR) {
    await plugin.app.toast('Selected Rem is not a descriptor.');
    return;
  }

  const parent = await focusedRem.getParentRem();
  if (!parent || (await parent.getType()) !== RemType.CONCEPT) {
    await plugin.app.toast('Selected Rem does not have a concept as parent.');
    return;
  }

  // Get the Rem that the focused descriptor is referencing
  const referencedRems = await focusedRem.remsBeingReferenced();
  if (referencedRems.length === 0) {
    await plugin.app.toast('The selected descriptor does not reference any Rem.');
    return;
  }

  // Assuming the descriptor references only one Rem
  const targetRem = referencedRems[0];

  // Get all Rems directly referencing the target Rem
  const children = await targetRem.remsReferencingThis();

  console.log(await getRemText(plugin, targetRem) + " has deepRemsBeingReferenced: " + children.length);

  // Remove the focusedRem from the children list
  const filteredChildren = children.filter(child => child._id !== focusedRem._id);

  if (filteredChildren.length === 0) {
    await plugin.app.toast('No other Rems reference the target Rem.');
    return;
  }

  // Update each child that references the target Rem to reference the focused Rem
  let updatedCount = 0;

  for (const child of filteredChildren) {
    const parentConcept = await child.getParentRem();

    if (!parentConcept || (await parentConcept.getType()) !== RemType.CONCEPT) {
      continue;
    }

    // Check if the child's parent concept is a descendant of the focusedRem's parent
    if (await isAncestor(plugin, parent, parentConcept)) {
      await setRemToReference(plugin, focusedRem, child);
      updatedCount++;
    } else {
      console.log(await getRemText(plugin, parentConcept) + " is not a descendant of " + await getRemText(plugin, parent));
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
  await plugin.app.registerWidget('sample_widget', WidgetLocation.Pane, {
    dimensions: { height: 'auto', width: '100%' },
  });

  await plugin.window.openWidgetInPane('sample_widget');

  // Register a sidebar widget.
  await plugin.app.registerWidget('remInfo_widget', WidgetLocation.RightSidebar, {
    dimensions: { height: 'auto', width: '100%' },
  });

  // Register 
  await plugin.app.registerWidget(
    'implement_widget',
    WidgetLocation.FloatingWidget,
    {
      dimensions: {
        height: 'auto',
        width: '1000px',
      },
    },
  );

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