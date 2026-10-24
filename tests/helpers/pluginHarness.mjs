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
    constructor(app, plugin, text, title, noteKey = '', callbacksOrSync) {
      const callbacks = typeof callbacksOrSync === 'function' ? { onSyncCursor: callbacksOrSync } : (callbacksOrSync || {});
      Object.assign(this, {
        app, plugin, text, title, noteKey,
        onSyncCursor: callbacks.onSyncCursor,
        onHighlightSentence: callbacks.onHighlightSentence,
        initialIndex: callbacks.initialIndex,
      });
    }
    open() { calls.modals.push(this); }
    close() { calls.closed = (calls.closed ?? 0) + 1; }
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
    setEditor({ text = 'one two one', selection = '', cursor = { line: 0, ch: 0 }, file = { path: 'folder/note.md', basename: 'note' } } = {}) {
      const cursorCalls = [];
      const edits = [];
      let value = text;
      const editor = {
        getSelection: () => selection,
        getValue: () => value,
        getCursor: () => ({ ...cursor }),
        posToOffset(pos) {
          const lines = value.split('\n');
          let offset = 0;
          for (let i = 0; i < pos.line && i < lines.length; i++) offset += lines[i].length + 1;
          return offset + pos.ch;
        },
        offsetToPos(offset) {
          const lines = value.slice(0, offset).split('\n');
          return { line: lines.length - 1, ch: lines.at(-1).length };
        },
        setCursor(pos) { cursorCalls.push({ type: 'cursor', ...pos }); },
        scrollIntoView(range, center) { cursorCalls.push({ type: 'scroll', range, center }); },
        replaceRange(replacement, from, to) {
          edits.push({ replacement, from, to });
          const start = editor.posToOffset(from);
          const end = editor.posToOffset(to);
          value = value.slice(0, start) + replacement + value.slice(end);
        },
        setValue(next) { value = next; },
      };
      workspace.activeView = Object.assign(new MarkdownView(), { editor, file });
      return { editor, view: workspace.activeView, cursorCalls, edits, getValue: () => value };
    },
  };
}
function assertModule(name) {
  if (name !== 'obsidian') throw new Error(`Unexpected external module: ${name}`);
}
