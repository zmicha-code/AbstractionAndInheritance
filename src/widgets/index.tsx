import { declareIndexPlugin, ReactRNPlugin, WidgetLocation } from '@remnote/plugin-sdk';
import '../style.css';
import '../App.css';

// RemNote (Ancestor) Tags:
// "Tag"
// "Rem With An Alias"
// "Automatically Sort"
// "Document"
// "Highlight"

// RemNote References:
// "query:#<Rem>"
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
  await plugin.app.registerWidget('sample_widget', WidgetLocation.RightSidebar, {
    dimensions: { height: 'auto', width: '100%' },
  });

  // Register a sidebar widget.
  await plugin.app.registerWidget('remInfo_widget', WidgetLocation.RightSidebar, {
    dimensions: { height: 'auto', width: '100%' },
  });
}

async function onDeactivate(_: ReactRNPlugin) {}

declareIndexPlugin(onActivate, onDeactivate);
