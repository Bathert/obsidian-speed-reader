import { App, PluginSettingTab, Setting } from "obsidian";
import type SpeedReaderPlugin from "./main";
import { calculateTimeSavedMinutes } from "./speedEngine";

export interface NoteProgressRecord {
  index: number;
  totalWords: number;
  timestamp: number;
}

export interface ReaderStats {
  totalWordsRead: number;
  totalSecondsRead: number;
  maxWpm: number;
  sessionsCount: number;
}

export type ReaderFont = "theme" | "golos" | "atkinson";

export interface SpeedReaderSettings {
  defaultWpm: number;
  fontSize: number;
  /** Шрифт окна чтения: тема Obsidian, Golos Text (кириллица) или Atkinson Hyperlegible (латиница). */
  readerFont: ReaderFont;
  highlightOrp: boolean;
  /** Сколько букв подсвечивать в зоне фокуса (1–3). */
  orpWidth: number;
  orpColor: string;
  showFixationGuide: boolean;
  pauseOnPunctuation: boolean;
  sentencePauseMultiplier: number;
  commaPauseMultiplier: number;
  stepWordCount: number;
  themeMode: "default" | "dark" | "light" | "sepia";

  // Top Feature 1: Smart Pacing
  enableRampUp: boolean;
  rampUpWords: number;
  rewindOnPause: boolean;
  /** Показывать итоги и мотивацию при постановке на паузу. */
  showPauseStats: boolean;
  rewindOnPauseWords: number;
  pauseOnParagraphs: boolean;
  paragraphPauseMultiplier: number;
  pauseOnNumbersAndAcronyms: boolean;

  // Top Feature 2: Display & Chunking
  chunkSize: number; // 1, 2, or 3 words
  bionicInChunks: boolean;

  // Top Feature 3: Progress & Sync
  rememberProgress: boolean;
  syncCursorOnClose: boolean;
  noteProgress: Record<string, NoteProgressRecord>;

  // Spritz Redicle & Timing
  redicleAlignment: "spritz" | "center";
  spritzVariableTiming: boolean;

  // Feature 4: Audio / TTS
  enableTts: boolean;

  // Top Feature 5: Analytics & Stats
  stats: ReaderStats;
}

export const DEFAULT_SETTINGS: SpeedReaderSettings = {
  defaultWpm: 350,
  fontSize: 44,
  readerFont: "theme",
  highlightOrp: true,
  orpWidth: 1,
  orpColor: "#e63946",
  showFixationGuide: true,
  pauseOnPunctuation: true,
  sentencePauseMultiplier: 2.0,
  commaPauseMultiplier: 1.4,
  stepWordCount: 10,
  themeMode: "default",

  // Top Feature 1
  enableRampUp: true,
  rampUpWords: 15,
  rewindOnPause: true,
  showPauseStats: true,
  rewindOnPauseWords: 3,
  pauseOnParagraphs: true,
  paragraphPauseMultiplier: 2.5,
  pauseOnNumbersAndAcronyms: true,

  // Top Feature 2
  chunkSize: 1,
  bionicInChunks: true,

  // Top Feature 3
  rememberProgress: true,
  syncCursorOnClose: true,
  noteProgress: {},

  // Spritz Redicle & Timing
  redicleAlignment: "spritz",
  spritzVariableTiming: true,

  // Feature 4: Audio / TTS
  enableTts: false,

  // Top Feature 5
  stats: {
    totalWordsRead: 0,
    totalSecondsRead: 0,
    maxWpm: 0,
    sessionsCount: 0,
  },
};

export class SpeedReaderSettingTab extends PluginSettingTab {
  plugin: SpeedReaderPlugin;

  constructor(app: App, plugin: SpeedReaderPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Speed Reader (RSVP) Settings" });

    // Section: Reader Statistics (Feature 5)
    containerEl.createEl("h3", { text: "📊 Статистика читателя (Reader Analytics)" });
    const statsContainer = containerEl.createDiv({ cls: "sr-stats-dashboard" });
    const stats = this.plugin.settings.stats;
    const timeSavedMin = calculateTimeSavedMinutes(stats.totalWordsRead, stats.totalSecondsRead);
    const totalMinutesSpent = Math.round((stats.totalSecondsRead / 60) * 10) / 10;

    statsContainer.createEl("div", {
      text: `📚 Всего прочитано слов: ${stats.totalWordsRead.toLocaleString()}`,
      cls: "sr-stat-item",
    });
    statsContainer.createEl("div", {
      text: `⏱️ Время скорочтения: ${totalMinutesSpent} мин (${stats.sessionsCount} сессий)`,
      cls: "sr-stat-item",
    });
    statsContainer.createEl("div", {
      text: `⚡ Максимальная скорость: ${stats.maxWpm || this.plugin.settings.defaultWpm} WPM`,
      cls: "sr-stat-item",
    });
    statsContainer.createEl("div", {
      text: `🚀 Сэкономлено времени: ~${timeSavedMin} мин (отн. 200 WPM)`,
      cls: "sr-stat-item sr-stat-highlight",
    });

    new Setting(containerEl)
      .setName("Сбросить статистику")
      .setDesc("Обнулить накопленную статистику прочитанных слов и времени")
      .addButton((btn) =>
        btn.setButtonText("Сбросить").setWarning().onClick(async () => {
          this.plugin.settings.stats = {
            totalWordsRead: 0,
            totalSecondsRead: 0,
            maxWpm: 0,
            sessionsCount: 0,
          };
          await this.plugin.saveSettings();
          this.display();
        })
      );

    // Section: Core Speed & Display
    containerEl.createEl("h3", { text: "⚡ Скорость и шрифт" });

    new Setting(containerEl)
      .setName("Скорость по умолчанию (WPM)")
      .setDesc("Слов в минуту при открытии (меняется на лету стрелками ↑↓)")
      .addSlider((slider) =>
        slider
          .setLimits(100, 1000, 25)
          .setValue(this.plugin.settings.defaultWpm)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.defaultWpm = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Размер шрифта")
      .setDesc("Размер текста в пикселях")
      .addSlider((slider) =>
        slider
          .setLimits(24, 72, 2)
          .setValue(this.plugin.settings.fontSize)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.fontSize = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Шрифт ридера")
      .setDesc(
        "Golos Text — крупный x-height, открытые апертуры, полная кириллица (хорошо для чтения в один столбец). " +
        "Atkinson Hyperlegible различим по форме букв, но в нём нет кириллицы: для русских слов браузер подставит другой шрифт."
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("theme", "Как в теме Obsidian")
          .addOption("golos", "Golos Text (кириллица + латиница)")
          .addOption("atkinson", "Atkinson Hyperlegible (латиница)")
          .setValue(this.plugin.settings.readerFont)
          .onChange(async (value) => {
            this.plugin.settings.readerFont = value === "golos" || value === "atkinson" ? value : "theme";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Цветная подсветка буквы-фокуса (ORP)")
      .setDesc("Выделение ключевой буквы для меньшей утомляемости глаз")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.highlightOrp)
          .onChange(async (value) => {
            this.plugin.settings.highlightOrp = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Сколько букв подсвечивать (зона фокуса)")
      .setDesc("1 — классический Spritz: одна красная буква. 2–3 — шире зона распознавания, легче удерживать слово на высокой скорости")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("1", "1 буква")
          .addOption("2", "2 буквы")
          .addOption("3", "3 буквы")
          .setValue(String(this.plugin.settings.orpWidth ?? 1))
          .onChange(async (value) => {
            this.plugin.settings.orpWidth = Math.max(1, Math.min(3, parseInt(value, 10) || 1));
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Цвет буквы-фокуса")
      .setDesc("Hex-код цвета или CSS (например, #e63946)")
      .addText((text) =>
        text
          .setPlaceholder("#e63946")
          .setValue(this.plugin.settings.orpColor)
          .onChange(async (value) => {
            this.plugin.settings.orpColor = value.trim() || "#e63946";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Направляющие метки фиксации")
      .setDesc("Вертикальные засечки сверху и снизу, центрирующие взгляд")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showFixationGuide)
          .onChange(async (value) => {
            this.plugin.settings.showFixationGuide = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Выравнивание рамки Spritz (The Redicle)")
      .setDesc("Spritz Redicle (визир на 35% слева) дает идеальный оптический баланс для длинных суффиксов. Центр (50/50) — строго по середине.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("spritz", "Spritz Redicle (35% слева / 65% справа)")
          .addOption("center", "Строго по центру (50/50)")
          .setValue(this.plugin.settings.redicleAlignment)
          .onChange(async (value) => {
            this.plugin.settings.redicleAlignment = value === "center" ? "center" : "spritz";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Нелинейный темп Spritz (Длина слов)")
      .setDesc("Короткие слова (1–2 буквы) показываются на 20% быстрее, длинные слова (13+ букв) — замедляются")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.spritzVariableTiming)
          .onChange(async (value) => {
            this.plugin.settings.spritzVariableTiming = value;
            await this.plugin.saveSettings();
          })
      );

    // Section: Top Feature 1 - Smart Pacing
    containerEl.createEl("h3", { text: "🧠 Умный темп (Smart Pacing & Rhythm)" });

    new Setting(containerEl)
      .setName("Плавный разгон (Speed Ramp-up)")
      .setDesc("Начинать чтение с 65% скорости и плавно разгоняться за первые слова, чтобы мозг адаптировался")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableRampUp)
          .onChange(async (value) => {
            this.plugin.settings.enableRampUp = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Длина разгона (слов)")
      .setDesc("За сколько первых слов достигать целевой скорости WPM")
      .addSlider((slider) =>
        slider
          .setLimits(5, 40, 5)
          .setValue(this.plugin.settings.rampUpWords)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.rampUpWords = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Итоги и мотивация на паузе")
      .setDesc("При постановке на паузу показывать, сколько прочитано, реальную скорость, экономию времени и короткую мотивацию")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showPauseStats !== false)
          .onChange(async (value) => {
            this.plugin.settings.showPauseStats = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Авто-откат при паузе (Rewind on Pause)")
      .setDesc("При нажатии паузы откатываться на несколько слов назад, чтобы не терять контекст при возобновлении")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.rewindOnPause)
          .onChange(async (value) => {
            this.plugin.settings.rewindOnPause = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Слов для авто-отката")
      .setDesc("Количество слов, на которое ридер отступает назад при паузе")
      .addSlider((slider) =>
        slider
          .setLimits(1, 10, 1)
          .setValue(this.plugin.settings.rewindOnPauseWords)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.rewindOnPauseWords = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Пауза на границах абзацев")
      .setDesc("Делать дополнительную паузу в конце смысловых абзацев для осмысления мысли")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.pauseOnParagraphs)
          .onChange(async (value) => {
            this.plugin.settings.pauseOnParagraphs = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Умные паузы на числах и аббревиатурах")
      .setDesc("Слегка замедляться на цифрах (например 2026, $500) и аббревиатурах (API, НАТО, HTML)")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.pauseOnNumbersAndAcronyms)
          .onChange(async (value) => {
            this.plugin.settings.pauseOnNumbersAndAcronyms = value;
            await this.plugin.saveSettings();
          })
      );

    // Section: Top Feature 2 - Display Modes & Chunking
    containerEl.createEl("h3", { text: "📖 Режимы отображения и Чанкинг (Display Modes)" });

    new Setting(containerEl)
      .setName("Размер чанка (слов за раз)")
      .setDesc("Показывать по 1 слову (классический RSVP с ORP) или по 2–3 слова для опытных чтецов")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("1", "1 слово (с точкой фиксации ORP)")
          .addOption("2", "2 слова (парный чанкинг)")
          .addOption("3", "3 слова (тройной чанкинг)")
          .setValue(String(this.plugin.settings.chunkSize))
          .onChange(async (value) => {
            this.plugin.settings.chunkSize = parseInt(value, 10);
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Bionic-выделение в чанках")
      .setDesc("Выделять жирным первые буквы каждого слова при показе по 2–3 слова разом")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.bionicInChunks)
          .onChange(async (value) => {
            this.plugin.settings.bionicInChunks = value;
            await this.plugin.saveSettings();
          })
      );

    // Section: Top Feature 3 - Progress & Memory
    containerEl.createEl("h3", { text: "💾 Память прогресса и Навигация (Progress & Sync)" });

    new Setting(containerEl)
      .setName("Запоминать место остановки в заметке")
      .setDesc("При повторном открытии заметки предлагать продолжить чтение с сохраненного слова")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.rememberProgress)
          .onChange(async (value) => {
            this.plugin.settings.rememberProgress = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Синхронизация курсора в редакторе")
      .setDesc("При закрытии ридера перемещать курсор заметки на прочитанное слово")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncCursorOnClose)
          .onChange(async (value) => {
            this.plugin.settings.syncCursorOnClose = value;
            await this.plugin.saveSettings();
          })
      );

    // Section: Feature 4 - Audio / Text-to-Speech
    containerEl.createEl("h3", { text: "🔊 Аудио-сопровождение (Text-to-Speech / TTS)" });

    new Setting(containerEl)
      .setName("Включить озвучку (TTS)")
      .setDesc("Воспроизводить читаемый текст голосом в реальном времени через системный синтезатор речи")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableTts)
          .onChange(async (value) => {
            this.plugin.settings.enableTts = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
