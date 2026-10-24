import { Editor, MarkdownFileInfo, MarkdownView, Notice, Plugin } from "obsidian";
import { DEFAULT_SETTINGS, SpeedReaderSettings, SpeedReaderSettingTab } from "./settings";
import { SpeedReaderModal } from "./readerModal";
import { parseWords } from "./textParser";
import {
  calculateProgressPercent,
  calculateTimeSavedMinutes,
  calculateWordDelayMs,
  findNextSentenceStart,
} from "./speedEngine";

/** One line of the built-in in-app diagnostics. */
export interface SelfCheckResult {
  name: string;
  status: "ok" | "fail" | "skip";
  detail?: string;
}

export default class SpeedReaderPlugin extends Plugin {
  settings: SpeedReaderSettings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();

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
          (wordIndex, rawWord, charOffset) => this.syncEditorCursor(editor, rawWord, charOffset)
        ).open();
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
        new Notice(
          `📊 Скорочтение:\n` +
          `• Прочитано слов: ${stats.totalWordsRead.toLocaleString()}\n` +
          `• Время: ${mins} мин (${stats.sessionsCount} сессий)\n` +
          `• Макс скорость: ${stats.maxWpm || this.settings.defaultWpm} WPM\n` +
          `• Сэкономлено: ~${savedMin} мин`,
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

    // Settings tab
    this.addSettingTab(new SpeedReaderSettingTab(this.app, this));

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
        (wordIndex, rawWord, charOffset) => this.syncEditorCursor(editor, rawWord, charOffset)
      ).open();
    }
  }

  private syncEditorCursor(editor: Editor, rawWord: string, charOffset?: number) {
    // Preferred path: the parser knows where this occurrence of the word lives
    // in the note, so the cursor lands on the word being read -- not on the
    // first identical word in the document.
    if (typeof charOffset === "number" && charOffset >= 0) {
      const pos = editor.offsetToPos(charOffset);
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

  async loadSettings() {
    const data: unknown = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data as Partial<SpeedReaderSettings> | null);
    this.settings.stats = Object.assign({}, DEFAULT_SETTINGS.stats, this.settings.stats);
    for (const key of Object.keys(DEFAULT_SETTINGS.stats) as (keyof SpeedReaderSettings["stats"])[]) {
      const value = this.settings.stats[key];
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        this.settings.stats[key] = DEFAULT_SETTINGS.stats[key];
      }
    }
    this.settings.noteProgress = { ...this.settings.noteProgress };
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
