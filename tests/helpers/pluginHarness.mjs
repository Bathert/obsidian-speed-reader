import { build } from 'esbuild';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const bundle = await build({
  stdin: { contents: 'export { default as Plugin } from "./src/main"; export * from "./src/settings";', resolveDir: root },
  bundle: true, write: false, format: 'cjs', platform: 'node', external: ['obsidian'],
  plugins: [{ name: 'mock-reader', setup(build) {
    build.onResolve({ filter: /\/readerModal$/ }, () => ({ path: 'reader', namespace: 'mock' }));
    build.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'export { SpeedReaderModal } from "obsidian";' }));
  } }],
});

export function harness(data = null) {
  const calls = { modals: [], notices: [], commands: [], ribbons: [], events: [], tabs: [], saves: [] };
  class MarkdownView {}
  class Plugin {
    constructor(app) { this.app = app; }
    async loadData() { return data; }
    async saveData(value) { calls.saves.push(structuredClone(value)); }
    addCommand(command) { calls.commands.push(command); }
    addRibbonIcon(icon, title, callback) { calls.ribbons.push({ icon, title, callback }); }
    registerEvent(event) { calls.events.push(event); }
    addSettingTab(tab) { calls.tabs.push(tab); }
  }
  // Only the documented settings storage contract is mocked, not plugin logic.
  class PluginSettingTab {
    constructor(app, plugin) { this.plugin = plugin; }
    getControlValue(key) { return this.plugin.settings[key]; }
    async setControlValue(key, value) {
      this.plugin.settings[key] = value;
      await this.plugin.saveData(this.plugin.settings);
    }
    update() { this.updates = (this.updates ?? 0) + 1; }
  }
  class SpeedReaderModal {
    constructor(app, plugin, text, title, noteKey = '', onSyncCursor) {
      Object.assign(this, { app, plugin, text, title, noteKey, onSyncCursor });
    }
    open() { calls.modals.push(this); }
  }
  class Notice { constructor(message, duration) { calls.notices.push({ message, duration }); } }
  const obsidian = { Plugin, PluginSettingTab, MarkdownView, SpeedReaderModal, Notice };
  const context = { module: { exports: {} }, require(name) {
    assertModule(name);
    return obsidian;
  } };
  vm.runInNewContext(bundle.outputFiles[0].text, context);
  const exports = context.module.exports;
  const workspace = {
    activeView: null,
    getActiveViewOfType(Type) { return this.activeView instanceof Type ? this.activeView : null; },
    on(name, callback) { return { name, callback }; },
  };
  const app = { workspace };
  const plugin = new exports.Plugin(app);
  return { ...exports, app, plugin, calls, MarkdownView,
    command(id) { return calls.commands.find(command => command.id === id); },
    setEditor({ text = 'one two one', selection = '', file = { path: 'folder/note.md', basename: 'note' } } = {}) {
      const cursorCalls = [];
      const editor = {
        getSelection: () => selection,
        getValue: () => text,
        offsetToPos(offset) {
          const lines = text.slice(0, offset).split('\n');
          return { line: lines.length - 1, ch: lines.at(-1).length };
        },
        setCursor(pos) { cursorCalls.push({ type: 'cursor', ...pos }); },
        scrollIntoView(range, center) { cursorCalls.push({ type: 'scroll', range, center }); },
      };
      workspace.activeView = Object.assign(new MarkdownView(), { editor, file });
      return { editor, view: workspace.activeView, cursorCalls };
    },
  };
}
function assertModule(name) {
  if (name !== 'obsidian') throw new Error(`Unexpected external module: ${name}`);
}
