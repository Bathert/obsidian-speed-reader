/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import { App, Modal, Notice, setIcon } from "obsidian";
import { extractHeadings, HeadingItem, ParsedWord, parseWords } from "./textParser";
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
  findSentenceBounds,
  formatTimeRemaining,
  isSentenceEndWord,
  stepIndex,
} from "./speedEngine";
import { detectSpeechLang, I18N, resolveLanguage } from "./i18n";
import { synthesizeSpeech, splitForSpeech, UnrealSpeechError } from "./unrealSpeech";

/** Flush the reading position to disk every N words. */
const PROGRESS_SAVE_EVERY_WORDS = 25;

export interface ReaderModalCallbacks {
  onSyncCursor?: (wordIndex: number, rawWord: string, charOffset?: number) => void;
  onHighlightSentence?: (startWord: ParsedWord, endWord: ParsedWord, sentenceText: string) => boolean;
  initialIndex?: number;
}

export class SpeedReaderModal extends Modal {
  private plugin: SpeedReaderPlugin;
  private words: ParsedWord[] = [];
  private headings: HeadingItem[] = [];
  private currentIndex: number = 0;
  private isPlaying: boolean = false;
  private completed: boolean = false;
  private ttsEndIndex: number = -1;
  private timer: number | null = null;
  /** Token that invalidates in-flight cloud speech when playback stops. */
  private speechToken: number = 0;
  private audioEl: HTMLAudioElement | null = null;
  private speechObjectUrl: string | null = null;
  private speechFallbackNoticeShown: boolean = false;
  /** True while a cloud sentence is being fetched or played. */
  private speechBusy: boolean = false;
  private currentWpm: number;
  private settings: SpeedReaderSettings;
  private titleText: string;
  private noteKey: string;
  private onSyncCursor?: (wordIndex: number, rawWord: string, charOffset?: number) => void;
  private onHighlightSentence?: (startWord: ParsedWord, endWord: ParsedWord, sentenceText: string) => boolean;

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
  private wordsSinceAcceleration: number = 0;
  /** Words rewound on pause that must not be counted twice when replayed. */
  private rewoundWordsDebt: number = 0;
  /** First word of the chunk that was on screen when the text ended. */
  private finalChunkStart: number | null = null;
  private isRampingUp: boolean = false;
  private lastPersistedIndex: number = 0;
  // Активное время чтения без пауз — база для честной средней скорости.
  private activeSince: number | null = null;
  private activeMs: number = 0;
  private touchStartX: number = 0;
  private touchStartY: number = 0;

  // DOM Elements
  private resumeBannerEl!: HTMLElement;
  private tocSelectEl: HTMLSelectElement | null = null;
  private wordBoxEl!: HTMLElement;
  private prefixEl!: HTMLElement;
  private focusEl!: HTMLElement;
  private suffixEl!: HTMLElement;
  private chunkEl!: HTMLElement;
  private contextEl!: HTMLElement;
  private pauseCardEl!: HTMLElement;
  private playPauseBtn!: HTMLElement;
  private zenBtn: HTMLElement | null = null;
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
    callbacksOrSync?:
      | ((wordIndex: number, rawWord: string, charOffset?: number) => void)
      | ReaderModalCallbacks
  ) {
    super(app);
    this.plugin = plugin;
    this.settings = plugin.settings;
    this.currentWpm = this.settings.defaultWpm;
    this.titleText = title;
    this.noteKey = noteKey;

    if (typeof callbacksOrSync === "function") {
      this.onSyncCursor = callbacksOrSync;
    } else if (callbacksOrSync) {
      this.onSyncCursor = callbacksOrSync.onSyncCursor;
      this.onHighlightSentence = callbacksOrSync.onHighlightSentence;
    }

    this.words = parseWords(text, {
      pauseOnPunctuation: this.settings.pauseOnPunctuation,
      sentencePauseMultiplier: this.settings.sentencePauseMultiplier,
      commaPauseMultiplier: this.settings.commaPauseMultiplier,
      pauseOnParagraphs: this.settings.pauseOnParagraphs,
      paragraphPauseMultiplier: this.settings.paragraphPauseMultiplier,
      pauseOnNumbersAndAcronyms: this.settings.pauseOnNumbersAndAcronyms,
      spritzVariableTiming: this.settings.spritzVariableTiming,
      orpWidth: this.settings.orpWidth ?? 1,
      readCodeBlocks: this.settings.readCodeBlocks,
    });

    this.headings = extractHeadings(text, this.words);

    if (typeof callbacksOrSync === "object" && typeof callbacksOrSync?.initialIndex === "number") {
      this.currentIndex = Math.max(0, Math.min(this.words.length - 1, Math.trunc(callbacksOrSync.initialIndex)));
    }
  }

  private get lang() {
    return resolveLanguage(this.settings.uiLanguage);
  }

  private get t() {
    return I18N[this.lang];
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
      contentEl.createEl("h3", { text: this.t.emptySelectionOrNote });
      const closeBtn = contentEl.createEl("button", { text: this.t.close, cls: "mod-cta" });
      closeBtn.onclick = () => this.close();
      return;
    }

    // Feature 3: Resume Banner (if previous progress exists)
    const saved = this.noteKey && this.settings.rememberProgress ? this.settings.noteProgress[this.noteKey] : null;
    if (this.currentIndex === 0 && saved && saved.index > 0 && saved.index < this.words.length - 1) {
      this.resumeBannerEl = contentEl.createDiv({ cls: "sr-resume-banner" });
      const pct = Math.round(((saved.index + 1) / this.words.length) * 100);
      this.resumeBannerEl.createSpan({
        text: this.t.resumeProgress(saved.index + 1, this.words.length, pct),
      });
      const resumeBtnGroup = this.resumeBannerEl.createDiv({ cls: "sr-resume-btn-group" });

      const resumeBtn = resumeBtnGroup.createEl("button", {
        text: this.t.resumeBtn,
        cls: "mod-cta sr-small-btn",
      });
      resumeBtn.onclick = () => {
        this.goToWord(saved.index);
        this.resumeBannerEl.remove();
      };

      const startOverBtn = resumeBtnGroup.createEl("button", {
        text: this.t.startOverBtn,
        cls: "sr-small-btn",
      });
      startOverBtn.onclick = () => {
        this.goToWord(0);
        this.resumeBannerEl.remove();
      };
    }

    // Modal Header
    const header = contentEl.createDiv({ cls: "sr-header" });
    const titleRow = header.createDiv({ cls: "sr-title-row" });
    const titleEl = titleRow.createDiv({ cls: "sr-title" });
    titleEl.createSpan({ text: this.titleText, cls: "sr-title-name" });
    titleEl.createSpan({ text: this.t.wordsCount(this.words.length), cls: "sr-title-meta" });

    // Table of contents: jump to any heading of the note.
    if (this.headings.length > 0) {
      this.tocSelectEl = titleRow.createEl("select", { cls: "sr-toc-select dropdown" });
      this.tocSelectEl.createEl("option", { text: this.t.tocPlaceholder, value: "" });
      for (const heading of this.headings) {
        const prefix = heading.level > 1 ? `${"—".repeat(heading.level - 1)} ` : "";
        this.tocSelectEl.createEl("option", {
          text: `${prefix}${heading.title}`,
          value: String(heading.wordIndex),
        });
      }
      this.tocSelectEl.onchange = () => {
        if (!this.tocSelectEl || this.tocSelectEl.value === "") return;
        this.goToWord(parseInt(this.tocSelectEl.value, 10));
      };
    }

    const hints = header.createDiv({ cls: "sr-shortcuts-hint" });
    hints.setText(this.t.shortcutsHint);

    // RSVP Display Frame
    const frame = contentEl.createDiv({ cls: "sr-frame" });
    if (this.settings.redicleAlignment === "spritz") {
      frame.addClass("sr-redicle-spritz");
    }
    frame.setCssProps({ "--sr-font-size": `${this.settings.fontSize}px` });

    this.registerFrameGestures(frame);

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

    const restartBtn = navGroup.createEl("button", { cls: "sr-icon-btn", attr: { title: this.t.restartTitle } });
    setIcon(restartBtn, "rotate-ccw");
    restartBtn.onclick = () => this.restart();

    const prevSentBtn = navGroup.createEl("button", {
      cls: "sr-icon-btn",
      attr: { title: this.t.prevSentenceTitle },
    });
    setIcon(prevSentBtn, "chevrons-left");
    prevSentBtn.onclick = () => this.jumpSentence(-1);

    const backBtn = navGroup.createEl("button", {
      cls: "sr-icon-btn",
      attr: { title: this.t.stepBackTitle(this.settings.stepWordCount) },
    });
    setIcon(backBtn, "skip-back");
    backBtn.onclick = () => this.step(-this.settings.stepWordCount);

    this.playPauseBtn = navGroup.createEl("button", {
      cls: "sr-icon-btn sr-play-btn mod-cta",
      attr: { title: this.t.playPauseTitle },
    });
    setIcon(this.playPauseBtn, "play");
    this.playPauseBtn.onclick = () => this.togglePlay();

    const fwdBtn = navGroup.createEl("button", {
      cls: "sr-icon-btn",
      attr: { title: this.t.stepForwardTitle(this.settings.stepWordCount) },
    });
    setIcon(fwdBtn, "skip-forward");
    fwdBtn.onclick = () => this.step(this.settings.stepWordCount);

    const nextSentBtn = navGroup.createEl("button", {
      cls: "sr-icon-btn",
      attr: { title: this.t.nextSentenceTitle },
    });
    setIcon(nextSentBtn, "chevrons-right");
    nextSentBtn.onclick = () => this.jumpSentence(1);

    const ttsBtn = navGroup.createEl("button", {
      cls: "sr-icon-btn",
      attr: { title: this.t.ttsTitle },
    });
    setIcon(ttsBtn, this.settings.enableTts ? "volume-2" : "volume-x");
    ttsBtn.onclick = () => this.toggleTts(ttsBtn);

    const highlightBtn = navGroup.createEl("button", {
      cls: "sr-icon-btn",
      attr: { title: this.t.highlightTitle },
    });
    setIcon(highlightBtn, "highlighter");
    highlightBtn.onclick = () => this.highlightCurrentSentence();

    this.zenBtn = navGroup.createEl("button", {
      cls: `sr-icon-btn${this.settings.zenMode ? " sr-btn-active" : ""}`,
      attr: { title: this.t.zenTitle },
    });
    setIcon(this.zenBtn, "maximize-2");
    this.zenBtn.onclick = () => this.toggleZenMode();

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
        case "h":
        case "H":
        case "р":
        case "Р":
          this.highlightCurrentSentence();
          return false;
        case "f":
        case "F":
        case "а":
        case "А":
          this.toggleZenMode();
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

  /** Touch and swipe gestures on the reading frame (mobile). */
  private registerFrameGestures(frame: HTMLElement) {
    frame.ontouchstart = (event: TouchEvent) => {
      const touch = event.changedTouches?.[0];
      if (!touch) return;
      this.touchStartX = touch.clientX;
      this.touchStartY = touch.clientY;
    };

    frame.ontouchend = (event: TouchEvent) => {
      const touch = event.changedTouches?.[0];
      if (!touch) return;
      const dx = touch.clientX - this.touchStartX;
      const dy = touch.clientY - this.touchStartY;
      if (Math.abs(dy) > 35 && Math.abs(dy) > Math.abs(dx)) {
        this.adjustWpm(dy < 0 ? 25 : -25);
        return;
      }
      if (Math.abs(dx) < 20 && Math.abs(dy) < 20) {
        const rect = typeof frame.getBoundingClientRect === "function" ? frame.getBoundingClientRect() : null;
        if (rect && rect.width > 0) {
          const relX = (touch.clientX - rect.left) / rect.width;
          if (relX < 0.3) this.step(-this.settings.stepWordCount);
          else if (relX > 0.7) this.step(this.settings.stepWordCount);
          else this.togglePlay();
        } else {
          this.togglePlay();
        }
      }
    };
  }

  private toggleZenMode() {
    this.settings.zenMode = !this.settings.zenMode;
    if (this.zenBtn) this.zenBtn.toggleClass("sr-btn-active", this.settings.zenMode);
    this.syncZenClass();
    void this.plugin.saveSettings();
  }

  private syncZenClass() {
    this.modalEl.toggleClass("sr-zen-active", Boolean(this.isPlaying && this.settings.zenMode));
  }

  private highlightCurrentSentence() {
    if (this.words.length === 0) return;
    const { start, end } = findSentenceBounds(this.words, this.currentIndex);
    const startWord = this.words[start];
    const endWord = this.words[end];
    const sentenceText = this.words.slice(start, end + 1).map((word) => word.raw).join(" ");

    if (this.onHighlightSentence && startWord && endWord) {
      const applied = this.onHighlightSentence(startWord, endWord, sentenceText);
      if (applied) {
        new Notice(this.t.highlightedNotice);
        return;
      }
    }

    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(sentenceText);
    }
    new Notice(this.t.highlightCopiedNotice);
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
    if (!this.settings.enableTts) return;

    let end = Math.min(this.words.length - 1, startIndex + (this.settings.chunkSize || 1) - 1);
    while (end < this.words.length - 1 && !isSentenceEndWord(this.words[end].raw)) end++;
    this.ttsEndIndex = end;
    const text = this.words.slice(startIndex, end + 1).map((word) => word.raw).join(" ");

    if (this.settings.ttsProvider === "unrealspeech" && this.settings.unrealSpeechApiKey.trim()) {
      void this.speakWithUnrealSpeech(text);
      return;
    }

    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
      if (!text.trim()) return;

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = detectSpeechLang(text);
      utterance.rate = Math.max(0.7, Math.min(2.5, this.currentWpm / 190));
      window.speechSynthesis.speak(utterance);
    } catch {
      // Safe fallback if audio context blocked
    }
  }

  /** Cloud speech: fetch the sentence in <=1000-char chunks and play them. */
  private async speakWithUnrealSpeech(text: string): Promise<void> {
    // One sentence at a time: a new sentence must not cut off the audio that is
    // still being fetched or played.
    if (this.speechBusy) return;
    const token = this.speechToken;
    this.speechBusy = true;
    const chunks = splitForSpeech(text);
    try {
      for (const chunk of chunks) {
        if (token !== this.speechToken || !this.isPlaying) return;
        try {
          const audioBytes = await synthesizeSpeech(chunk, {
            apiKey: this.settings.unrealSpeechApiKey,
            voiceId: this.settings.unrealSpeechVoiceId,
            wpm: this.currentWpm,
          });
          // The request is billed even if playback stopped meanwhile.
          this.settings.unrealSpeechCharsUsed += chunk.length;
          if (token !== this.speechToken || !this.isPlaying) return;
          await this.playAudioBytes(audioBytes, token);
        } catch (error) {
          if (token !== this.speechToken) return;
          this.reportSpeechError(error, text);
          return;
        }
      }
    } finally {
      this.speechBusy = false;
    }
  }

  /** Plays MP3 bytes and resolves when the chunk ends. */
  private playAudioBytes(bytes: ArrayBuffer, token: number): Promise<void> {
    if (typeof Audio === "undefined") return Promise.resolve();
    return new Promise((resolve) => {
      const url = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
      this.speechObjectUrl = url;
      const audio = new Audio(url);
      this.audioEl = audio;
      const finish = () => {
        URL.revokeObjectURL(url);
        if (this.speechObjectUrl === url) this.speechObjectUrl = null;
        if (this.audioEl === audio) this.audioEl = null;
        resolve();
      };
      audio.onended = finish;
      audio.onerror = finish;
      audio.play().catch(finish);
      if (token !== this.speechToken) {
        audio.pause();
        finish();
      }
    });
  }

  private cancelAudio() {
    if (this.audioEl) {
      this.audioEl.pause();
      this.audioEl = null;
    }
    if (this.speechObjectUrl) {
      URL.revokeObjectURL(this.speechObjectUrl);
      this.speechObjectUrl = null;
    }
  }

  /** Reports quota/key problems once and falls back to the system voice. */
  private reportSpeechError(error: unknown, text: string) {
    const speechError = error instanceof UnrealSpeechError ? error : null;
    const message = speechError ? speechError.message : "Unreal Speech недоступен.";
    if (!this.speechFallbackNoticeShown) {
      this.speechFallbackNoticeShown = true;
      new Notice(
        `⚠️ ${message}${this.canUseSystemSpeech() ? " Переключаюсь на системный голос." : ""}`,
        9000
      );
    }
    if (!this.canUseSystemSpeech()) return;
    try {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = detectSpeechLang(text);
      utterance.rate = Math.max(0.7, Math.min(2.5, this.currentWpm / 190));
      window.speechSynthesis.speak(utterance);
    } catch {
      // Nothing else we can do.
    }
  }

  private canUseSystemSpeech(): boolean {
    return typeof window !== "undefined" && "speechSynthesis" in window;
  }

  private stopTts() {
    this.speechToken += 1;
    this.cancelAudio();
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
    this.syncZenClass();
    if (this.pauseCardEl) this.pauseCardEl.addClass("sr-hidden");
    setIcon(this.playPauseBtn, "pause");
    this.playPauseBtn.setAttribute("title", this.t.pauseTitle);
    this.updateContext();
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
    this.syncZenClass();
    this.stopTts();
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.playPauseBtn) {
      setIcon(this.playPauseBtn, "play");
      this.playPauseBtn.setAttribute("title", this.t.playTitle);
    }

    // Rewind only over words that were actually read since the last resume:
    // repeatedly starting and pausing must not walk the text backwards, and
    // re-reading a rewound word must not inflate the session counters.
    if (triggeredByUser && this.settings.rewindOnPause && this.wordsSinceResume >= 3) {
      const rewind = Math.min(this.settings.rewindOnPauseWords, this.wordsSinceResume);
      const newIdx = Math.max(0, this.currentIndex - rewind);
      if (newIdx !== this.currentIndex) {
        // Do not subtract from sessionWordsRead: the pause card must still show
        // the words actually read. Replaying them later is absorbed by the debt.
        this.rewoundWordsDebt += this.currentIndex - newIdx;
        this.wordsSinceResume = 0;
        this.currentIndex = newIdx;
        this.updateWordDisplay();
      }
    }

    this.updateWpmDisplay();
    // Pausing always widens the context, even when rewind is off or no words
    // were read yet.
    this.updateContext();

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
    this.wordsSinceAcceleration = 0;
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
    this.finalChunkStart = null;
    this.hasInteracted = true;
    // A manual jump invalidates the rewind compensation from the old position.
    this.rewoundWordsDebt = 0;
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
      if (this.rewoundWordsDebt > 0) {
        const absorbed = Math.min(this.rewoundWordsDebt, consumed);
        this.rewoundWordsDebt -= absorbed;
        this.sessionWordsRead += consumed - absorbed;
      } else {
        this.sessionWordsRead += consumed;
      }
      this.sessionMaxWpm = Math.max(this.sessionMaxWpm, effectiveWpm);
      this.wordsSinceResume += consumed;

      // Trainer mode: raise the target speed every N read words, up to the cap.
      if (this.settings.autoAccelerate && this.settings.autoAccelerateIntervalWords > 0) {
        this.wordsSinceAcceleration += consumed;
        if (this.wordsSinceAcceleration >= this.settings.autoAccelerateIntervalWords) {
          this.wordsSinceAcceleration %= this.settings.autoAccelerateIntervalWords;
          const cap = Math.max(this.currentWpm, this.settings.maxWpmLimit || 600);
          this.currentWpm = Math.min(cap, this.currentWpm + (this.settings.autoAccelerateStep || 10));
        }
      }
      if (this.currentIndex + consumed >= this.words.length) {
        this.completed = true;
        this.finalChunkStart = this.currentIndex;
        this.currentIndex = this.words.length - 1;
        // Keep the whole final chunk on screen and move progress to 100%.
        if (stepSize > 1) this.updateWordDisplay();
        else this.updateProgress();
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
    head.createSpan({ text: this.t.pauseTitleText, cls: "sr-pause-card-title" });
    head.createSpan({
      text: this.t.pauseSubText(
        summary.wordsRead.toLocaleString(),
        formatDuration(summary.readSeconds, this.lang)
      ),
      cls: "sr-pause-card-sub",
    });

    if (summary.wordsRead > 0) {
      const wide = this.pauseCardEl.createDiv({ cls: "sr-pause-card-metrics" });
      const metric = (label: string, value: string) => {
        const cell = wide.createDiv({ cls: "sr-pause-metric" });
        cell.createDiv({ text: value, cls: "sr-pause-metric-value" });
        cell.createDiv({ text: label, cls: "sr-pause-metric-label" });
      };
      metric(this.t.metricAvgWpm, `${summary.avgWpm} WPM`);
      metric(this.t.metricSpeedup, `×${summary.speedup}`);
      metric(this.t.metricSaved, formatDuration(summary.savedSeconds, this.lang));
      metric(this.t.metricRemaining, formatDuration(summary.remainingMinutes * 60, this.lang));
    }

    this.pauseCardEl.createDiv({
      text: buildMotivationLine(summary.avgWpm, this.currentWpm, this.lang),
      cls: "sr-pause-card-motivation",
    });

    const pct = calculateProgressPercent(this.currentIndex, this.words.length);
    this.pauseCardEl.createDiv({
      text: this.t.pauseProgress(pct, this.currentIndex + 1, this.words.length),
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

      const chunkStart = this.completed && this.finalChunkStart !== null
        ? this.finalChunkStart
        : this.currentIndex;
      const chunkSlice = this.words.slice(chunkStart, chunkStart + chunkSize);
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

    // Follow the current chapter in the table of contents.
    if (this.tocSelectEl && this.headings.length > 0) {
      let activeHeading = -1;
      for (let i = 0; i < this.headings.length; i++) {
        if (this.headings[i].wordIndex <= this.currentIndex) activeHeading = i;
        else break;
      }
      const targetValue = activeHeading >= 0 ? String(this.headings[activeHeading].wordIndex) : "";
      if (this.tocSelectEl.value !== targetValue) this.tocSelectEl.value = targetValue;
    }

    this.updateTimeLeft();
    this.updateContext();
  }

  private updateTimeLeft() {
    if (!this.timeLeftLabel) return;
    const remainingWords = this.words.length - (this.currentIndex + 1);
    this.timeLeftLabel.setText(formatTimeRemaining(remainingWords, this.currentWpm, this.lang));
  }

  private updateContext() {
    if (!this.contextEl) return;
    // Paused: 15 clickable words around the current one; playing: a compact line.
    const isPaused = !this.isPlaying;
    const radius = isPaused ? 7 : 3;
    const start = Math.max(0, this.currentIndex - radius);
    const end = Math.min(this.words.length, this.currentIndex + radius + 1);

    // Built as DOM nodes on purpose: note text must never be parsed as HTML.
    this.contextEl.empty();
    this.contextEl.toggleClass("sr-context-expanded", isPaused);
    if (start > 0) this.contextEl.appendText("... ");
    for (let i = start; i < end; i++) {
      if (i > start) this.contextEl.appendText(" ");
      if (i === this.currentIndex) {
        this.contextEl.createEl("b", { text: this.words[i].raw });
      } else if (isPaused) {
        const wordSpan = this.contextEl.createSpan({ text: this.words[i].raw, cls: "sr-context-word" });
        const targetIndex = i;
        wordSpan.onclick = () => this.goToWord(targetIndex);
      } else {
        this.contextEl.appendText(this.words[i].raw);
      }
    }
    if (end < this.words.length) this.contextEl.appendText(" ...");
  }
}
