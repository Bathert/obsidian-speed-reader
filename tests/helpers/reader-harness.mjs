import { buildSync } from 'esbuild';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

class Element {
  constructor(tag = 'div', options = {}) {
    this.tagName = tag; this.children = []; this.classes = new Set((options.cls || '').split(' ').filter(Boolean));
    this.attrs = { ...options.attr }; this.text = options.text || ''; this.style = {}; this.value = ''; this.removed = false;
  }
  createEl(tag, options = {}) { const el = new Element(tag, options); this.children.push(el); return el; }
  createDiv(options = {}) { return this.createEl('div', options); }
  createSpan(options = {}) { return this.createEl('span', options); }
  hasClass(name) { return this.classes.has(name); }
  addClass(...names) { names.forEach(n => this.classes.add(n)); }
  removeClass(...names) { names.forEach(n => this.classes.delete(n)); }
  setCssProps(props) { Object.assign(this.style, props); }
  setCssStyles(props) { Object.assign(this.style, props); }
  setText(text) { this.text = text; this.children = []; }
  appendText(text) { this.text += text; }
  empty() { this.text = ''; this.children = []; }
  remove() { this.removed = true; }
  setAttribute(key, value) { this.attrs[key] = value; }
  getAttribute(key) { return this.attrs[key]; }
  get textContent() { return this.text + this.children.map(c => c.textContent).join(''); }
  find(cls) { if (this.classes.has(cls)) return this; for (const c of this.children) { const found = c.find(cls); if (found) return found; } }
  all(tag) { return [...(this.tagName === tag ? [this] : []), ...this.children.flatMap(c => c.all(tag))]; }
}
const compiled = buildSync({ entryPoints: [fileURLToPath(new URL('../../src/readerModal.ts', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', external: ['obsidian'], write: false }).outputFiles[0].text;

export function readerHarness(text = 'Один два три. Четыре пять шесть.', overrides = {}, noteKey = 'book.md') {
  let now = 1000, nextId = 0;
  const timers = new Map(), spoken = [], notices = [], saves = [], synced = [];
  const settings = { defaultWpm: 300, fontSize: 44, readerFont: 'theme', highlightOrp: true, orpWidth: 1, orpColor: '#e63946', showFixationGuide: true, pauseOnPunctuation: true, sentencePauseMultiplier: 2, commaPauseMultiplier: 1.4, stepWordCount: 10, themeMode: 'default', enableRampUp: true, rampUpWords: 15, rewindOnPause: true, showPauseStats: true, rewindOnPauseWords: 3, pauseOnParagraphs: true, paragraphPauseMultiplier: 2.5, pauseOnNumbersAndAcronyms: true, chunkSize: 1, bionicInChunks: true, rememberProgress: true, syncCursorOnClose: true, noteProgress: {}, redicleAlignment: 'spritz', spritzVariableTiming: true, enableTts: false, stats: { totalWordsRead: 0, totalSecondsRead: 0, maxWpm: 0, sessionsCount: 0 }, ...overrides };
  class Modal {
    constructor(app) { this.app = app; this.contentEl = new Element(); this.modalEl = new Element(); this.scope = { register: (_a, _b, cb) => { this.key = cb; } }; }
    close() { this.onClose(); this.closed = true; }
    open() { this.onOpen(); }
  }
  const exports = {};
  const window = { setTimeout: (fn, delay) => { const id = ++nextId; timers.set(id, { fn, delay }); return id; }, clearTimeout: id => timers.delete(id), speechSynthesis: { cancel() {}, speak(utterance) { spoken.push(utterance); } } };
  const context = { exports, module: { exports }, require: name => { if (name !== 'obsidian') throw new Error(name); return { Modal, Notice: class { constructor(message) { notices.push(message); } }, setIcon(el, icon) { el.icon = icon; } }; }, window, SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } }, Date: class extends Date { static now() { return now; } }, console };
  vm.runInNewContext(compiled, context);
  const plugin = { settings, async saveSettings() { saves.push(JSON.parse(JSON.stringify(settings))); } };
  const modal = new context.module.exports.SpeedReaderModal({}, plugin, text, 'Test book', noteKey, (...args) => synced.push(args));
  modal.onOpen();
  return { modal, settings, timers, spoken, notices, saves, synced,
    tick() { const first = timers.entries().next().value; if (!first) throw new Error('No scheduled timer'); const [id, timer] = first; timers.delete(id); now += timer.delay; timer.fn(); return timer.delay; },
    disableSpeechApi() { delete window.speechSynthesis; },
    advance(ms) { now += ms; },
    key(key, extra = {}) { return modal.key({ key, ...extra }); },
    button(title) { const b = modal.contentEl.all('button').find(el => el.attrs.title?.includes(title) || el.text === title); if (!b) throw new Error('Button missing: ' + title); return b; }
  };
}
