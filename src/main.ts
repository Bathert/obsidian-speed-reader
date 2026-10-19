import { Editor, MarkdownView, Notice, Plugin } from "obsidian";
import { DEFAULT_SETTINGS, SpeedReaderSettings, SpeedReaderSettingTab } from "./settings";
import { SpeedReaderModal } from "./readerModal";
import { calculateTimeSavedMinutes } from "./speedEngine";

export default class SpeedReaderPlugin extends Plugin {
  settings: SpeedReaderSettings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();

    // Ribbon icon on the left sidebar
    this.addRibbonIcon("book-open", "Speed Read Note", () => {
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
      editorCallback: (editor: Editor, view: MarkdownView) => {
        const selection = editor.getSelection();
        if (!selection || !selection.trim()) {
          new Notice("Speed Reader: No text selected.");
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
      editorCallback: (editor: Editor, view: MarkdownView) => {
        const content = editor.getValue();
        if (!content || !content.trim()) {
          new Notice("Speed Reader: Active note is empty.");
          return;
        }
        const noteKey = view.file?.path || view.file?.basename || "Active Note";
        new SpeedReaderModal(
          this.app,
          this,
          content,
          view.file?.basename || "Active Note",
          noteKey,
          (wordIndex, rawWord) => this.syncEditorCursor(editor, rawWord)
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
  }

  private speedReadActiveView() {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView) {
      new Notice("Speed Reader: No active Markdown note found.");
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
        new Notice("Speed Reader: Active note is empty.");
        return;
      }
      const noteKey = activeView.file?.path || activeView.file?.basename || "Active Note";
      new SpeedReaderModal(
        this.app,
        this,
        content,
        activeView.file?.basename || "Active Note",
        noteKey,
        (wordIndex, rawWord) => this.syncEditorCursor(editor, rawWord)
      ).open();
    }
  }

  private syncEditorCursor(editor: Editor, rawWord: string) {
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
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    if (!this.settings.stats) {
      this.settings.stats = Object.assign({}, DEFAULT_SETTINGS.stats);
    }
    if (!this.settings.noteProgress) {
      this.settings.noteProgress = {};
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
