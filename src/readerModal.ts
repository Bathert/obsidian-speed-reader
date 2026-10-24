/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import { App, Modal, Notice, setIcon } from "obsidian";
import { ParsedWord, parseWords } from "./textParser";
import type { SpeedReaderSettings } from "./settings";
import type SpeedReaderPlugin from "./main";
import {
  buildMotivationLine,
  calculateProgressPercent,
  calculateRampUpWpm,
  calculateSessionSummary,
  formatDuration,
  calculateWordDelayMs,
  findNextSentenceStart,
  findPreviousSentenceStart,
  formatTimeRemaining,
  isSentenceEnd,
  stepIndex,
} from "./speedEngine";

/** Flush the reading position to disk every N words. */
const PROGRESS_SAVE_EVERY_WORDS = 25;

export class SpeedReaderModal extends Modal {
  private plugin: SpeedReaderPlugin;
  private words: ParsedWord[] = [];
  private currentIndex: number = 0;
  private isPlaying: boolean = false;
  private completed: boolean = false;
  private ttsEndIndex: number = -1;
  private timer: number | null = null;
  private currentWpm: number;
  private settings: SpeedReaderSettings;
  private titleText: string;
  private noteKey: string;
  private onSyncCursor?: (wordIndex: number, rawWord: string, charOffset?: number) => void;

  // Session stats & ramp-up tracking
  private sessionWordsRead: number = 0;
  private sessionMaxWpm: number = 0;
  /**
   * True once the user actually played or moved through the text. Closing a
   * freshly opened reader must not overwrite saved progress with word 1.
   */
  private hasInteracted: boolean = false;
  // Слова, прочитанные с момента последнего старта/возобновления:
  // именно по ним считается разгон, чтобы после паузы он начинался заново.
  private wordsSinceResume: number = 0;
  private isRampingUp: boolean = false;
  private lastPersistedIndex: number = 0;
  // Активное время чтения без пауз — база для честной средней скорости.
  private activeSince: number | null = null;
  private activeMs: number = 0;

  // DOM Elements
  private resumeBannerEl!: HTMLElement;
  private wordBoxEl!: HTMLElement;
  private prefixEl!: HTMLElement;
  private focusEl!: HTMLElement;
  private suffixEl!: HTMLElement;
  private chunkEl!: HTMLElement;
  private contextEl!: HTMLElement;
  private pauseCardEl!: HTMLElement;
  private playPauseBtn!: HTMLElement;
  private progressBar!: HTMLInputElement;
  private progressLabel!: HTMLElement;
  private timeLeftLabel!: HTMLElement;
  private wpmDisplay!: HTMLElement;

  constructor(
    app: App,
    plugin: SpeedReaderPlugin,
    text: string,
    title: string,
    noteKey: string = "",
    onSyncCursor?: (wordIndex: number, rawWord: string, charOffset?: number) => void
  ) {
    super(app);
    this.plugin = plugin;
    this.settings = plugin.settings;
    this.currentWpm = this.settings.defaultWpm;
    this.titleText = title;
    this.noteKey = noteKey;
    this.onSyncCursor = onSyncCursor;

    this.words = parseWords(text, {
      pauseOnPunctuation: this.settings.pauseOnPunctuation,
      sentencePauseMultiplier: this.settings.sentencePauseMultiplier,
      commaPauseMultiplier: this.settings.commaPauseMultiplier,
      pauseOnParagraphs: this.settings.pauseOnParagraphs,
      paragraphPauseMultiplier: this.settings.paragraphPauseMultiplier,
      pauseOnNumbersAndAcronyms: this.settings.pauseOnNumbersAndAcronyms,
      spritzVariableTiming: this.settings.spritzVariableTiming,
      orpWidth: this.settings.orpWidth ?? 1,
    });
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    contentEl.empty();
    modalEl.addClass("sr-modal-container");
    if (this.settings.themeMode !== "default") {
      modalEl.addClass(`sr-theme-${this.settings.themeMode}`);
    }
    if (this.settings.readerFont && this.settings.readerFont !== "theme") {
      modalEl.addClass(`sr-font-${this.settings.readerFont}`);
    }

    // The reader draws its own header, so the host's empty title bar is hidden
    // through a class instead of a :has() selector or inline style.
    this.modalEl.querySelector(".modal-header")?.addClass("sr-header-hidden");

    if (this.words.length === 0) {
      contentEl.createEl("h3", { text: "No readable words found in selection or note." });
      const closeBtn = contentEl.createEl("button", { text: "Close", cls: "mod-cta" });
      closeBtn.onclick = () => this.close();
      return;
    }

    // Feature 3: Resume Banner (if previous progress exists)
    const saved = this.noteKey && this.settings.rememberProgress ? this.settings.noteProgress[this.noteKey] : null;
    if (saved && saved.index > 0 && saved.index < this.words.length - 1) {
      this.resumeBannerEl = contentEl.createDiv({ cls: "sr-resume-banner" });
      const pct = Math.round(((saved.index + 1) / this.words.length) * 100);
      this.resumeBannerEl.createSpan({
        text: `📍 Предыдущий прогресс: слово ${saved.index + 1} из ${this.words.length} (${pct}%)`,
      });
      const resumeBtnGroup = this.resumeBannerEl.createDiv({ cls: "sr-resume-btn-group" });

      const resumeBtn = resumeBtnGroup.createEl("button", {
        text: "Продолжить",
        cls: "mod-cta sr-small-btn",
      });
      resumeBtn.onclick = () => {
        this.goToWord(saved.index);
        this.resumeBannerEl.remove();
      };

      const startOverBtn = resumeBtnGroup.createEl("button", {
        text: "Сначала",
        cls: "sr-small-btn",
      });
      startOverBtn.onclick = () => {
        this.goToWord(0);
        this.resumeBannerEl.remove();
      };
    }

    // Modal Header
    const header = contentEl.createDiv({ cls: "sr-header" });
    const titleEl = header.createDiv({ cls: "sr-title" });
    titleEl.createSpan({ text: this.titleText, cls: "sr-title-name" });
    titleEl.createSpan({ text: ` (${this.words.length} слов)`, cls: "sr-title-meta" });

    const hints = header.createDiv({ cls: "sr-shortcuts-hint" });
    hints.setText("Пробел: Старт/Пауза | ↑↓: WPM | ←→: Слов | [ ]: Предложение | R: Сначала");

    // RSVP Display Frame
    const frame = contentEl.createDiv({ cls: "sr-frame" });
    if (this.settings.redicleAlignment === "spritz") {
      frame.addClass("sr-redicle-spritz");
    }
    frame.setCssProps({ "--sr-font-size": `${this.settings.fontSize}px` });

    if (this.settings.showFixationGuide && this.settings.chunkSize === 1) {
      const topGuide = frame.createDiv({ cls: "sr-guide sr-guide-top" });
      topGuide.createDiv({ cls: "sr-notch sr-notch-down" });
    }

    // RSVP Word Box
    this.wordBoxEl = frame.createDiv({
      cls: `sr-word-box ${this.settings.redicleAlignment === "spritz" ? "sr-align-spritz" : "sr-align-center"}`,
    });

    // Mode: Single word (ORP)
    this.prefixEl = this.wordBoxEl.createSpan({ cls: "sr-word-part sr-prefix" });
    this.focusEl = this.wordBoxEl.createSpan({ cls: "sr-word-part sr-focus" });
    this.suffixEl = this.wordBoxEl.createSpan({ cls: "sr-word-part sr-suffix" });

    // Mode: Chunking container (2-3 words)
    this.chunkEl = this.wordBoxEl.createDiv({ cls: "sr-chunk-box" });
    this.chunkEl.addClass("sr-hidden");

    this.focusEl.setCssStyles({ color: this.settings.highlightOrp ? this.settings.orpColor : "var(--text-normal)" });

    if (this.settings.showFixationGuide && this.settings.chunkSize === 1) {
      const bottomGuide = frame.createDiv({ cls: "sr-guide sr-guide-bottom" });
      bottomGuide.createDiv({ cls: "sr-notch sr-notch-up" });
    }

    // Pause summary card: заполняется и показывается только на паузе
    this.pauseCardEl = contentEl.createDiv({ cls: "sr-pause-card" });
    this.pauseCardEl.addClass("sr-hidden");

    // Context preview row
    this.contextEl = contentEl.createDiv({ cls: "sr-context-preview" });

    // Progress Bar Row
    const progressContainer = contentEl.createDiv({ cls: "sr-progress-container" });
    this.progressBar = progressContainer.createEl("input", {
      type: "range",
      cls: "sr-progress-bar",
    });
    this.progressBar.min = "0";
    this.progressBar.max = `${this.words.length - 1}`;
    this.progressBar.value = "0";
    this.progressBar.oninput = (e) => {
      const target = e.target as HTMLInputElement;
      this.goToWord(parseInt(target.value, 10));
    };

    const progressMeta = progressContainer.createDiv({ cls: "sr-progress-meta" });
    this.progressLabel = progressMeta.createSpan({ cls: "sr-progress-label" });
    this.timeLeftLabel = progressMeta.createSpan({ cls: "sr-time-left-label" });

    // Controls Row
    const controls = contentEl.createDiv({ cls: "sr-controls" });

    // Navigation Buttons
    const navGroup = controls.createDiv({ cls: "sr-btn-group" });

    const restartBtn = navGroup.createEl("button", { cls: "sr-icon-btn", attr: { title: "Сначала (r)" } });
    setIcon(restartBtn, "rotate-ccw");
    restartBtn.onclick = () => this.restart();

    const prevSentBtn = navGroup.createEl("button", {
      cls: "sr-icon-btn",
      attr: { title: "Предыдущее предложение ([)" },
    });
    setIcon(prevSentBtn, "chevrons-left");
    prevSentBtn.onclick = () => this.jumpSentence(-1);

    const backBtn = navGroup.createEl("button", {
      cls: "sr-icon-btn",
      attr: { title: `Назад на ${this.settings.stepWordCount} слов (←)` },
    });
    setIcon(backBtn, "skip-back");
    backBtn.onclick = () => this.step(-this.settings.stepWordCount);

    this.playPauseBtn = navGroup.createEl("button", {
      cls: "sr-icon-btn sr-play-btn mod-cta",
      attr: { title: "Старт / Пауза (Пробел)" },
    });
    setIcon(this.playPauseBtn, "play");
    this.playPauseBtn.onclick = () => this.togglePlay();

    const fwdBtn = navGroup.createEl("button", {
      cls: "sr-icon-btn",
      attr: { title: `Вперед на ${this.settings.stepWordCount} слов (→)` },
    });
    setIcon(fwdBtn, "skip-forward");
    fwdBtn.onclick = () => this.step(this.settings.stepWordCount);

    const nextSentBtn = navGroup.createEl("button", {
      cls: "sr-icon-btn",
      attr: { title: "Следующее предложение (])" },
    });
    setIcon(nextSentBtn, "chevrons-right");
    nextSentBtn.onclick = () => this.jumpSentence(1);

    const ttsBtn = navGroup.createEl("button", {
      cls: "sr-icon-btn",
      attr: { title: "Озвучка / tts (m)" },
    });
    setIcon(ttsBtn, this.settings.enableTts ? "volume-2" : "volume-x");
    ttsBtn.onclick = () => this.toggleTts(ttsBtn);

    // Speed Controls
    const speedGroup = controls.createDiv({ cls: "sr-speed-group" });

    const decSpeedLarge = speedGroup.createEl("button", { text: "-50", cls: "sr-small-btn" });
    decSpeedLarge.onclick = () => this.adjustWpm(-50);

    const decSpeedSmall = speedGroup.createEl("button", { text: "-10", cls: "sr-small-btn" });
    decSpeedSmall.onclick = () => this.adjustWpm(-10);

    this.wpmDisplay = speedGroup.createDiv({ cls: "sr-wpm-badge" });

    const incSpeedSmall = speedGroup.createEl("button", { text: "+10", cls: "sr-small-btn" });
    incSpeedSmall.onclick = () => this.adjustWpm(10);

    const incSpeedLarge = speedGroup.createEl("button", { text: "+50", cls: "sr-small-btn" });
    incSpeedLarge.onclick = () => this.adjustWpm(50);

    // Initial render
    this.updateWordDisplay();
    this.updateWpmDisplay();

    // Keyboard handlers live on the modal's own scope: they stop working the
    // moment the modal closes, never leak into the editor, and cooperate with
    // other modals instead of a global `window` listener.
    this.scope.register(null, null, (e: KeyboardEvent) => {
      if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return true;

      switch (e.key) {
        case " ":
          this.togglePlay();
          return false;
        case "ArrowLeft":
          this.step(-this.settings.stepWordCount);
          return false;
        case "ArrowRight":
          this.step(this.settings.stepWordCount);
          return false;
        case "ArrowUp":
          this.adjustWpm(25);
          return false;
        case "ArrowDown":
          this.adjustWpm(-25);
          return false;
        case "[":
          this.jumpSentence(-1);
          return false;
        case "]":
          this.jumpSentence(1);
          return false;
        case "m":
        case "M":
        case "ь":
        case "Ь":
          this.toggleTts(ttsBtn);
          return false;
        case "r":
        case "R":
        case "к":
        case "К":
          this.restart();
          return false;
        default:
          return true;
      }
    });
  }

  onClose() {
    this.pause(false);
    this.stopTts();

    // A seek or a read session must survive closing/restarting Obsidian, but a
    // reader closed without any interaction must keep the previous position.
    if (this.hasInteracted) {
      this.persistProgress();

      // Sync the editor cursor to the word actually being read.
      const word = this.words[this.currentIndex];
      if (this.settings.syncCursorOnClose && this.onSyncCursor && word) {
        this.onSyncCursor(this.currentIndex, word.raw, word.charOffset);
      }
    }

    // Feature 5: Update session analytics
    const sessionSeconds = Math.round(this.activeMs / 1000);
    if (this.sessionWordsRead > 0 && sessionSeconds > 0) {
      this.settings.stats.totalWordsRead += this.sessionWordsRead;
      this.settings.stats.totalSecondsRead += sessionSeconds;
      this.settings.stats.maxWpm = Math.max(this.settings.stats.maxWpm, this.sessionMaxWpm);
      this.settings.stats.sessionsCount += 1;
    }
    if (this.hasInteracted) {
      void this.plugin.saveSettings();
    }

    const { contentEl } = this;
    contentEl.empty();
  }

  private toggleTts(btn?: HTMLElement) {
    this.settings.enableTts = !this.settings.enableTts;
    if (btn) {
      setIcon(btn, this.settings.enableTts ? "volume-2" : "volume-x");
    }
    new Notice(this.settings.enableTts ? "🔊 Озвучка (TTS) включена" : "🔇 Озвучка (TTS) выключена");
    if (!this.settings.enableTts) {
      this.stopTts();
    } else if (this.isPlaying) {
      this.speakFromCurrentSentence();
    }
    void this.plugin.saveSettings();
  }

  private speakFromCurrentSentence(startIndex: number = this.currentIndex) {
    if (!this.settings.enableTts || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
      let end = Math.min(this.words.length - 1, startIndex + (this.settings.chunkSize || 1) - 1);
      while (end < this.words.length - 1 && !isSentenceEnd(this.words[end].raw)) end++;
      this.ttsEndIndex = end;
      const slice = this.words.slice(startIndex, end + 1);
      const text = slice.map((w) => w.raw).join(" ");
      if (!text.trim()) return;

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = Math.max(0.7, Math.min(2.5, this.currentWpm / 190));
      window.speechSynthesis.speak(utterance);
    } catch {
      // Safe fallback if audio context blocked
    }
  }

  private stopTts() {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Safe fallback
      }
    }
  }

  private togglePlay() {
    if (this.isPlaying) {
      this.pause(true);
    } else {
      if (this.completed) {
        this.currentIndex = 0;
        this.completed = false;
        this.updateWordDisplay();
      }
      this.play();
    }
  }

  private play() {
    this.isPlaying = true;
    this.hasInteracted = true;
    this.wordsSinceResume = 0;
    this.isRampingUp = false;
    this.activeSince = Date.now();
    if (this.pauseCardEl) this.pauseCardEl.addClass("sr-hidden");
    setIcon(this.playPauseBtn, "pause");
    this.playPauseBtn.setAttribute("title", "Пауза (Пробел)");
    if (this.settings.enableTts) {
      this.speakFromCurrentSentence();
    }
    this.scheduleNextWord();
  }

  /**
   * Pauses reader.
   * Feature 1: Rewind on Pause (auto-rewind 3-5 words so context is never lost).
   */
  private pause(triggeredByUser: boolean = true) {
    this.isPlaying = false;
    this.accumulateActiveTime();
    this.stopTts();
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.playPauseBtn) {
      setIcon(this.playPauseBtn, "play");
      this.playPauseBtn.setAttribute("title", "Старт (Пробел)");
    }

    // Rewind only over words that were actually read since the last resume:
    // repeatedly starting and pausing must not walk the text backwards, and
    // re-reading a rewound word must not inflate the session counters.
    if (triggeredByUser && this.settings.rewindOnPause && this.wordsSinceResume >= 3) {
      const rewind = Math.min(this.settings.rewindOnPauseWords, this.wordsSinceResume);
      const newIdx = Math.max(0, this.currentIndex - rewind);
      if (newIdx !== this.currentIndex) {
        this.sessionWordsRead = Math.max(0, this.sessionWordsRead - (this.currentIndex - newIdx));
        this.wordsSinceResume = Math.max(0, this.wordsSinceResume - rewind);
        this.currentIndex = newIdx;
        this.updateWordDisplay();
      }
    }

    this.updateWpmDisplay();

    if (this.hasInteracted && this.words.length > 0 && this.noteKey && this.settings.rememberProgress) {
      this.persistProgress();
      void this.plugin.saveSettings();
    }
    if (triggeredByUser && this.settings.showPauseStats !== false) {
      this.renderPauseCard();
    }
  }

  private restart() {
    this.wordsSinceResume = 0;
    this.goToWord(0);
  }

  private step(delta: number) {
    const newIdx = stepIndex(this.currentIndex, delta, this.words.length);
    this.goToWord(newIdx);
  }

  private jumpSentence(direction: -1 | 1) {
    let targetIdx: number;
    if (direction === -1) {
      targetIdx = findPreviousSentenceStart(this.words, this.currentIndex);
    } else {
      targetIdx = findNextSentenceStart(this.words, this.currentIndex);
    }
    this.wordsSinceResume = 0;
    this.goToWord(targetIdx);
  }

  private goToWord(index: number) {
    this.completed = false;
    this.hasInteracted = true;
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    // Seeking is not reading: stop the active clock so dragging the progress
    // bar does not lower the measured reading speed.
    if (this.isPlaying) {
      this.accumulateActiveTime();
      this.activeSince = Date.now();
    }
    this.currentIndex = Math.max(0, Math.min(this.words.length - 1, Number.isFinite(index) ? Math.trunc(index) : 0));
    if (this.isPlaying && this.settings.enableTts) {
      this.speakFromCurrentSentence();
    }
    this.updateWordDisplay();
    if (this.isPlaying) this.scheduleNextWord();
    else if (this.pauseCardEl && !this.pauseCardEl.hasClass("sr-hidden")) this.renderPauseCard();
  }

  private adjustWpm(delta: number) {
    this.currentWpm = Math.max(60, Math.min(1500, this.currentWpm + delta));
    this.updateWpmDisplay();
    if (!this.isPlaying && this.pauseCardEl && !this.pauseCardEl.hasClass("sr-hidden")) this.renderPauseCard();
  }

  private updateWpmDisplay() {
    if (!this.wpmDisplay) return;

    if (this.isPlaying && this.isRampingUp) {
      const rampWpm = calculateRampUpWpm(this.currentWpm, this.wordsSinceResume, this.settings.rampUpWords);
      this.wpmDisplay.setText(`⚡ ${rampWpm} / ${this.currentWpm} WPM`);
    } else {
      this.wpmDisplay.setText(`${this.currentWpm} WPM`);
    }
    this.updateTimeLeft();
  }

  private scheduleNextWord() {
    if (!this.isPlaying) return;

    const stepSize = this.settings.chunkSize || 1;
    if (this.words.length === 0) {
      this.pause(false);
      return;
    }

    // Feature 1: Speed Ramp-up calculation
    let effectiveWpm = this.currentWpm;
    if (this.settings.enableRampUp && this.wordsSinceResume < this.settings.rampUpWords) {
      this.isRampingUp = true;
      effectiveWpm = calculateRampUpWpm(this.currentWpm, this.wordsSinceResume, this.settings.rampUpWords);
    } else {
      this.isRampingUp = false;
    }

    const wordDuration = this.words.slice(this.currentIndex, this.currentIndex + stepSize)
      .reduce((duration, word) => duration + calculateWordDelayMs(effectiveWpm, word.delayMultiplier), 0);

    this.updateWpmDisplay();

    this.timer = window.setTimeout(() => {
      const consumed = Math.min(stepSize, this.words.length - this.currentIndex);
      this.sessionWordsRead += consumed;
      this.sessionMaxWpm = Math.max(this.sessionMaxWpm, effectiveWpm);
      this.wordsSinceResume += consumed;
      if (this.currentIndex + consumed >= this.words.length) {
        this.completed = true;
        this.currentIndex = this.words.length - 1;
        // Keep the final chunk on screen: only the progress moves forward.
        this.updateProgress();
        this.pause(false);
        return;
      }
      this.currentIndex += consumed;

      // Queue the next unread speech segment once, including all sentences
      // touched by a chunk; never cancel several utterances in the same tick.
      if (this.isPlaying && this.settings.enableTts && this.currentIndex > this.ttsEndIndex) {
        this.speakFromCurrentSentence(this.ttsEndIndex + 1);
      }

      this.maybePersistProgress();
      this.updateWordDisplay();
      this.scheduleNextWord();
    }, wordDuration);
  }

  /**
   * Writes the current position into settings without touching the disk.
   */
  private persistProgress() {
    if (!this.noteKey || !this.settings.rememberProgress) return;
    this.settings.noteProgress[this.noteKey] = {
      index: this.currentIndex,
      totalWords: this.words.length,
      timestamp: Date.now(),
    };
    this.lastPersistedIndex = this.currentIndex;
  }

  /**
   * Crash-safe saving: flushes to disk every PROGRESS_SAVE_EVERY words so a
   * forced quit does not lose the reading position.
   */
  private maybePersistProgress() {
    if (!this.noteKey || !this.settings.rememberProgress) return;
    if (Math.abs(this.currentIndex - this.lastPersistedIndex) < PROGRESS_SAVE_EVERY_WORDS) return;
    this.persistProgress();
    void this.plugin.saveSettings();
  }

  private accumulateActiveTime() {
    if (this.activeSince === null) return;
    this.activeMs += Date.now() - this.activeSince;
    this.activeSince = null;
  }

  /**
   * Итоги паузы: сколько прочитано, с какой реальной скоростью, сколько времени
   * сэкономлено против обычного чтения и короткая мотивация.
   */
  private renderPauseCard() {
    if (!this.pauseCardEl) return;

    const activeSeconds = (this.activeMs + (this.activeSince ? Date.now() - this.activeSince : 0)) / 1000;
    const remainingWords = Math.max(0, this.words.length - (this.currentIndex + 1));
    const summary = calculateSessionSummary(
      this.sessionWordsRead,
      activeSeconds,
      this.currentWpm,
      remainingWords
    );

    this.pauseCardEl.empty();
    this.pauseCardEl.addClass("sr-pause-card");

    const head = this.pauseCardEl.createDiv({ cls: "sr-pause-card-head" });
    head.createSpan({ text: "⏸ Пауза", cls: "sr-pause-card-title" });
    head.createSpan({
      text: ` · ${summary.wordsRead.toLocaleString()} слов за ${formatDuration(summary.readSeconds)}`,
      cls: "sr-pause-card-sub",
    });

    if (summary.wordsRead > 0) {
      const wide = this.pauseCardEl.createDiv({ cls: "sr-pause-card-metrics" });
      const metric = (label: string, value: string) => {
        const cell = wide.createDiv({ cls: "sr-pause-metric" });
        cell.createDiv({ text: value, cls: "sr-pause-metric-value" });
        cell.createDiv({ text: label, cls: "sr-pause-metric-label" });
      };
      metric("средняя скорость", `${summary.avgWpm} WPM`);
      metric("быстрее обычного", `×${summary.speedup}`);
      metric("сэкономлено", formatDuration(summary.savedSeconds));
      metric("до конца", formatDuration(summary.remainingMinutes * 60));
    }

    this.pauseCardEl.createDiv({
      text: buildMotivationLine(summary.avgWpm, this.currentWpm),
      cls: "sr-pause-card-motivation",
    });

    const pct = calculateProgressPercent(this.currentIndex, this.words.length);
    this.pauseCardEl.createDiv({
      text: `Прогресс ${pct}% · ${this.currentIndex + 1} / ${this.words.length} слов`,
      cls: "sr-pause-card-progress",
    });

    this.pauseCardEl.removeClass("sr-hidden");
  }

  private updateWordDisplay() {
    const word = this.words[this.currentIndex];
    if (!word) return;

    const chunkSize = this.settings.chunkSize || 1;

    if (chunkSize > 1) {
      // Feature 2: Chunking mode (2-3 words at a time)
      this.prefixEl.addClass("sr-hidden");
      this.focusEl.addClass("sr-hidden");
      this.suffixEl.addClass("sr-hidden");
      this.chunkEl.removeClass("sr-hidden");

      const chunkSlice = this.words.slice(this.currentIndex, this.currentIndex + chunkSize);
      this.chunkEl.empty();

      for (const w of chunkSlice) {
        const itemSpan = this.chunkEl.createSpan({ cls: "sr-chunk-word" });
        if (this.settings.bionicInChunks) {
          // Bionic reading: bold first 40-50% of word
          const boldLen = Math.max(1, Math.ceil(w.raw.length * 0.45));
          itemSpan.createEl("b", { text: w.raw.slice(0, boldLen) });
          itemSpan.createSpan({ text: w.raw.slice(boldLen) });
        } else {
          itemSpan.setText(w.raw);
        }
      }
    } else {
      // Classic ORP mode (1 word)
      this.chunkEl.addClass("sr-hidden");
      this.prefixEl.removeClass("sr-hidden");
      this.focusEl.removeClass("sr-hidden");
      this.suffixEl.removeClass("sr-hidden");

      this.prefixEl.setText(word.prefix);
      this.focusEl.setText(word.focusChar);
      this.suffixEl.setText(word.suffix);
    }

    this.updateProgress();
  }

  /** Progress bar, label, time left and context, without re-rendering the word. */
  private updateProgress() {
    if (this.progressBar) {
      this.progressBar.value = `${this.currentIndex}`;
    }

    const pct = calculateProgressPercent(this.currentIndex, this.words.length);
    if (this.progressLabel) {
      this.progressLabel.setText(`${this.currentIndex + 1} / ${this.words.length} (${pct}%)`);
    }

    this.updateTimeLeft();
    this.updateContext();
  }

  private updateTimeLeft() {
    if (!this.timeLeftLabel) return;
    const remainingWords = this.words.length - (this.currentIndex + 1);
    this.timeLeftLabel.setText(formatTimeRemaining(remainingWords, this.currentWpm));
  }

  private updateContext() {
    if (!this.contextEl) return;
    const start = Math.max(0, this.currentIndex - 3);
    const end = Math.min(this.words.length, this.currentIndex + 4);

    // Built as DOM nodes on purpose: note text must never be parsed as HTML.
    this.contextEl.empty();
    if (start > 0) this.contextEl.appendText("... ");
    for (let i = start; i < end; i++) {
      if (i > start) this.contextEl.appendText(" ");
      if (i === this.currentIndex) {
        this.contextEl.createEl("b", { text: this.words[i].raw });
      } else {
        this.contextEl.appendText(this.words[i].raw);
      }
    }
    if (end < this.words.length) this.contextEl.appendText(" ...");
  }
}
