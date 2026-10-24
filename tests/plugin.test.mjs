import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './helpers/pluginHarness.mjs';
import { readerHarness } from './helpers/reader-harness.mjs';
import { parseWords } from '../src/textParser.ts';

for (const sentence of [
  'Пусть x = 5 и y = 10 в расчёте.', 'Сравнение a == b в коде.',
  'Проверка `a = 1` в коде.', 'Проверка `a == b` в коде.',
  'Проверка ``a `nested` == b == c`` в коде.', 'Проверка ```a == b``` в коде.',
  'Обычный\nперенос строки.',
]) {
  test(`highlight equality survives reopening and repeated highlighting: ${sentence}`, async () => {
    const h = harness(); await h.plugin.onload();
    const source = sentence + ' Второе предложение.';
    const {editor, view} = h.setEditor({text: source});
    h.command('speed-read-whole-note').editorCallback(editor, view);
    const words = parseWords(source, h.plugin.settings);
    const count = parseWords(sentence, h.plugin.settings).length;
    const first = h.calls.modals.at(-1).onHighlightSentence;
    assert.equal(first(words[0], words[count - 1]), true);
    assert.equal(first(words[0], words[count - 1]), true);
    const highlighted = editor.getValue();
    assert.equal(highlighted, '==' + sentence + '== Второе предложение.');
    const reopened = parseWords(highlighted, h.plugin.settings);
    assert.deepEqual(reopened.map(w => w.raw), words.map(w => w.raw));
    h.command('speed-read-whole-note').editorCallback(editor, view);
    const second = h.calls.modals.at(-1).onHighlightSentence;
    assert.equal(second(reopened[0], reopened[count - 1]), true);
    assert.equal(editor.getValue(), highlighted);
    assert.equal(second(reopened[count], reopened.at(-1)), true);
    assert.equal(editor.getValue(), '==' + sentence + '== ==Второе предложение.==');
  });
}

for (const sentence of [
  'Первое предложение\n- с продолжением.', 'Первое предложение\n1. с продолжением.',
  'Первое предложение\n1) с продолжением.', 'Первое предложение\n> с продолжением.',
  'Первое предложение\n> [!note] продолжение.', 'Первое предложение\n# с продолжением.',
  '# Первое предложение\nс продолжением.', 'Первое предложение\n---\nс продолжением.',
  'Первое предложение\r\n- с продолжением.', 'Первое предложение\r\n\r\nс продолжением.',
  'Первое предложение\n```\nhidden\n```\nс продолжением.',
  'Первое предложение\n~~~\nhidden\n~~~\nс продолжением.',
  'Первое предложение\n\nс продолжением.', 'Первое предложение\n    код\nс продолжением.',
]) {
  test(`highlight refuses crossing Markdown block boundaries: ${JSON.stringify(sentence)}`, async () => {
    const h = harness(); await h.plugin.onload();
    const {editor, view} = h.setEditor({text: sentence});
    h.command('speed-read-whole-note').editorCallback(editor, view);
    const words = parseWords(sentence, h.plugin.settings);
    assert.equal(h.calls.modals[0].onHighlightSentence(words[0], words.at(-1)), false);
    assert.equal(editor.getValue(), sentence);
  });
}

for (const row of [
  '| Первый | второй. | Третий. |',
  'Первый | второй. | Третий.',
  '| Первый `a|b` | второй. | Третий. |',
]) {
  test(`highlight refuses crossing real table cells: ${row}`, async () => {
    const h = harness(); await h.plugin.onload();
    const source = '| A | B | C |\n| --- | --- | --- |\n' + row;
    const {editor, view} = h.setEditor({text: source});
    h.command('speed-read-whole-note').editorCallback(editor, view);
    const words = parseWords(source, h.plugin.settings);
    const first = words.find(w => w.raw === 'Первый');
    const last = words.find(w => w.raw === 'второй.');
    assert.equal(h.calls.modals[0].onHighlightSentence(first, last), false);
    assert.equal(editor.getValue(), source);
  });
}

for (const sentence of [
  'Обычный\nперенос строки.', 'Литерал `a|b` работает.',
  'Литерал a | b работает.', '[[target|Имя]] работает.',
  '# Заголовок.', '> Цитата.', '- Пункт.',
]) {
  test(`highlight permits local blocks and literal pipes: ${JSON.stringify(sentence)}`, async () => {
    const h = harness(); await h.plugin.onload();
    const {editor, view} = h.setEditor({text: sentence});
    h.command('speed-read-whole-note').editorCallback(editor, view);
    const words = parseWords(sentence, h.plugin.settings);
    assert.equal(h.calls.modals[0].onHighlightSentence(words[0], words.at(-1)), true);
    assert.deepEqual(parseWords(editor.getValue(), h.plugin.settings).map(w => w.raw), words.map(w => w.raw));
  });
}

test('highlight remains inside a single table cell', async () => {
  const source = '| A | B | C |\n| --- | --- | --- |\n| Первый. | второй. | Третий. |';
  const h = harness(); await h.plugin.onload();
  const {editor, view} = h.setEditor({text: source});
  h.command('speed-read-whole-note').editorCallback(editor, view);
  const word = parseWords(source, h.plugin.settings).find(w => w.raw === 'Первый.');
  assert.equal(h.calls.modals[0].onHighlightSentence(word, word), true);
  assert.equal(editor.getValue(), source.replace('Первый.', '==Первый.=='));
});

test('highlight allows an escaped pipe within a real table cell', async () => {
  const source = '| A | B | C |\n| --- | --- | --- |\n| Первый \\| второй. | Остальное | Третий. |';
  const h = harness(); await h.plugin.onload();
  const {editor, view} = h.setEditor({text: source});
  h.command('speed-read-whole-note').editorCallback(editor, view);
  const words = parseWords(source, h.plugin.settings);
  assert.equal(h.calls.modals[0].onHighlightSentence(words.find(w => w.raw.startsWith('Первый')), words.find(w => w.raw === 'второй.')), true);
  assert.equal(editor.getValue(), source.replace('Первый \\| второй.', '==Первый \\| второй.=='));
});

test('highlight refuses ambiguous unprotected delimiter runs instead of corrupting a reopened reader', async () => {
  const source = 'Проверка a==b.';
  const h = harness(); await h.plugin.onload();
  const {editor, view} = h.setEditor({text: source});
  h.command('speed-read-whole-note').editorCallback(editor, view);
  const words = parseWords(source, h.plugin.settings);
  assert.equal(h.calls.modals[0].onHighlightSentence(words[0], words.at(-1)), false);
  assert.equal(editor.getValue(), source);
});

const slash = String.fromCharCode(92);
for (const sentence of [
  'Сайт https://example.com/docs/page',
  'Сайт https://example.com/docs/page.',
  'https://example.com/docs/page.md?key=value#part.',
  '$x$', '$x$.', 'Считай $x$.',
  slash + '(x' + slash + ')',
  'Считай ' + slash + '(x' + slash + ').',
]) {
  test(`highlight preserves complete bare URLs and inline math: ${sentence}`, async () => {
    const h = harness(); await h.plugin.onload();
    const text = `${sentence} Второе предложение.`;
    const { editor, view } = h.setEditor({ text });
    h.command('speed-read-whole-note').editorCallback(editor, view);
    const words = parseWords(text, h.plugin.settings);
    const count = parseWords(sentence, h.plugin.settings).length;
    const highlight = h.calls.modals[0].onHighlightSentence;
    assert.equal(highlight(words[0], words[count - 1]), true);
    assert.equal(editor.getValue(), `==${sentence}== Второе предложение.`);
    assert.equal(highlight(words[count], words.at(-1)), true);
    assert.equal(editor.getValue(), `==${sentence}== ==Второе предложение.==`);
    assert.equal(highlight(words[0], words[count - 1]), true);
    assert.equal(editor.getValue(), `==${sentence}== ==Второе предложение.==`);
  });
}

for (const body of ['Array<string>', '$x$', '**bold**', 'operator++']) {
  test(`highlight preserves literal code punctuation at sentence end: ${body}`, async () => {
    const h = harness(); await h.plugin.onload();
    const sentence = 'Read `' + body + '`.';
    const text = sentence + ' Next sentence.';
    const { editor, view } = h.setEditor({ text });
    h.command('speed-read-whole-note').editorCallback(editor, view);
    const words = parseWords(text, h.plugin.settings);
    const highlight = h.calls.modals[0].onHighlightSentence;
    assert.equal(highlight(words[0], words[1]), true);
    assert.equal(editor.getValue(), '==' + sentence + '== Next sentence.');
    assert.equal(highlight(words[2], words[3]), true);
    assert.equal(editor.getValue(), '==' + sentence + '== ==Next sentence.==');
    assert.equal(highlight(words[0], words[1]), true);
    assert.equal(editor.getValue(), '==' + sentence + '== ==Next sentence.==');
  });
}

for (const sentence of [
  '«`$a`» работает.', '(`-v`) включает вывод.', '«`--flag`» работает.',
  '([--flag](https://example.com)) работает.', '«`(foo)`» работает.',
  '«`$a`».', '(`-v`).',
]) {
  test(`highlight preserves external leading punctuation before literal code: ${sentence}`, async () => {
    const h = harness(); await h.plugin.onload();
    const text = sentence + ' Next sentence.';
    const { editor, view } = h.setEditor({ text });
    h.command('speed-read-whole-note').editorCallback(editor, view);
    const words = parseWords(text, h.plugin.settings);
    const count = parseWords(sentence, h.plugin.settings).length;
    const highlight = h.calls.modals[0].onHighlightSentence;
    assert.equal(highlight(words[0], words[count - 1]), true);
    assert.equal(editor.getValue(), '==' + sentence + '== Next sentence.');
    assert.equal(highlight(words[count], words.at(-1)), true);
    assert.equal(editor.getValue(), '==' + sentence + '== ==Next sentence.==');
    assert.equal(highlight(words[0], words[count - 1]), true);
    assert.equal(editor.getValue(), '==' + sentence + '== ==Next sentence.==');
  });
}

for (const sentence of [
  'Тест ``value `nested` end``.', '``value `nested` end``.',
  '``a b``.', 'Read ```Array<string>```.',
  '``https://example.com/docs/page $x$`` потом.',
]) {
  test(`highlight uses exact-length backtick wrappers: ${sentence}`, async () => {
    const h = harness(); await h.plugin.onload();
    const text = sentence + ' Next sentence.';
    const { editor, view } = h.setEditor({ text });
    h.command('speed-read-whole-note').editorCallback(editor, view);
    const words = parseWords(text, h.plugin.settings);
    const count = parseWords(sentence, h.plugin.settings).length;
    const highlight = h.calls.modals[0].onHighlightSentence;
    assert.ok(count > 0);
    assert.equal(highlight(words[0], words[count - 1]), true);
    assert.equal(editor.getValue(), '==' + sentence + '== Next sentence.');
    assert.equal(highlight(words[count], words.at(-1)), true);
    assert.equal(editor.getValue(), '==' + sentence + '== ==Next sentence.==');
    assert.equal(highlight(words[0], words[count - 1]), true);
    assert.equal(editor.getValue(), '==' + sentence + '== ==Next sentence.==');
  });
}

test('shared code wrappers ignore YAML backticks and preserve original source offsets', async () => {
  for (const newline of [String.fromCharCode(10), String.fromCharCode(13, 10)]) {
    for (const yaml of ['title: `unmatched', 'title: metadata' + newline + '```js']) {
      const h = harness(); await h.plugin.onload();
      const metadata = ['---', yaml, '---', ''].join(newline) + newline;
      const text = metadata + 'Read `Array<string>`. Next sentence.';
      const { editor, view } = h.setEditor({ text });
      h.command('speed-read-whole-note').editorCallback(editor, view);
      const words = parseWords(text, h.plugin.settings);
      assert.equal(h.calls.modals[0].onHighlightSentence(words[0], words[1]), true);
      assert.equal(editor.getValue(), metadata + '==Read `Array<string>`.== Next sentence.');
    }
  }
});

test('highlight does not join sentences through intraword underscores', async () => {
  const h = harness(); await h.plugin.onload();
  const text = 'Значение a_b в начале. А тут c_d в конце.';
  const { editor, view } = h.setEditor({ text });
  h.command('speed-read-whole-note').editorCallback(editor, view);
  const words = parseWords(text, h.plugin.settings);
  const highlight = h.calls.modals[0].onHighlightSentence;
  assert.equal(highlight(words[0], words[3]), true);
  assert.equal(editor.getValue(), '==Значение a_b в начале.== А тут c_d в конце.');
  assert.equal(highlight(words[4], words.at(-1)), true);
  assert.equal(editor.getValue(), '==Значение a_b в начале.== ==А тут c_d в конце.==');
  assert.equal(highlight(words[0], words[3]), true);
  assert.equal(editor.getValue(), '==Значение a_b в начале.== ==А тут c_d в конце.==');
});

for (const sentence of [
  'Слово[^1].', 'Первое слово<!--скрыто-->.',
  'Первое слово%%скрыто%%.', '«Слово»[^1]<!--скрыто-->.',
]) {
  test(`highlight maps punctuation across hidden syntax: ${sentence}`, async () => {
    const h = harness(); await h.plugin.onload();
    const text = sentence + ' Второе предложение.';
    const { editor, view } = h.setEditor({ text });
    h.command('speed-read-whole-note').editorCallback(editor, view);
    const words = parseWords(text, h.plugin.settings);
    const count = parseWords(sentence, h.plugin.settings).length;
    const highlight = h.calls.modals[0].onHighlightSentence;
    assert.equal(highlight(words[0], words[count - 1]), true);
    assert.equal(editor.getValue(), '==' + sentence + '== Второе предложение.');
    assert.equal(highlight(words[count], words.at(-1)), true);
    assert.equal(editor.getValue(), '==' + sentence + '== ==Второе предложение.==');
    assert.equal(highlight(words[0], words[count - 1]), true);
    assert.equal(editor.getValue(), '==' + sentence + '== ==Второе предложение.==');
  });
}

const plain = value => JSON.parse(JSON.stringify(value));

for (const sentence of [
  '**Первое** **предложение.**',
  '*«**Слово**»* работает.',
  '**«*Слово*»** работает.',
  '«**Первое** **предложение**.»',
  '**Пер**вое пред**ложение**.',
  '[[note|Первое]] [предложение.](https://example.com)',
]) {
  test(`highlight preserves Markdown boundary wrappers: ${sentence}`, async () => {
    const h = harness(); await h.plugin.onload();
    const text = `${sentence} Второе предложение.`;
    const { editor, view } = h.setEditor({ text });
    h.command('speed-read-whole-note').editorCallback(editor, view);
    const words = parseWords(text, h.plugin.settings);
    const highlight = h.calls.modals[0].onHighlightSentence;
    assert.equal(highlight(words[0], words[1]), true);
    assert.equal(editor.getValue(), `==${sentence}== Второе предложение.`);
    assert.equal(highlight(words[2], words[3]), true);
    assert.equal(editor.getValue(), `==${sentence}== ==Второе предложение.==`);
    assert.equal(highlight(words[0], words[1]), true);
    assert.equal(editor.getValue(), `==${sentence}== ==Второе предложение.==`);
  });
}

test('onload registers commands, ribbon, settings and menu once without writes', async () => {
  const h = harness(); await h.plugin.onload();
  assert.deepEqual(h.calls.commands.map(c => c.id), ['speed-read-current', 'speed-read-selection', 'speed-read-whole-note', 'speed-read-from-cursor', 'speed-reader-stats', 'speed-reader-test-tts', 'speed-reader-self-check']);
  assert.equal(h.calls.ribbons.length, 1);
  assert.equal(h.calls.tabs.length, 1);
  assert.deepEqual(h.calls.events.map(e => e.name), ['editor-menu', 'active-leaf-change']);
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

test('loaded malformed speech usage cannot crash the settings renderer', async () => {
  for (const value of [null, 'oops', -1, NaN, Infinity, {}, []]) {
    const h = harness({ unrealSpeechCharsUsed: value });
    await h.plugin.onload();
    const tab = h.calls.tabs[0];
    const usage = tab.getSettingDefinitions().flatMap(group => group.items ?? [group])
      .find(item => item.aliases?.includes('unrealSpeechCharsUsed'));
    const el = { empty() {}, createDiv() { return el; }, setText() {} };
    assert.doesNotThrow(() => usage.render({ descEl: el, addButton() {} }));
    assert.equal(h.plugin.settings.unrealSpeechCharsUsed, 0);
    assert.equal(h.calls.saves.length, 0);
  }
  const valid = harness({ unrealSpeechCharsUsed: 12345 });
  await valid.plugin.loadSettings();
  assert.equal(valid.plugin.settings.unrealSpeechCharsUsed, 12345);
});

test('malformed saved preferences fall back without overwriting valid values', async () => {
  const invalid = {
    unrealSpeechApiKey: null, unrealSpeechVoiceId: {}, uiLanguage: 'xx',
    ttsProvider: 'unknown', readerFont: 'missing', themeMode: 'neon', redicleAlignment: null,
    defaultWpm: NaN, fontSize: -1, chunkSize: 0, orpWidth: 9,
    stepWordCount: 'oops', rampUpWords: null, autoAccelerateIntervalWords: 0,
    sentencePauseMultiplier: Infinity, orpColor: null, readCodeBlocks: 'yes',
    highlightOrp: null, rememberProgress: [], enableTts: {},
  };
  const h = harness({ ...invalid, showPauseStats: false, unrealSpeechCharsUsed: 123 });
  await h.plugin.onload();
  for (const key of Object.keys(invalid)) assert.equal(h.plugin.settings[key], h.DEFAULT_SETTINGS[key], key);
  assert.equal(h.plugin.settings.showPauseStats, false);
  assert.equal(h.plugin.settings.unrealSpeechCharsUsed, 123);
  await assert.doesNotReject(() => h.plugin.testUnrealSpeech());
  assert.equal(h.calls.saves.length, 0);
});

test('fractional saved rewind counts cannot produce fractional reader positions', async () => {
  for (const rewindOnPauseWords of [1.5, Number.MAX_VALUE]) {
    const h = harness({ rewindOnPauseWords });
    await h.plugin.loadSettings();
    const reader = readerHarness('one two three four five six seven eight', h.plugin.settings);
    reader.modal.togglePlay();
    for (let index = 0; index < 5; index++) reader.tick();
    reader.modal.pause(true);
    assert.ok(Number.isInteger(reader.modal.currentIndex), 'rewind must keep an integer word index');
    assert.doesNotThrow(() => reader.modal.togglePlay());
    reader.modal.onClose();
    assert.equal(h.plugin.settings.rewindOnPauseWords, h.DEFAULT_SETTINGS.rewindOnPauseWords);
  }
});

test('saved word counts reject fractional values without discarding valid counts', async () => {
  for (const key of ['rewindOnPauseWords', 'rampUpWords', 'autoAccelerateIntervalWords', 'stepWordCount']) {
    const invalid = harness({ [key]: 1.5 }); await invalid.plugin.loadSettings();
    assert.equal(invalid.plugin.settings[key], invalid.DEFAULT_SETTINGS[key], key);
    const valid = harness({ [key]: 5 }); await valid.plugin.loadSettings();
    assert.equal(valid.plugin.settings[key], 5, key);
  }
});

test('saved progress retains only valid independent records', async () => {
  const good = { index: 2, totalWords: 10, timestamp: 5 };
  const noteProgress = {
    good, complete: { index: 10, totalWords: 10, timestamp: 0 },
    nil: null, text: 'bad', array: [], negative: { ...good, index: -1 },
    fraction: { ...good, index: 1.5 }, future: { ...good, index: 11 },
    invalidTotal: { ...good, totalWords: NaN }, invalidTime: { ...good, timestamp: Infinity },
  };
  const h = harness({ noteProgress }); await h.plugin.loadSettings();
  assert.deepEqual(plain(h.plugin.settings.noteProgress), { good, complete: noteProgress.complete });
  h.plugin.settings.noteProgress.good.index = 4;
  assert.equal(good.index, 2, 'loaded progress records must not alias persisted data');
  for (const value of [null, 'bad', [], 3]) {
    const fresh = harness({ noteProgress: value }); await fresh.plugin.loadSettings();
    assert.deepEqual(plain(fresh.plugin.settings.noteProgress), {});
  }
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

test('highlight range wraps the whole quoted sentence including edge punctuation', async () => {
  const h = harness(); await h.plugin.onload();
  const text = 'Первое предложение. «Второе слово здесь.» Третье.';
  h.setEditor({ text });
  h.command('speed-read-whole-note').editorCallback(h.app.workspace.activeView.editor, h.app.workspace.activeView);
  const modal = h.calls.modals[0];
  const start = { raw: '«Второе', prefix: '«В', focusChar: 'т', suffix: 'орое', delayMultiplier: 1, charOffset: text.indexOf('Второе') };
  const end = { raw: 'здесь.»', prefix: 'зд', focusChar: 'е', suffix: 'сь.»', delayMultiplier: 1, charOffset: text.indexOf('здесь') };
  const applied = modal.onHighlightSentence(start, end, 'Второе слово здесь.');
  assert.equal(applied, true);
  const edit = h.calls.modals.length && h.app.workspace.activeView.editor;
  assert.ok(modal);
  assert.equal(edit.getValue(), 'Первое предложение. ==«Второе слово здесь.»== Третье.');
});

test('speed read from Cursor starts at the word under the editor cursor', async () => {
  const h = harness(); await h.plugin.onload();
  h.setEditor({ text: 'one two three four', cursor: { line: 0, ch: 8 } });
  h.command('speed-read-from-cursor').editorCallback(h.app.workspace.activeView.editor, h.app.workspace.activeView);
  assert.equal(h.calls.modals.length, 1);
  assert.equal(h.calls.modals[0].initialIndex, 2);
});

test('highlight leaves an already highlighted sentence unchanged', async () => {
  const h = harness(); await h.plugin.onload();
  const text = '==**Первое** предложение.== Второе предложение.';
  const { editor, view, edits } = h.setEditor({ text });
  h.command('speed-read-whole-note').editorCallback(editor, view);
  const words = parseWords(text, h.plugin.settings);
  const highlight = h.calls.modals[0].onHighlightSentence;
  assert.equal(highlight(words[0], words[1]), true);
  assert.equal(editor.getValue(), text);
  assert.equal(edits.length, 0);
  assert.equal(highlight(words[2], words[3]), true);
  assert.equal(editor.getValue(), '==**Первое** предложение.== ==Второе предложение.==');
});

test('stale readers refuse edits and cursor sync instead of matching another occurrence', async () => {
  const h = harness(); await h.plugin.onload();
  const text = 'Первое предложение. Второе предложение.';
  const { editor, view, cursorCalls, edits } = h.setEditor({ text });
  h.command('speed-read-whole-note').editorCallback(editor, view);
  const first = h.calls.modals[0];
  h.command('speed-read-whole-note').editorCallback(editor, view);
  const second = h.calls.modals[1];
  const words = parseWords(text, h.plugin.settings);
  assert.equal(first.onHighlightSentence(words[0], words[1]), true);
  assert.equal(second.onHighlightSentence(words[2], words[3]), false, 'other reader snapshot is stale');
  editor.setValue(`Другое предложение. ${editor.getValue()}`);
  const changed = editor.getValue();
  assert.equal(first.onHighlightSentence(words[2], words[3]), false);
  first.onSyncCursor(2, words[2].raw, words[2].charOffset);
  first.onSyncCursor(2, words[2].raw);
  assert.equal(editor.getValue(), changed);
  assert.equal(edits.length, 1);
  assert.equal(cursorCalls.length, 0);
});

for (const entry of ['whole-note', 'current', 'from-cursor']) {
  test(`${entry} highlights successive sentences using original modal offsets and syncs the cursor`, async () => {
    const h = harness(); await h.plugin.onload();
    const text = 'Первое предложение. Второе предложение. Третье.';
    const { editor, view, cursorCalls, edits } = h.setEditor({ text });
    if (entry === 'current') h.command('speed-read-current').checkCallback(false);
    else h.command(`speed-read-${entry}`).editorCallback(editor, view);
    const modal = h.calls.modals[0];
    const words = parseWords(text, h.plugin.settings);
    assert.equal(modal.onHighlightSentence(words[0], words[1]), true);
    assert.equal(modal.onHighlightSentence(words[2], words[3]), true);
    assert.equal(editor.getValue(), '==Первое предложение.== ==Второе предложение.== Третье.');
    assert.equal(modal.onHighlightSentence(words[0], words[1]), true);
    assert.equal(modal.onHighlightSentence(words[2], words[3]), true);
    assert.equal(edits.length, 2, 'repeated highlights are idempotent');
    modal.onSyncCursor(4, words[4].raw, words[4].charOffset);
    assert.deepEqual(cursorCalls[0], { type: 'cursor', line: 0, ch: editor.getValue().indexOf('Третье') });
  });
}
