import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './helpers/pluginHarness.mjs';

const plain = value => JSON.parse(JSON.stringify(value));

test('onload registers commands, ribbon, settings and menu once without writes', async () => {
  const h = harness(); await h.plugin.onload();
  assert.deepEqual(h.calls.commands.map(c => c.id), ['speed-read-current', 'speed-read-selection', 'speed-read-whole-note', 'speed-reader-stats', 'speed-reader-self-check']);
  assert.equal(h.calls.ribbons.length, 1);
  assert.equal(h.calls.tabs.length, 1);
  assert.equal(h.calls.events.length, 1);
  assert.equal(h.calls.events[0].name, 'editor-menu');
  assert.equal(h.calls.saves.length, 0);
});

test('current command check is side-effect free and rejects non-Markdown views', async () => {
  const h = harness(); await h.plugin.onload();
  const command = h.command('speed-read-current');
  assert.equal(command.checkCallback(true), false);
  h.app.workspace.activeView = {};
  assert.equal(command.checkCallback(false), false);
  h.setEditor();
  assert.equal(command.checkCallback(true), true);
  assert.equal(h.calls.modals.length, 0);
  assert.equal(h.calls.notices.length, 0);
  assert.equal(command.checkCallback(false), true);
  assert.equal(h.calls.modals[0].noteKey, 'folder/note.md');
});

for (const entry of ['current', 'ribbon', 'selection', 'menu']) {
  test(`${entry} reads only selection without progress persistence or cursor callback`, async () => {
    const h = harness(); await h.plugin.onload();
    const { editor, view } = h.setEditor({ text: 'whole note', selection: ' selected text ' });
    if (entry === 'current') h.command('speed-read-current').checkCallback(false);
    if (entry === 'ribbon') h.calls.ribbons[0].callback();
    if (entry === 'selection') h.command('speed-read-selection').editorCallback(editor, view);
    if (entry === 'menu') {
      let clicked;
      const item = { setTitle(value) { assert.equal(value, 'Speed read selection'); return this; }, setIcon(value) { assert.equal(value, 'book-open'); return this; }, onClick(callback) { clicked = callback; return this; } };
      h.calls.events[0].callback({ addItem(callback) { callback(item); } }, editor, view);
      assert.equal(h.calls.modals.length, 0); clicked();
    }
    const modal = h.calls.modals[0];
    assert.equal(h.calls.modals.length, 1);
    assert.equal(modal.text, ' selected text ');
    assert.equal(modal.title, 'Selection in note');
    assert.equal(modal.noteKey, '');
    assert.equal(modal.onSyncCursor, undefined);
  });
}

test('whole-note ignores selection and synchronizes exact repeated occurrence', async () => {
  const h = harness(); await h.plugin.onload();
  const { editor, view, cursorCalls } = h.setEditor({ text: 'one\ntwo one', selection: 'two' });
  h.command('speed-read-whole-note').editorCallback(editor, view);
  const modal = h.calls.modals[0];
  assert.equal(modal.text, 'one\ntwo one');
  assert.equal(modal.title, 'note');
  assert.equal(modal.noteKey, 'folder/note.md');
  modal.onSyncCursor(2, 'one', 8);
  assert.deepEqual(cursorCalls[0], { type: 'cursor', line: 1, ch: 4 });
  assert.equal(cursorCalls[1].center, true);
  assert.deepEqual(plain(cursorCalls[1].range), { from: { line: 1, ch: 4 }, to: { line: 1, ch: 4 } });
});

test('cursor fallback strips punctuation and skips unmappable words', async () => {
  const h = harness(); await h.plugin.onload();
  const { editor, view, cursorCalls } = h.setEditor({ text: 'hello мир!' });
  h.command('speed-read-whole-note').editorCallback(editor, view);
  const sync = h.calls.modals[0].onSyncCursor;
  sync(0, '«мир!»');
  assert.deepEqual(cursorCalls[0], { type: 'cursor', line: 0, ch: 6 });
  for (const word of ['...', 'missing', '']) sync(0, word);
  assert.equal(cursorCalls.length, 2);
});

test('blank selection is rejected by selection command and omitted from menu', async () => {
  const h = harness(); await h.plugin.onload();
  const { editor, view } = h.setEditor({ selection: '   ' });
  h.command('speed-read-selection').editorCallback(editor, view);
  assert.match(h.calls.notices[0].message, /No text selected/);
  let menuItems = 0;
  h.calls.events[0].callback({ addItem() { menuItems++; } }, editor, view);
  assert.equal(menuItems, 0);
  assert.equal(h.calls.modals.length, 0);
  h.command('speed-read-current').checkCallback(false);
  assert.equal(h.calls.modals[0].text, 'one two one');
});

test('empty notes and missing active view produce notices rather than modals', async () => {
  const h = harness(); await h.plugin.onload();
  h.calls.ribbons[0].callback();
  assert.match(h.calls.notices[0].message, /No active Markdown/);
  const { editor, view } = h.setEditor({ text: '   ' });
  h.calls.ribbons[0].callback();
  h.command('speed-read-whole-note').editorCallback(editor, view);
  assert.equal(h.calls.notices.length, 3);
  assert.match(h.calls.notices[1].message, /empty/);
  assert.match(h.calls.notices[2].message, /empty/);
  assert.equal(h.calls.modals.length, 0);
});

test('whole-note identity falls back to basename or safe missing-file title', async () => {
  const h = harness(); await h.plugin.onload();
  for (const [file, key] of [[{ basename: 'fallback' }, 'fallback'], [null, 'Active Note']]) {
    const { editor, view } = h.setEditor({ file });
    h.command('speed-read-whole-note').editorCallback(editor, view);
    assert.equal(h.calls.modals.at(-1).noteKey, key);
  }
});

test('statistics command reports stored counters in a long-lived notice', async () => {
  const h = harness({ stats: { totalWordsRead: 600, totalSecondsRead: 60, maxWpm: 700, sessionsCount: 2 } });
  await h.plugin.onload(); h.command('speed-reader-stats').callback();
  assert.equal(h.calls.notices[0].duration, 8000);
  assert.match(h.calls.notices[0].message, /600/);
  assert.match(h.calls.notices[0].message, /700 WPM/);
  assert.match(h.calls.notices[0].message, /2 сессий/);
});

test('preferences, statistics and progress persist through save and reload', async () => {
  const h = harness(); await h.plugin.loadSettings();
  const tab = new h.SpeedReaderSettingTab(h.app, h.plugin);
  await tab.setControlValue('chunkSize', '3');
  await tab.setControlValue('readerFont', 'golos');
  h.plugin.settings.stats.totalWordsRead = 42;
  h.plugin.settings.noteProgress['note.md'] = { index: 3, totalWords: 9, timestamp: 7 };
  await h.plugin.saveSettings();
  const reloaded = harness(h.calls.saves.at(-1)); await reloaded.plugin.loadSettings();
  assert.deepEqual(plain(reloaded.plugin.settings), plain(h.plugin.settings));
  assert.equal(reloaded.plugin.settings.chunkSize, 3);
  assert.equal(h.calls.saves.length, 3);
});

test('fresh installations do not mutate shared defaults or other installations', async () => {
  const h = harness();
  const first = h.plugin;
  const second = new h.Plugin(h.app);
  await first.loadSettings();
  await second.loadSettings();
  first.settings.stats.totalWordsRead = 99;
  first.settings.noteProgress['note.md'] = { index: 1, totalWords: 3, timestamp: 1 };
  assert.equal(second.settings.stats.totalWordsRead, 0);
  assert.deepEqual(Object.keys(second.settings.noteProgress), []);
  assert.deepEqual(Object.keys(h.DEFAULT_SETTINGS.noteProgress), []);
});

test('loaded malformed statistics cannot break analytics commands', async () => {
  const h = harness({ stats: { totalWordsRead: null, totalSecondsRead: 'oops', maxWpm: -5, sessionsCount: -1 } });
  await h.plugin.onload();
  assert.deepEqual(plain(h.plugin.settings.stats), plain(h.DEFAULT_SETTINGS.stats));
  assert.doesNotThrow(() => h.command('speed-reader-stats').callback());
});

test('load merges legacy partial statistics without losing counters', async () => {
  const h = harness({ defaultWpm: 500, stats: { totalWordsRead: 123 }, noteProgress: { 'note.md': { index: 2, totalWords: 10, timestamp: 5 } } });
  await h.plugin.loadSettings();
  assert.deepEqual(plain(h.plugin.settings.stats), { totalWordsRead: 123, totalSecondsRead: 0, maxWpm: 0, sessionsCount: 0 });
  assert.equal(h.plugin.settings.defaultWpm, 500);
  assert.equal(h.plugin.settings.readerFont, 'theme');
  assert.equal(h.plugin.settings.noteProgress['note.md'].index, 2);
});

test('self-check command exists and reports pure checks as OK', async () => {
  const h = harness();
  await h.plugin.onload();
  assert.ok(h.command('speed-reader-self-check'), 'self-check command must be registered');
  const results = h.plugin.runSelfCheck();
  assert.ok(results.length >= 5, `expected at least 5 checks, got ${results.length}`);
  assert.equal(results.filter(result => result.status !== 'ok').length, 0);
});
test('self-check notice reports failures with their names', async () => {
  const h = harness();
  await h.plugin.onload();
  const failing = {
    name: 'тайминги',
    status: 'fail',
    detail: 'демонстрационная ошибка',
  };
  const original = h.plugin.runSelfCheck.bind(h.plugin);
  h.plugin.runSelfCheck = () => [failing, ...original()];
  await h.plugin.showSelfCheck();
  const notice = h.calls.notices.at(-1);
  assert.match(notice.message, /1 ошибок/);
  assert.match(notice.message, /тайминги: демонстрационная ошибка/);
  assert.equal(h.calls.closed, 1, 'self-check must close its probe window');
});

test('self-check success notice counts only verified steps', async () => {
  const h = harness();
  await h.plugin.onload();
  await h.plugin.showSelfCheck();
  const messages = h.calls.notices.map(notice => notice.message);
  assert.ok(messages.some(message => /OK$/.test(message)), `expected an OK notice, got ${JSON.stringify(messages)}`);
  assert.ok(messages.some(message => /пропущено/.test(message)), 'DOM-less harness must report the skipped window check');
});
