import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';

const result = await build({
  entryPoints: [new URL('../src/settings.ts', import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, '')],
  bundle: true, write: false, format: 'cjs', platform: 'node', external: ['obsidian'],
});
class PluginSettingTab {
  constructor(app, plugin) { this.plugin = plugin; }
  getControlValue(key) { return this.plugin.settings[key]; }
  async setControlValue(key, value) {
    this.plugin.settings[key] = value;
    await this.plugin.saveData(this.plugin.settings);
  }
}
const context = { module: { exports: {} }, require: () => ({ PluginSettingTab }) };
vm.runInNewContext(result.outputFiles[0].text, context);
const { SpeedReaderSettingTab, DEFAULT_SETTINGS } = context.module.exports;
const make = () => {
  let saves = 0;
  const snapshots = [];
  const plugin = { settings: structuredClone(DEFAULT_SETTINGS), saveData: async value => { saves++; snapshots.push(structuredClone(value)); } };
  return { tab: new SpeedReaderSettingTab({}, plugin), plugin, saves: () => saves, snapshots };
};

test('declarative settings preserve existing controls with valid keys and defaults', () => {
  const { tab } = make();
  const items = tab.getSettingDefinitions().flatMap(group => group.items);
  const controls = items.filter(item => item.control).map(item => item.control);
  const keys = controls.map(control => control.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const control of controls) assert.ok(control.key in DEFAULT_SETTINGS);
  for (const key of ['defaultWpm', 'fontSize', 'readerFont', 'orpWidth', 'orpColor', 'showPauseStats', 'chunkSize', 'enableTts', 'rememberProgress']) {
    assert.ok(keys.includes(key), `Missing searchable setting: ${key}`);
  }
  assert.equal(typeof tab.display, 'undefined');
});

test('numeric dropdowns round-trip as numbers in storage and strings in controls', async () => {
  const { tab, plugin, saves } = make();
  await tab.setControlValue('chunkSize', '3');
  await tab.setControlValue('orpWidth', '2');
  assert.equal(plugin.settings.chunkSize, 3);
  assert.equal(plugin.settings.orpWidth, 2);
  assert.equal(tab.getControlValue('chunkSize'), '3');
  assert.equal(tab.getControlValue('orpWidth'), '2');
  assert.equal(saves(), 2);
});

test('slider writes clamp bounds and reject non-numeric values before persistence', async () => {
  const { tab, plugin } = make();
  for (const [key, low, high] of [['defaultWpm', 100, 1000], ['fontSize', 24, 72], ['rampUpWords', 5, 40], ['rewindOnPauseWords', 1, 10]]) {
    await tab.setControlValue(key, low - 100);
    assert.equal(plugin.settings[key], low, `${key} minimum`);
    await tab.setControlValue(key, high + 100);
    assert.equal(plugin.settings[key], high, `${key} maximum`);
    for (const invalid of [NaN, Infinity, '300', null]) {
      await tab.setControlValue(key, invalid);
      assert.equal(plugin.settings[key], DEFAULT_SETTINGS[key], `${key} invalid ${invalid}`);
    }
  }
});

test('all declarative controls round-trip their defaults and persist valid alternative values', async () => {
  const { tab, plugin, snapshots } = make();
  const controls = tab.getSettingDefinitions().flatMap(group => group.items).filter(item => item.control).map(item => item.control);
  for (const control of controls) {
    assert.equal(tab.getControlValue(control.key), control.defaultValue, control.key);
    let next;
    if (control.type === 'toggle') next = !control.defaultValue;
    else if (control.type === 'slider') next = control.max;
    else if (control.type === 'dropdown') next = Object.keys(control.options).at(-1);
    else next = ' #123456 ';
    await tab.setControlValue(control.key, next);
    const expected = ['chunkSize', 'orpWidth'].includes(control.key) ? Number(next) : control.type === 'text' ? next.trim() : next;
    assert.equal(plugin.settings[control.key], expected, control.key);
    assert.equal(snapshots.at(-1)[control.key], expected, `persisted ${control.key}`);
  }
  assert.equal(snapshots.length, controls.length);
});

test('analytics renderer renders four counters and reset persists only a fresh stats object', async () => {
  const { harness } = await import('./helpers/pluginHarness.mjs');
  const h = harness(); await h.plugin.onload();
  const tab = h.calls.tabs[0];
  h.plugin.settings.stats = { totalWordsRead: 600, totalSecondsRead: 60, maxWpm: 700, sessionsCount: 2 };
  h.plugin.settings.noteProgress['note.md'] = { index: 2, totalWords: 5, timestamp: 1 };
  const [analytics, reset] = tab.getSettingDefinitions()[0].items;
  const lines = [];
  let emptied = false;
  analytics.render({ descEl: { empty() { emptied = true; }, createDiv() { return { createDiv(options) { lines.push(options.text); } }; } } });
  assert.equal(emptied, true);
  assert.equal(lines.length, 4);
  assert.match(lines.join('\n'), /600/);
  assert.match(lines.join('\n'), /700 WPM/);
  let clicked;
  let destructive = false;
  const button = { setButtonText() { return this; }, setDestructive() { destructive = true; return this; }, onClick(callback) { clicked = callback; return this; } };
  reset.render({ addButton(callback) { callback(button); } });
  assert.equal(destructive, true);
  await clicked();
  assert.deepEqual(JSON.parse(JSON.stringify(h.plugin.settings.stats)), JSON.parse(JSON.stringify(h.DEFAULT_SETTINGS.stats)));
  assert.notEqual(h.plugin.settings.stats, h.DEFAULT_SETTINGS.stats);
  assert.equal(h.calls.saves.length, 1);
  assert.equal(h.calls.saves[0].noteProgress['note.md'].index, 2);
  assert.equal(h.calls.saves[0].stats.totalWordsRead, 0);
  assert.equal(tab.updates, 1);
});

test('settings normalization handles invalid dropdown values and blank colors', async () => {
  const { tab, plugin } = make();
  await tab.setControlValue('chunkSize', 'invalid');
  await tab.setControlValue('readerFont', 'unknown');
  await tab.setControlValue('orpColor', '   ');
  assert.equal(plugin.settings.chunkSize, 1);
  assert.equal(plugin.settings.readerFont, 'theme');
  assert.equal(plugin.settings.orpColor, DEFAULT_SETTINGS.orpColor);
});
