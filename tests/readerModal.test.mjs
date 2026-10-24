import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readerHarness } from './helpers/reader-harness.mjs';

test('closing a manually sought note persists the position even without playback', () => {
  const h = readerHarness(); h.modal.goToWord(3); h.modal.onClose();
  assert.equal(h.settings.noteProgress['book.md'].index, 3);
  assert.ok(h.saves.some(data => data.noteProgress['book.md']?.index === 3), 'Position must reach plugin saveSettings');
});

test('single-word note is displayed for its duration and counted before completion', () => {
  const h = readerHarness('Привет', { enableRampUp: false }); h.modal.togglePlay();
  assert.equal(h.timers.size, 1, 'Last word must not finish instantly');
  h.tick(); assert.equal(h.modal.isPlaying, false); assert.equal(h.modal.sessionWordsRead, 1);
});

test('TTS speaks only the current sentence, not the next sentence first word', () => {
  const h = readerHarness('Первое предложение. Второе предложение.', { enableTts: true });
  h.modal.togglePlay(); assert.equal(h.spoken[0].text, 'Первое предложение.');
});

test('session analytics excludes time spent on pause', () => {
  const h = readerHarness('Один два три четыре пять шесть семь восемь', { enableRampUp: false });
  h.modal.togglePlay(); for (let i = 0; i < 5; i++) h.tick();
  h.modal.pause(false); const activeSeconds = Math.round(h.modal.activeMs / 1000);
  h.advance(120000); h.modal.onClose();
  assert.equal(h.settings.stats.totalSecondsRead, activeSeconds);
});


test('disabling ORP highlighting restores normal text color', () => {
  const h = readerHarness('Привет мир', { highlightOrp: false });
  assert.equal(h.modal.focusEl.style.color, 'var(--text-normal)');
});


test('chunks receive the sum of their word durations instead of single-word speed', () => {
  const h = readerHarness('один два три четыре', { chunkSize: 3, enableRampUp: false, spritzVariableTiming: false });
  h.modal.togglePlay(); assert.equal([...h.timers.values()][0].delay, 600);
  h.tick(); assert.equal(h.modal.currentIndex, 3); h.tick();
  assert.equal(h.modal.sessionWordsRead, 4); assert.equal(h.modal.isPlaying, false);
});


test('pause immediately flushes progress below the autosave interval', () => {
  const h = readerHarness(); h.modal.togglePlay(); h.tick(); h.modal.pause(true);
  assert.ok(h.saves.some(data => data.noteProgress['book.md']?.index === h.modal.currentIndex));
});


test('empty notes show a close action and no timer', () => {
  const h = readerHarness('   '); assert.match(h.modal.contentEl.textContent, /No readable words/);
  h.button('Close').onclick(); assert.equal(h.modal.closed, true); assert.equal(h.timers.size, 0);
});

test('navigation buttons clamp to bounds and sentence controls move between sentences', () => {
  const h = readerHarness(); h.button('Вперед на').onclick(); assert.equal(h.modal.currentIndex, 5);
  h.button('Назад на').onclick(); assert.equal(h.modal.currentIndex, 0);
  h.button('Следующее предложение').onclick(); assert.equal(h.modal.currentIndex, 3);
  h.button('Предыдущее предложение').onclick(); assert.equal(h.modal.currentIndex, 0);
});

test('keyboard supports Cyrillic shortcuts and ignores modified or composing input', () => {
  const h = readerHarness(); const before = h.modal.currentWpm;
  h.key('ArrowUp'); assert.equal(h.modal.currentWpm, before + 25);
  h.key('ArrowDown'); assert.equal(h.modal.currentWpm, before);
  assert.equal(h.key('ArrowUp', { ctrlKey: true }), true); assert.equal(h.modal.currentWpm, before);
  assert.equal(h.key(' ', { isComposing: true }), true); assert.equal(h.modal.isPlaying, false);
  h.key('Ь'); assert.equal(h.settings.enableTts, true); h.key('M'); assert.equal(h.settings.enableTts, false);
  h.key('ArrowRight'); h.key('К'); assert.equal(h.modal.currentIndex, 0);
  h.key(' '); assert.equal(h.modal.isPlaying, true); h.key(' '); assert.equal(h.modal.isPlaying, false);
});

test('all speed buttons work and speed is clamped between 60 and 1500', () => {
  const h = readerHarness(); for (const [label, value] of [['-50',250],['-10',240],['+10',250],['+50',300]]) { h.button(label).onclick(); assert.equal(h.modal.currentWpm,value); }
  h.modal.adjustWpm(-9999); assert.equal(h.modal.currentWpm,60);
  h.modal.adjustWpm(9999); assert.equal(h.modal.currentWpm,1500);
});

test('pause cancels timer, rewinds context and resume restarts ramp-up', () => {
  const h = readerHarness('один два три четыре пять шесть семь восемь девять десять');
  h.modal.togglePlay(); const initial = [...h.timers.values()][0].delay;
  for(let i=0;i<5;i++)h.tick(); h.modal.pause();
  assert.equal(h.timers.size,0); assert.equal(h.modal.currentIndex,2);
  assert.equal(h.modal.pauseCardEl.classes.has('sr-hidden'),false);
  h.modal.togglePlay(); assert.equal(h.modal.wordsSinceResume,0);
  assert.equal([...h.timers.values()][0].delay,initial);
  assert.equal(h.modal.pauseCardEl.classes.has('sr-hidden'),true);
});

test('automatic saves happen after 25 words, close cancels timers and syncs exact offset', () => {
  const h = readerHarness(Array.from({length:40},(_,i)=>'слово'+i).join(' '));
  h.modal.togglePlay();for(let i=0;i<25;i++)h.tick();
  assert.equal(h.saves.at(-1).noteProgress['book.md'].index,25);
  const offset=h.modal.words[h.modal.currentIndex].charOffset;h.modal.onClose();
  assert.equal(h.timers.size,0);assert.equal(h.synced[0][2],offset);
});

test('selection sessions do not overwrite note progress or sync when disabled', () => {
  const h = readerHarness(undefined,{syncCursorOnClose:false,rememberProgress:false},'');
  h.modal.goToWord(2);h.modal.onClose();assert.deepEqual(h.settings.noteProgress,{});assert.equal(h.synced.length,0);
});

test('saved progress banner supports continue and restart actions', () => {
  for(const [label,index] of [['Продолжить',3],['Сначала',0]]){
    const h=readerHarness(undefined,{noteProgress:{'book.md':{index:3,totalWords:6,timestamp:1}}});
    h.button(label).onclick();assert.equal(h.modal.currentIndex,index);assert.equal(h.modal.resumeBannerEl.removed,true);
  }
});

test('theme font and chunk bionic settings are reflected in DOM', () => {
  const h=readerHarness('один два три',{themeMode:'sepia',readerFont:'golos',chunkSize:2,bionicInChunks:true});
  assert.equal(h.modal.modalEl.classes.has('sr-theme-sepia'),true);assert.equal(h.modal.modalEl.classes.has('sr-font-golos'),true);
  assert.equal(h.modal.chunkEl.children.length,2);assert.equal(h.modal.chunkEl.all('b').length,2);
  assert.equal(h.modal.prefixEl.classes.has('sr-hidden'),true);
});

test('TTS disabled API safely degrades and rate stays in native supported range', () => {
  const h=readerHarness(undefined,{enableTts:true});h.modal.adjustWpm(9999);h.modal.togglePlay();assert.equal(h.spoken[0].rate,2.5);
  h.modal.pause(false);h.modal.adjustWpm(-9999);h.modal.togglePlay();assert.equal(h.spoken.at(-1).rate,.7);
});


test('remember progress disabled does not offer stale resume data', () => {
  const h=readerHarness(undefined,{rememberProgress:false,noteProgress:{'book.md':{index:3,totalWords:6}}});
  assert.equal(h.modal.resumeBannerEl,undefined);
});


test('seeking during playback cancels old word timer and schedules new word duration', () => {
  const h=readerHarness('один два. три четыре',{enableRampUp:false,spritzVariableTiming:false});
  h.modal.togglePlay();const old=[...h.timers.keys()][0];
  h.modal.goToWord(1);assert.equal(h.timers.has(old),false);assert.equal([...h.timers.values()][0].delay,400);
});


test('TTS follows sentence boundaries inside multi-word chunks', () => {
  const h=readerHarness('Раз два. Три четыре пять шесть.',{chunkSize:3,enableTts:true,enableRampUp:false});
  h.modal.togglePlay(); assert.equal(h.spoken[0].text,'Раз два. Три четыре пять шесть.');
  h.tick(); assert.equal(h.spoken.length,1, 'Chunk must not cancel and repeat an already queued sentence');
});


test('replay refreshes first word immediately after completed reading', () => {
 const h=readerHarness('один два',{enableRampUp:false});h.modal.togglePlay();h.tick();h.tick();h.modal.togglePlay();
 assert.equal(h.modal.currentIndex,0);assert.equal(h.modal.prefixEl.textContent+h.modal.focusEl.textContent+h.modal.suffixEl.textContent,'один');
});
test('play after seeking last word reads that word instead of restarting', () => {
 const h=readerHarness('один два три');h.modal.goToWord(2);h.modal.togglePlay();assert.equal(h.modal.currentIndex,2);
});


test('TTS queues every sentence touched by the final chunk in one utterance',()=>{
 const h=readerHarness('Один. Два три.',{chunkSize:3,enableTts:true,enableRampUp:false});
 h.modal.togglePlay();assert.equal(h.spoken[0].text,'Один. Два три.');
});


test('maximum speed records actually read speed, not later idle setting',()=>{
 const h=readerHarness('один два три четыре пять шесть',{enableRampUp:false});h.modal.togglePlay();for(let i=0;i<5;i++)h.tick();
 h.modal.pause(false);h.modal.adjustWpm(700);h.modal.onClose();assert.equal(h.settings.stats.maxWpm,300);
});


test('visible pause summary follows seek and speed changes',()=>{
 const h=readerHarness();h.modal.pause(true);h.modal.goToWord(4);assert.match(h.modal.pauseCardEl.textContent,/5 \/ 6/);
 h.modal.adjustWpm(50);assert.equal(h.modal.currentWpm,350);
});

test('reader hides the host modal title bar through a scoped class', () => {
  const h = readerHarness();
  assert.equal(h.modal.modalEl.querySelector('.modal-header').classes.has('sr-header-hidden'), true);
});

test('closing an untouched reader keeps saved progress and leaves the cursor alone', () => {
  const h = readerHarness(undefined, { noteProgress: { 'book.md': { index: 3, totalWords: 6, timestamp: 1 } } });
  h.modal.onClose();
  assert.equal(h.settings.noteProgress['book.md'].index, 3, 'saved position must survive');
  assert.equal(h.synced.length, 0, 'cursor must not jump to the first word');
  assert.equal(h.saves.length, 0, 'nothing to persist without interaction');
});

test('repeated start and pause neither rewinds through the text nor double counts', () => {
  const h = readerHarness('a b c d e f g h i j', { enableRampUp: false });
  h.modal.togglePlay(); for (let i = 0; i < 6; i++) h.tick();
  h.modal.pause(true);
  const afterFirstPause = { index: h.modal.currentIndex, words: h.modal.sessionWordsRead };
  assert.ok(afterFirstPause.index < 6, 'one pause rewinds a few words');
  h.modal.togglePlay(); h.modal.pause(true);
  assert.equal(h.modal.currentIndex, afterFirstPause.index, 'pause without reading must not rewind again');
  assert.equal(h.modal.sessionWordsRead, afterFirstPause.words, 'rewound words must not be counted twice');
});

test('final chunk stays on screen when playback completes', () => {
  const h = readerHarness('один два три четыре пять шесть', { chunkSize: 3, enableRampUp: false, spritzVariableTiming: false });
  h.modal.togglePlay(); h.tick(); h.tick();
  assert.equal(h.modal.isPlaying, false);
  assert.equal(h.modal.chunkEl.children.length, 3, 'last chunk must not collapse to one word');
  assert.equal(h.modal.chunkEl.textContent, 'четырепятьшесть');
  assert.match(h.modal.progressLabel.textContent, /^6 \/ 6/);
});
