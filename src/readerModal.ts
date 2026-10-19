import { App, Modal, Notice, setIcon } from "obsidian";
import { ParsedWord, parseWords } from "./textParser";
import type { SpeedReaderSettings } from "./settings";
import type SpeedReaderPlugin from "./main";
import {
  calculateProgressPercent,
  calculateRampUpWpm,
  calculateWordDelayMs,
  findNextSentenceStart,
  findPreviousSentenceStart,
  formatTimeRemaining,
  stepIndex,
} from "./speedEngine";

export class SpeedReaderModal extends Modal {
  private plugin: SpeedReaderPlugin;
  private words: ParsedWord[] = [];
  private currentIndex: number = 0;
  private isPlaying: boolean = false;
  private timer: number | null = null;
  private currentWpm: number;
  private settings: SpeedReaderSettings;
  private titleText: string;
  private noteKey: string;
  private onSyncCursor?: (wordIndex: number, rawWord: string) => void;

  // Session stats & ramp-up tracking
  private sessionWordsRead: number = 0;
  private sessionStartTime: number = Date.now();
  private isRampingUp: boolean = false;

  // DOM Elements
  private resumeBannerEl!: HTMLElement;
  private wordBoxEl!: HTMLElement;
  private prefixEl!: HTMLElement;
  private focusEl!: HTMLElement;
  private suffixEl!: HTMLElement;
  private chunkEl!: HTMLElement;
  private contextEl!: HTMLElement;
  private playPauseBtn!: HTMLElement;
  private progressBar!: HTMLInputElement;
  private progressLabel!: HTMLElement;
  private timeLeftLabel!: HTMLElement;
  private wpmDisplay!: HTMLElement;
  private keydownHandler!: (e: KeyboardEvent) => void;

  constructor(
    app: App,
    plugin: SpeedReaderPlugin,
    text: string,
    title: string,
    noteKey: string = "",
    onSyncCursor?: (wordIndex: number, rawWord: string) => void
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
    });
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    contentEl.empty();
    modalEl.addClass("sr-modal-container");
    if (this.settings.themeMode !== "default") {
      modalEl.addClass(`sr-theme-${this.settings.themeMode}`);
    }

    if (this.words.length === 0) {
      contentEl.createEl("h3", { text: "No readable words found in selection or note." });
      const closeBtn = contentEl.createEl("button", { text: "Close", cls: "mod-cta" });
      closeBtn.onclick = () => this.close();
      return;
    }

    // Feature 3: Resume Banner (if previous progress exists)
    const saved = this.noteKey ? this.settings.noteProgress[this.noteKey] : null;
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
    frame.style.setProperty("--sr-font-size", `${this.settings.fontSize}px`);

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
    this.chunkEl.style.display = "none";

    if (this.settings.highlightOrp) {
      this.focusEl.style.color = this.settings.orpColor;
    }

    if (this.settings.showFixationGuide && this.settings.chunkSize === 1) {
      const bottomGuide = frame.createDiv({ cls: "sr-guide sr-guide-bottom" });
      bottomGuide.createDiv({ cls: "sr-notch sr-notch-up" });
    }

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

    const restartBtn = navGroup.createEl("button", { cls: "sr-icon-btn", attr: { title: "Сначала (R)" } });
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
      attr: { title: "Озвучка / TTS (M)" },
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

    // Keyboard handlers
    this.keydownHandler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.code === "Space") {
        e.preventDefault();
        this.togglePlay();
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        this.step(-this.settings.stepWordCount);
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        this.step(this.settings.stepWordCount);
      } else if (e.code === "ArrowUp") {
        e.preventDefault();
        this.adjustWpm(25);
      } else if (e.code === "ArrowDown") {
        e.preventDefault();
        this.adjustWpm(-25);
      } else if (e.code === "BracketLeft") {
        e.preventDefault();
        this.jumpSentence(-1);
      } else if (e.code === "BracketRight") {
        e.preventDefault();
        this.jumpSentence(1);
      } else if (e.key === "m" || e.key === "M" || e.key === "ь" || e.key === "Ь") {
        e.preventDefault();
        this.toggleTts(ttsBtn);
      } else if (e.key === "r" || e.key === "R" || e.key === "к" || e.key === "К") {
        e.preventDefault();
        this.restart();
      }
    };
    window.addEventListener("keydown", this.keydownHandler);
  }

  onClose() {
    this.pause(false);
    this.stopTts();
    if (this.keydownHandler) {
      window.removeEventListener("keydown", this.keydownHandler);
    }

    // Feature 3: Save progress & cursor sync
    if (this.noteKey && this.settings.rememberProgress) {
      this.settings.noteProgress[this.noteKey] = {
        index: this.currentIndex,
        totalWords: this.words.length,
        timestamp: Date.now(),
      };
    }

    // Feature 3: Sync cursor in editor
    if (this.settings.syncCursorOnClose && this.onSyncCursor && this.words[this.currentIndex]) {
      this.onSyncCursor(this.currentIndex, this.words[this.currentIndex].raw);
    }

    // Feature 5: Update session analytics
    const sessionSeconds = Math.round((Date.now() - this.sessionStartTime) / 1000);
    if (this.sessionWordsRead > 0 && sessionSeconds > 0) {
      this.settings.stats.totalWordsRead += this.sessionWordsRead;
      this.settings.stats.totalSecondsRead += sessionSeconds;
      this.settings.stats.maxWpm = Math.max(this.settings.stats.maxWpm, this.currentWpm);
      this.settings.stats.sessionsCount += 1;
      this.plugin.saveSettings();
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
    this.plugin.saveSettings();
  }

  private speakFromCurrentSentence() {
    if (!this.settings.enableTts || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
      const end = findNextSentenceStart(this.words, this.currentIndex);
      const slice = this.words.slice(this.currentIndex, end + 1);
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
      if (this.currentIndex >= this.words.length - 1) {
        this.currentIndex = 0;
      }
      this.play();
    }
  }

  private play() {
    this.isPlaying = true;
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
    this.stopTts();
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.playPauseBtn) {
      setIcon(this.playPauseBtn, "play");
      this.playPauseBtn.setAttribute("title", "Старт (Пробел)");
    }

    // Rewind on pause if user pressed pause and read at least some words
    if (triggeredByUser && this.settings.rewindOnPause && this.sessionWordsRead >= 3) {
      const newIdx = Math.max(0, this.currentIndex - this.settings.rewindOnPauseWords);
      if (newIdx !== this.currentIndex) {
        this.currentIndex = newIdx;
        this.updateWordDisplay();
      }
    }

    this.updateWpmDisplay();
  }

  private restart() {
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
    this.goToWord(targetIdx);
  }

  private goToWord(index: number) {
    this.currentIndex = index;
    if (this.isPlaying && this.settings.enableTts) {
      this.speakFromCurrentSentence();
    }
    this.updateWordDisplay();
  }

  private adjustWpm(delta: number) {
    this.currentWpm = Math.max(60, Math.min(1500, this.currentWpm + delta));
    this.updateWpmDisplay();
  }

  private updateWpmDisplay() {
    if (!this.wpmDisplay) return;

    if (this.isPlaying && this.isRampingUp) {
      const rampWpm = calculateRampUpWpm(this.currentWpm, this.sessionWordsRead, this.settings.rampUpWords);
      this.wpmDisplay.setText(`⚡ ${rampWpm} / ${this.currentWpm} WPM`);
    } else {
      this.wpmDisplay.setText(`${this.currentWpm} WPM`);
    }
    this.updateTimeLeft();
  }

  private scheduleNextWord() {
    if (!this.isPlaying) return;

    const stepSize = this.settings.chunkSize || 1;
    if (this.currentIndex >= this.words.length - 1) {
      this.pause(false);
      return;
    }

    // Feature 1: Speed Ramp-up calculation
    let effectiveWpm = this.currentWpm;
    if (this.settings.enableRampUp && this.sessionWordsRead < this.settings.rampUpWords) {
      this.isRampingUp = true;
      effectiveWpm = calculateRampUpWpm(this.currentWpm, this.sessionWordsRead, this.settings.rampUpWords);
    } else {
      this.isRampingUp = false;
    }

    const currentWord = this.words[this.currentIndex];
    const wordDuration = calculateWordDelayMs(effectiveWpm, currentWord.delayMultiplier);

    this.updateWpmDisplay();

    this.timer = window.setTimeout(() => {
      const prevWord = this.words[this.currentIndex];
      this.currentIndex = Math.min(this.words.length - 1, this.currentIndex + stepSize);
      this.sessionWordsRead += stepSize;

      // Sentence boundary crossed: speak next sentence if TTS active
      if (this.isPlaying && this.settings.enableTts && prevWord && /[.!?…]+["')\]}]*$/.test(prevWord.raw)) {
        this.speakFromCurrentSentence();
      }

      this.updateWordDisplay();
      this.scheduleNextWord();
    }, wordDuration);
  }

  private updateWordDisplay() {
    const word = this.words[this.currentIndex];
    if (!word) return;

    const chunkSize = this.settings.chunkSize || 1;

    if (chunkSize > 1) {
      // Feature 2: Chunking mode (2-3 words at a time)
      this.prefixEl.style.display = "none";
      this.focusEl.style.display = "none";
      this.suffixEl.style.display = "none";
      this.chunkEl.style.display = "flex";

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
      this.chunkEl.style.display = "none";
      this.prefixEl.style.display = "inline-block";
      this.focusEl.style.display = "inline-block";
      this.suffixEl.style.display = "inline-block";

      this.prefixEl.setText(word.prefix);
      this.focusEl.setText(word.focusChar);
      this.suffixEl.setText(word.suffix);
    }

    // Update progress bar
    if (this.progressBar) {
      this.progressBar.value = `${this.currentIndex}`;
    }

    // Update progress label: 42 / 300 (14%)
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

    const parts: string[] = [];
    for (let i = start; i < end; i++) {
      if (i === this.currentIndex) {
        parts.push(`<b>${this.words[i].raw}</b>`);
      } else {
        parts.push(this.words[i].raw);
      }
    }
    this.contextEl.innerHTML = (start > 0 ? "... " : "") + parts.join(" ") + (end < this.words.length ? " ..." : "");
  }
}
