/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import { Editor, MarkdownFileInfo, MarkdownView, Notice, Plugin } from "obsidian";
import { DEFAULT_SETTINGS, SpeedReaderSettings, SpeedReaderSettingTab } from "./settings";
import { SpeedReaderModal } from "./readerModal";
import { cleanMarkdown, findWordIndexAtOffset, ParsedWord, parseDocument, parseWords } from "./textParser";
import {
  calculateProgressPercent,
  calculateTimeSavedMinutes,
  calculateWordDelayMs,
  findNextSentenceStart,
  formatTimeRemaining,
} from "./speedEngine";
import { I18N, resolveLanguage } from "./i18n";
import { synthesizeSpeech, UNREAL_SPEECH_VOICES, UnrealSpeechError } from "./unrealSpeech";

/** One line of the built-in in-app diagnostics. */
export interface SelfCheckResult {
  name: string;
  status: "ok" | "fail" | "skip";
  detail?: string;
}

export default class SpeedReaderPlugin extends Plugin {
  settings: SpeedReaderSettings = DEFAULT_SETTINGS;
  private statusBarEl: HTMLElement | null = null;

  async onload() {
    await this.loadSettings();

    // Optional status bar indicator (absent in headless test harnesses).
    if (typeof this.addStatusBarItem === "function") {
      this.statusBarEl = this.addStatusBarItem();
      this.statusBarEl.addClass("sr-status-bar-item");
      this.statusBarEl.onclick = () => this.speedReadActiveView();
      this.updateStatusBar();
    }

    // Ribbon icon on the left sidebar
    this.addRibbonIcon("book-open", "Speed read note", () => {
      this.speedReadActiveView();
    });

    // Command: Read selection or active note
    this.addCommand({
      id: "speed-read-current",
      name: "Speed read current selection or active note",
      checkCallback: (checking: boolean) => {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (activeView) {
          if (!checking) {
            this.speedReadActiveView();
          }
          return true;
        }
        return false;
      },
    });

    // Command: Read selection specifically
    this.addCommand({
      id: "speed-read-selection",
      name: "Speed read selected text",
      editorCallback: (editor: Editor, view: MarkdownView | MarkdownFileInfo) => {
        const selection = editor.getSelection();
        if (!selection || !selection.trim()) {
          new Notice("Speed reader: No text selected.");
          return;
        }
        new SpeedReaderModal(
          this.app,
          this,
          selection,
          `Selection in ${view.file?.basename || "Note"}`,
          "" // Don't persist note progress for arbitrary transient selections
        ).open();
      },
    });

    // Command: Read whole note
    this.addCommand({
      id: "speed-read-whole-note",
      name: "Speed read entire active note",
      editorCallback: (editor: Editor, view: MarkdownView | MarkdownFileInfo) => {
        const content = editor.getValue();
        if (!content || !content.trim()) {
          new Notice("Speed reader: Active note is empty.");
          return;
        }
        const noteKey = view.file?.path || view.file?.basename || "Active Note";
        new SpeedReaderModal(
          this.app,
          this,
          content,
          view.file?.basename || "Active Note",
          noteKey,
          this.createEditorCallbacks(editor, content)
        ).open();
      },
    });

    // Command: read from the current cursor position
    this.addCommand({
      id: "speed-read-from-cursor",
      name: "Speed read from Cursor",
      editorCallback: (editor: Editor, view: MarkdownView | MarkdownFileInfo) => {
        this.speedReadFromCursor(editor, view);
      },
    });

    // Command: View reading statistics
    this.addCommand({
      id: "speed-reader-stats",
      name: "Show speed reading statistics",
      callback: () => {
        const stats = this.settings.stats;
        const savedMin = calculateTimeSavedMinutes(stats.totalWordsRead, stats.totalSecondsRead);
        const mins = Math.round((stats.totalSecondsRead / 60) * 10) / 10;
        const lang = resolveLanguage(this.settings.uiLanguage);
        new Notice(
          I18N[lang].statsNotice(
            stats.totalWordsRead.toLocaleString(),
            mins,
            stats.sessionsCount,
            stats.maxWpm || this.settings.defaultWpm,
            savedMin
          ),
          8000
        );
      },
    });

    // Context menu item when text is selected in the editor
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor, view) => {
        const selection = editor.getSelection();
        if (selection && selection.trim()) {
          menu.addItem((item) => {
            item
              .setTitle("Speed read selection")
              .setIcon("book-open")
              .onClick(() => {
                new SpeedReaderModal(
                  this.app,
                  this,
                  selection,
                  `Selection in ${view.file?.basename || "Note"}`
                ).open();
              });
          });
        }
      })
    );

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.updateStatusBar();
      })
    );

    // Settings tab
    this.addSettingTab(new SpeedReaderSettingTab(this.app, this));

    // Command: verify the Unreal Speech key with a one-word request
    this.addCommand({
      id: "speed-reader-test-tts",
      name: "Test speech key",
      callback: () => {
        void this.testUnrealSpeech();
      },
    });

    // Command: built-in diagnostics, runnable without a terminal
    this.addCommand({
      id: "speed-reader-self-check",
      name: "Run self-check",
      callback: () => {
        void this.showSelfCheck();
      },
    });
  }

  /** Pure-logic diagnostics: safe to run in a test harness without DOM. */
  runSelfCheck(): SelfCheckResult[] {
    const results: SelfCheckResult[] = [];
    const check = (name: string, run: () => true | string) => {
      try {
        const result = run();
        results.push({ name, status: result === true ? "ok" : "fail", detail: result === true ? undefined : String(result) });
      } catch (error) {
        results.push({ name, status: "fail", detail: error instanceof Error ? error.message : String(error) });
      }
    };

    const timing = {
      pauseOnPunctuation: false,
      sentencePauseMultiplier: 1,
      commaPauseMultiplier: 1,
      spritzVariableTiming: false,
      orpWidth: 1,
    };

    check("Markdown → слова", () => {
      const words = parseWords("**Принц** и [[нищий|бедняк]]", timing);
      if (words.length !== 3) return `ожидалось 3 слова, получено ${words.length}`;
      if (words.some((word) => /[*[\]|]/.test(word.raw))) return "в слова попала разметка";
      if (words.some((word) => word.prefix + word.focusChar + word.suffix !== word.raw)) return "слово разбито по ORP с потерей букв";
      return true;
    });

    check("смещения слов в исходнике", () => {
      const source = "---\ntags: [тест]\n---\nПринц и нищий";
      const words = parseWords(source, timing);
      const first = words[0];
      if (!first || first.charOffset === undefined || first.charOffset < 20) return `смещение ${first?.charOffset}`;
      if (source.slice(first.charOffset, first.charOffset + first.raw.length) !== first.raw) return "смещение не указывает на слово";
      return true;
    });

    check("тайминги", () => {
      if (calculateWordDelayMs(300, 1) !== 200) return `300 WPM → ${calculateWordDelayMs(300, 1)} мс вместо 200`;
      if (calculateWordDelayMs(300, 2) !== 400) return "множитель паузы не применяется";
      if (calculateWordDelayMs(0, 1) !== calculateWordDelayMs(60, 1)) return "скорость не ограничена снизу";
      return true;
    });

    check("навигация по предложениям", () => {
      const words = parseWords("Первое. Второе третье.", timing);
      const next = findNextSentenceStart(words, 0);
      if (words[next]?.raw !== "Второе") return `переход дал «${words[next]?.raw}»`;
      if (findNextSentenceStart([], 0) !== 0) return "пустой текст ломает навигацию";
      return true;
    });

    check("границы прогресса", () => {
      if (calculateProgressPercent(0, 0) !== 0) return "пустой текст даёт не 0%";
      if (calculateProgressPercent(10, 10) !== 100) return "конец текста даёт не 100%";
      if (calculateProgressPercent(-5, 10) !== 0) return "отрицательная позиция даёт не 0%";
      return true;
    });

    return results;
  }

  /** Self-check plus a real open/render/seek/close of the reader window. */
  async showSelfCheck() {
    const results = this.runSelfCheck();
    const modal = new SpeedReaderModal(this.app, this, "Проверка окна чтения. Второе предложение здесь.", "Self-check", "");
    try {
      modal.open();
      const contentEl = modal.contentEl;
      if (!contentEl) {
        results.push({ name: "окно чтения", status: "skip", detail: "нет доступа к DOM" });
      } else {
        const wordBox = contentEl.querySelector(".sr-word-box");
        const label = contentEl.querySelector(".sr-progress-label")?.textContent ?? "";
        if (!wordBox) results.push({ name: "окно чтения", status: "fail", detail: "не отрисовано слово" });
        else if (!label.startsWith("1 / ")) results.push({ name: "окно чтения", status: "fail", detail: `подпись прогресса «${label}»` });
        else results.push({ name: "окно чтения", status: "ok" });
      }
    } catch (error) {
      results.push({ name: "окно чтения", status: "fail", detail: error instanceof Error ? error.message : String(error) });
    } finally {
      modal.close();
    }

    const failed = results.filter((result) => result.status === "fail");
    const skipped = results.filter((result) => result.status === "skip");
    const summary =
      failed.length === 0
        ? `✅ Проверка скорочтения: ${results.length - skipped.length} из ${results.length - skipped.length} OK`
        : `❌ Проверка скорочтения: ${failed.length} ошибок\n` +
          failed.map((result) => `• ${result.name}: ${result.detail ?? "сбой"}`).join("\n");

    if (skipped.length > 0) {
      new Notice(`⚠️ Проверка скорочтения: ${skipped.length} шагов пропущено`, 6000);
    }
    new Notice(summary, failed.length === 0 ? 6000 : 15000);
  }

  private speedReadActiveView() {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView) {
      new Notice("Speed reader: No active Markdown note found.");
      return;
    }

    const editor = activeView.editor;
    const selection = editor.getSelection();

    if (selection && selection.trim().length > 0) {
      new SpeedReaderModal(
        this.app,
        this,
        selection,
        `Selection in ${activeView.file?.basename || "Note"}`
      ).open();
    } else {
      const content = editor.getValue();
      if (!content || !content.trim()) {
        new Notice("Speed reader: Active note is empty.");
        return;
      }
      const noteKey = activeView.file?.path || activeView.file?.basename || "Active Note";
      new SpeedReaderModal(
        this.app,
        this,
        content,
        activeView.file?.basename || "Active Note",
        noteKey,
        this.createEditorCallbacks(editor, content)
      ).open();
    }
  }

  /** Reads the whole note starting from the editor cursor. */
  private speedReadFromCursor(editor: Editor, view: MarkdownView | MarkdownFileInfo) {
    const content = editor.getValue();
    if (!content || !content.trim()) {
      new Notice("Speed reader: Active note is empty.");
      return;
    }

    let cursorOffset = 0;
    if (typeof editor.getCursor === "function" && typeof editor.posToOffset === "function") {
      cursorOffset = editor.posToOffset(editor.getCursor());
    } else if (typeof editor.getCursor === "function") {
      const pos = editor.getCursor();
      const lines = content.split("\n");
      for (let i = 0; i < pos.line && i < lines.length; i++) {
        cursorOffset += lines[i].length + 1;
      }
      cursorOffset += pos.ch;
    }

    const words = parseWords(content, this.parseOptions());
    const initialIndex = findWordIndexAtOffset(words, cursorOffset);
    const noteKey = view.file?.path || view.file?.basename || "Active Note";

    new SpeedReaderModal(this.app, this, content, view.file?.basename || "Active Note", noteKey, {
      initialIndex,
      ...this.createEditorCallbacks(editor, content),
    }).open();
  }

  /** Each reader owns a source snapshot; only its own insertions may move offsets. */
  private createEditorCallbacks(editor: Editor, source: string) {
    let expected = source;
    const highlights: { start: number; end: number }[] = [];
    const options = this.parseOptions();
    const { words, wrappers } = parseDocument(source, options);
    let lineOffset = 0;
    const sourceLines = source.split("\n").map(raw => {
      const text = raw.replace(/\r$/, "");
      const start = lineOffset;
      lineOffset += raw.length + 1;
      const pipes: number[] = [];
      for (let index = 0; index < text.length; index++) {
        if (text[index] !== "|") continue;
        let escapes = 0;
        for (let before = index - 1; before >= 0 && text.charCodeAt(before) === 92; before--) escapes++;
        if (escapes % 2 === 0) pipes.push(start + index);
      }
      return { text, start, end: start + text.length, pipes, table: false };
    });
    for (let index = 1; index < sourceLines.length; index++) {
      const line = sourceLines[index];
      const cells = line.text.trim().replace(/^\||\|$/g, "").split("|");
      if (!line.pipes.length || !sourceLines[index - 1].pipes.length ||
          !cells.every(cell => /^:?-+:?$/.test(cell.trim()))) continue;
      sourceLines[index - 1].table = line.table = true;
      for (let row = index + 1; row < sourceLines.length && sourceLines[row].pipes.length; row++) sourceLines[row].table = true;
    }
    // Be conservative at explicit block prefixes, but preserve ordinary soft
    // line breaks and highlights wholly inside a single block or table cell.
    const blockPrefix = /^[ \t]*(?:>|#{1,6}(?:[ \t]+|$)|(?:[-+*]|\d+[.)])[ \t]+|`{3,}|~{3,}|(?:[-*_][ \t]*){3,}$|[=-]+[ \t]*$|\$\$|\\\[|<[/!?a-zA-Z])/;
    const safeHighlightRange = (start: number, end: number): boolean => {
      const slice = source.slice(start, end);
      if (/\r?\n[ \t]*\r?\n/.test(slice)) return false;
      const lines = sourceLines.filter(line => line.start < end && line.end > start);
      if (lines.length > 1 && lines.some(line => line.table || blockPrefix.test(line.text) || /^(?: {4}|\t)/.test(line.text))) return false;
      // In a real table even a raw pipe inside backticks splits cells in the
      // host. Escaped pipes and pipes outside table rows are not separators.
      return !lines.some(line => line.table && line.pipes.some(pipe => start <= pipe && pipe < end));
    };
    const translate = (offset: number, end = false) => offset + highlights.reduce(
      (shift, range) => shift + (range.start <= offset ? 2 : 0) +
        (range.end < offset || (!end && range.end === offset) ? 2 : 0), 0
    );
    return {
      onSyncCursor: (_wordIndex: number, rawWord: string, charOffset?: number) => {
        if (editor.getValue() !== expected) return;
        this.syncEditorCursor(editor, rawWord,
          typeof charOffset === "number" ? translate(charOffset) : undefined);
      },
      onHighlightSentence: (startWord: ParsedWord, endWord: ParsedWord): boolean => {
        if (editor.getValue() !== expected) return false;
        if (!Number.isInteger(startWord.charOffset) || !Number.isInteger(endWord.charOffset)) return false;
        const first = words.findIndex(word => word.charOffset === startWord.charOffset && word.raw === startWord.raw);
        const last = words.findIndex(word => word.charOffset === endWord.charOffset && word.raw === endWord.raw);
        if (first < 0 || last < first) return false;
        const core = endWord.raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
        let start = words[first].sourceStartOffset ?? startWord.charOffset!;
        let end = words[last].sourceEndOffset ?? words[last].charEndOffset ?? endWord.charOffset! + core.length;
        // Nested wrappers can become reachable only after an inner expansion.
        let expanded: boolean;
        do {
          expanded = false;
          for (const range of wrappers) {
            if (range.start < start && start < range.end) { start = range.start; expanded = true; }
            if (range.start < end && end < range.end) { end = range.end; expanded = true; }
          }
        } while (expanded);
        let visible = cleanMarkdown(source.slice(start, end), options.readCodeBlocks);
        const leading = startWord.raw.match(/^[^\p{L}\p{N}]*/u)?.[0] ?? "";
        const trailing = endWord.raw.match(/[^\p{L}\p{N}]*$/u)?.[0] ?? "";
        if (!visible.startsWith(startWord.raw)) {
          // Literal punctuation may already be inside the expanded wrapper.
          // A one-word sentence can still be missing its external suffix too.
          const firstStem = startWord.raw.replace(/[^\p{L}\p{N}]+$/u, "");
          for (let length = 1; length <= leading.length; length++) {
            const prefix = leading.slice(0, length);
            if (visible.startsWith(firstStem.slice(length)) && source.slice(start - length, start) === prefix) {
              start -= length;
              visible = cleanMarkdown(source.slice(start, end), options.readCodeBlocks);
              break;
            }
          }
        }
        if (!visible.endsWith(endWord.raw)) {
          // Some raw punctuation is literal code already inside the wrapper;
          // append only the missing suffix that actually follows it in source.
          for (let length = 1; length <= trailing.length; length++) {
            const suffix = trailing.slice(-length);
            if (visible.endsWith(endWord.raw.slice(0, -length)) && source.slice(end, end + length) === suffix) {
              end += length;
              break;
            }
          }
        }
        if (start < 0 || end > source.length || end <= start) return false;
        const slice = source.slice(start, end);
        if (!slice.trim() || !safeHighlightRange(start, end)) return false;
        const selected = parseWords(slice, options);
        const original = words.slice(first, last + 1);
        if (selected.length !== original.length || selected.some((word, index) => word.raw !== original[index].raw)) return false;
        if (highlights.some(range => range.start === start && range.end === end)) return true;
        if (highlights.some(range => start < range.end && end > range.start)) return false;
        if (slice.startsWith("==") && slice.endsWith("==")) return true;
        const highlightedWords = parseWords(`==${slice}==`, options);
        if (highlightedWords.length !== original.length || highlightedWords.some((word, index) => word.raw !== original[index].raw)) return false;
        const from = translate(start);
        const to = translate(end, true);
        const wrapped = `==${expected.slice(from, to)}==`;
        const next = expected.slice(0, from) + wrapped + expected.slice(to);
        if (typeof editor.replaceRange === "function" && typeof editor.offsetToPos === "function") {
          editor.replaceRange(wrapped, editor.offsetToPos(from), editor.offsetToPos(to));
        } else if (typeof editor.setValue === "function") {
          editor.setValue(next);
        } else return false;
        if (editor.getValue() !== next) return false;
        expected = next;
        highlights.push({ start, end });
        return true;
      },
    };
  }

  private syncEditorCursor(editor: Editor, rawWord: string, charOffset?: number) {
    // Preferred path: the parser knows where this occurrence of the word lives
    // in the note, so the cursor lands on the word being read -- not on the
    // first identical word in the document.
    if (typeof charOffset === "number" && charOffset >= 0) {
      // The note may have been edited while the reader was open.
      const docLength = editor.getValue().length;
      const safeOffset = Math.min(Math.max(0, charOffset), docLength);
      const pos = editor.offsetToPos(safeOffset);
      editor.setCursor(pos);
      editor.scrollIntoView({ from: pos, to: pos }, true);
      return;
    }

    // Fallback for words the parser could not map back to the source
    // (e.g. text that only exists after markdown was stripped).
    if (!rawWord) return;
    const doc = editor.getValue();
    const cleanWord = rawWord.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (!cleanWord) return;

    const idx = doc.indexOf(cleanWord);
    if (idx !== -1) {
      const pos = editor.offsetToPos(idx);
      editor.setCursor(pos);
      editor.scrollIntoView({ from: pos, to: pos }, true);
    }
  }

  /** Parser options shared by every path that only needs word positions. */
  private parseOptions(): {
    pauseOnPunctuation: boolean;
    sentencePauseMultiplier: number;
    commaPauseMultiplier: number;
    pauseOnParagraphs: boolean;
    paragraphPauseMultiplier: number;
    pauseOnNumbersAndAcronyms: boolean;
    spritzVariableTiming: boolean;
    readCodeBlocks: boolean;
    orpWidth: number;
  } {
    return {
      pauseOnPunctuation: this.settings.pauseOnPunctuation,
      sentencePauseMultiplier: this.settings.sentencePauseMultiplier,
      commaPauseMultiplier: this.settings.commaPauseMultiplier,
      pauseOnParagraphs: this.settings.pauseOnParagraphs,
      paragraphPauseMultiplier: this.settings.paragraphPauseMultiplier,
      pauseOnNumbersAndAcronyms: this.settings.pauseOnNumbersAndAcronyms,
      spritzVariableTiming: this.settings.spritzVariableTiming,
      readCodeBlocks: this.settings.readCodeBlocks,
      orpWidth: this.settings.orpWidth ?? 1,
    };
  }

  /** Verifies the Unreal Speech key with a one-word request. */
  async testUnrealSpeech(): Promise<void> {
    if (!this.settings.unrealSpeechApiKey.trim()) {
      new Notice("Не задан ключ озвучки. Вставьте его в настройках плагина.");
      return;
    }
    try {
      const audio = await synthesizeSpeech("Проверка голоса.", {
        apiKey: this.settings.unrealSpeechApiKey,
        voiceId: this.settings.unrealSpeechVoiceId,
        wpm: 300,
      });
      this.settings.unrealSpeechCharsUsed += 20;
      await this.saveSettings();
      new Notice(`✅ Ключ Unreal Speech работает, получено ${audio.byteLength} байт аудио.`, 8000);
    } catch (error) {
      const message = error instanceof UnrealSpeechError ? error.message : String(error);
      new Notice(`❌ Ошибка Unreal Speech: ${message}`, 12000);
    }
  }

  /** Updates the status bar reading estimate for the active note. */
  updateStatusBar() {
    if (!this.statusBarEl) return;
    const bar = this.statusBarEl;
    const hide = () => {
      bar.setText("");
      bar.addClass("sr-hidden");
    };

    if (!this.settings.showStatusBar) return hide();

    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView?.editor) return hide();

    const content = activeView.editor.getValue();
    if (!content || !content.trim()) return hide();

    const words = parseWords(content, this.parseOptions());
    if (words.length === 0) return hide();

    const noteKey = activeView.file?.path || activeView.file?.basename || "";
    const saved = noteKey && this.settings.rememberProgress ? this.settings.noteProgress[noteKey] : null;
    const currentIndex = saved && saved.index < words.length ? saved.index : 0;
    const pct = saved ? calculateProgressPercent(currentIndex, words.length) : 0;
    const remaining = Math.max(0, words.length - currentIndex);
    const lang = resolveLanguage(this.settings.uiLanguage);
    const timeText = formatTimeRemaining(remaining, this.settings.defaultWpm, lang).replace(" left", "");

    bar.removeClass("sr-hidden");
    bar.setText(pct > 0 ? `📖 ${pct}% · ${timeText}` : `📖 ${timeText}`);
  }

  async loadSettings() {
    const data: unknown = await this.loadData();
    const saved = data && typeof data === "object" && !Array.isArray(data)
      ? data as Record<string, unknown> : {};
    this.settings = { ...DEFAULT_SETTINGS };
    const choices: Partial<Record<keyof SpeedReaderSettings, readonly unknown[]>> = {
      uiLanguage: ["auto", "en", "ru"], readerFont: ["theme", "golos", "atkinson"],
      themeMode: ["default", "dark", "light", "sepia"], redicleAlignment: ["spritz", "center"],
      ttsProvider: ["system", "unrealspeech"], unrealSpeechVoiceId: UNREAL_SPEECH_VOICES,
      chunkSize: [1, 2, 3], orpWidth: [1, 2, 3],
    };
    for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof SpeedReaderSettings)[]) {
      const fallback = DEFAULT_SETTINGS[key];
      const value = saved[key];
      if (typeof fallback === "object" || typeof value !== typeof fallback) continue;
      if (typeof value === "number" && (!Number.isFinite(value) ||
        (key === "unrealSpeechCharsUsed" ? value < 0 : value <= 0))) continue;
      if (choices[key] && !choices[key].includes(value)) continue;
      if ((key === "rewindOnPauseWords" || key === "rampUpWords" ||
        key === "autoAccelerateIntervalWords" || key === "stepWordCount") && !Number.isSafeInteger(value)) continue;
      if (key === "stepWordCount" && (value as number) > 50) continue;
      Object.assign(this.settings, { [key]: value });
    }
    this.settings.stats = Object.assign({}, DEFAULT_SETTINGS.stats, saved.stats);
    for (const key of Object.keys(DEFAULT_SETTINGS.stats) as (keyof SpeedReaderSettings["stats"])[]) {
      const value = this.settings.stats[key];
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        this.settings.stats[key] = DEFAULT_SETTINGS.stats[key];
      }
    }
    this.settings.noteProgress = {};
    const progress = saved.noteProgress;
    if (progress && typeof progress === "object" && !Array.isArray(progress)) {
      for (const key of Object.keys(progress)) {
        const value = (progress as Record<string, unknown>)[key];
        if (!value || typeof value !== "object" || Array.isArray(value)) continue;
        const record = value as Record<string, unknown>;
        const { index, totalWords, timestamp } = record;
        if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0 ||
          typeof totalWords !== "number" || !Number.isSafeInteger(totalWords) || totalWords < index ||
          typeof timestamp !== "number" || !Number.isFinite(timestamp) || timestamp < 0) continue;
        Object.defineProperty(this.settings.noteProgress, key, {
          value: { index, totalWords, timestamp }, enumerable: true, writable: true, configurable: true,
        });
      }
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.updateStatusBar();
  }
}
