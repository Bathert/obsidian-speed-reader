/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import { PluginSettingTab } from "obsidian";
import type { App, SettingDefinitionItem } from "obsidian";
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

  getControlValue(key: string): unknown {
    const value = super.getControlValue(key);
    return key === "orpWidth" || key === "chunkSize" ? String(value) : value;
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    let control;
    for (const group of this.getSettingDefinitions()) {
      const items = "items" in group ? group.items ?? [] : [group];
      const item = items.find((item) => "control" in item && item.control?.key === key);
      if (item && "control" in item) control = item.control;
    }
    if (control?.type === "slider") {
      const slider = control;
      value = typeof value === "number" && Number.isFinite(value)
        ? Math.max(slider.min, Math.min(slider.max, value))
        : slider.defaultValue;
    } else if (key === "orpWidth" || key === "chunkSize") {
      value = Math.max(1, Math.min(3, parseInt(String(value), 10) || 1));
    } else if (key === "orpColor") {
      value = String(value).trim() || DEFAULT_SETTINGS.orpColor;
    } else if (key === "readerFont") {
      value = value === "golos" || value === "atkinson" ? value : "theme";
    } else if (key === "redicleAlignment") {
      value = value === "center" ? "center" : "spritz";
    }
    await super.setControlValue(key, value);
  }

  getSettingDefinitions(): SettingDefinitionItem<keyof SpeedReaderSettings>[] {
    return [
      {
        type: "group",
        heading: "Статистика читателя (Reader Analytics)",
        items: [
          {
            name: "Статистика чтения",
            desc: "Прочитанные слова, время чтения, сессии, максимальная скорость и экономия времени",
            aliases: ["stats", "analytics", "statistics", "WPM"],
            render: (setting) => {
              const stats = this.plugin.settings.stats;
              const timeSavedMin = calculateTimeSavedMinutes(stats.totalWordsRead, stats.totalSecondsRead);
              const totalMinutesSpent = Math.round((stats.totalSecondsRead / 60) * 10) / 10;
              setting.descEl.empty();
              const dashboard = setting.descEl.createDiv({ cls: "sr-stats-dashboard" });
              dashboard.createDiv({
                text: `📚 Всего прочитано слов: ${stats.totalWordsRead.toLocaleString()}`,
                cls: "sr-stat-item",
              });
              dashboard.createDiv({
                text: `⏱️ Время скорочтения: ${totalMinutesSpent} мин (${stats.sessionsCount} сессий)`,
                cls: "sr-stat-item",
              });
              dashboard.createDiv({
                text: `⚡ Максимальная скорость: ${stats.maxWpm || this.plugin.settings.defaultWpm} WPM`,
                cls: "sr-stat-item",
              });
              dashboard.createDiv({
                text: `🚀 Сэкономлено времени: ~${timeSavedMin} мин (отн. 200 WPM)`,
                cls: "sr-stat-item sr-stat-highlight",
              });
            },
          },
          {
            name: "Сбросить статистику",
            desc: "Обнулить накопленную статистику прочитанных слов и времени",
            aliases: ["reset statistics", "analytics"],
            render: (setting) => {
              setting.addButton((button) =>
                button.setButtonText("Сбросить").setDestructive().onClick(async () => {
                  this.plugin.settings.stats = { ...DEFAULT_SETTINGS.stats };
                  await this.plugin.saveSettings();
                  this.update();
                })
              );
            },
          },
        ],
      },
      {
        type: "group",
        heading: "Скорость и шрифт",
        items: [
          {
            name: "Скорость по умолчанию (WPM)",
            desc: "Слов в минуту при открытии (меняется на лету стрелками ↑↓)",
            aliases: ["defaultWpm"],
            control: { type: "slider", key: "defaultWpm", min: 100, max: 1000, step: 25, defaultValue: DEFAULT_SETTINGS.defaultWpm },
          },
          {
            name: "Размер шрифта",
            desc: "Размер текста в пикселях",
            aliases: ["fontSize"],
            control: { type: "slider", key: "fontSize", min: 24, max: 72, step: 2, defaultValue: DEFAULT_SETTINGS.fontSize },
          },
          {
            name: "Шрифт ридера",
            desc: "Golos Text — крупный x-height, открытые апертуры, полная кириллица (хорошо для чтения в один столбец). " +
              "Atkinson Hyperlegible различим по форме букв, но в нём нет кириллицы: для русских слов браузер подставит другой шрифт.",
            aliases: ["readerFont"],
            control: { type: "dropdown", key: "readerFont", defaultValue: String(DEFAULT_SETTINGS.readerFont),
              options: {
                "theme": "Как в теме Obsidian",
                "golos": "Golos Text (кириллица + латиница)",
                "atkinson": "Atkinson Hyperlegible (латиница)",
              } },
          },
          {
            name: "Цветная подсветка буквы-фокуса (ORP)",
            desc: "Выделение ключевой буквы для меньшей утомляемости глаз",
            aliases: ["highlightOrp"],
            control: { type: "toggle", key: "highlightOrp", defaultValue: DEFAULT_SETTINGS.highlightOrp },
          },
          {
            name: "Сколько букв подсвечивать (зона фокуса)",
            desc: "1 — классический Spritz: одна красная буква. 2–3 — шире зона распознавания, легче удерживать слово на высокой скорости",
            aliases: ["orpWidth"],
            control: { type: "dropdown", key: "orpWidth", defaultValue: String(DEFAULT_SETTINGS.orpWidth),
              options: {
                "1": "1 буква",
                "2": "2 буквы",
                "3": "3 буквы",
              } },
          },
          {
            name: "Цвет буквы-фокуса",
            desc: "Hex-код цвета или CSS (например, #e63946)",
            aliases: ["orpColor"],
            control: { type: "text", key: "orpColor", defaultValue: DEFAULT_SETTINGS.orpColor, placeholder: "#e63946" },
          },
          {
            name: "Направляющие метки фиксации",
            desc: "Вертикальные засечки сверху и снизу, центрирующие взгляд",
            aliases: ["showFixationGuide"],
            control: { type: "toggle", key: "showFixationGuide", defaultValue: DEFAULT_SETTINGS.showFixationGuide },
          },
          {
            name: "Выравнивание рамки Spritz (The Redicle)",
            desc: "Spritz Redicle (визир на 35% слева) дает идеальный оптический баланс для длинных суффиксов. Центр (50/50) — строго по середине.",
            aliases: ["redicleAlignment"],
            control: { type: "dropdown", key: "redicleAlignment", defaultValue: String(DEFAULT_SETTINGS.redicleAlignment),
              options: {
                "spritz": "Spritz Redicle (35% слева / 65% справа)",
                "center": "Строго по центру (50/50)",
              } },
          },
          {
            name: "Нелинейный темп Spritz (Длина слов)",
            desc: "Короткие слова (1–2 буквы) показываются на 20% быстрее, длинные слова (13+ букв) — замедляются",
            aliases: ["spritzVariableTiming"],
            control: { type: "toggle", key: "spritzVariableTiming", defaultValue: DEFAULT_SETTINGS.spritzVariableTiming },
          },
        ],
      },
      {
        type: "group",
        heading: "Умный темп (Smart Pacing & Rhythm)",
        items: [
          {
            name: "Плавный разгон (Speed Ramp-up)",
            desc: "Начинать чтение с 65% скорости и плавно разгоняться за первые слова, чтобы мозг адаптировался",
            aliases: ["enableRampUp"],
            control: { type: "toggle", key: "enableRampUp", defaultValue: DEFAULT_SETTINGS.enableRampUp },
          },
          {
            name: "Длина разгона (слов)",
            desc: "За сколько первых слов достигать целевой скорости WPM",
            aliases: ["rampUpWords"],
            control: { type: "slider", key: "rampUpWords", min: 5, max: 40, step: 5, defaultValue: DEFAULT_SETTINGS.rampUpWords },
          },
          {
            name: "Итоги и мотивация на паузе",
            desc: "При постановке на паузу показывать, сколько прочитано, реальную скорость, экономию времени и короткую мотивацию",
            aliases: ["showPauseStats"],
            control: { type: "toggle", key: "showPauseStats", defaultValue: DEFAULT_SETTINGS.showPauseStats },
          },
          {
            name: "Авто-откат при паузе (Rewind on Pause)",
            desc: "При нажатии паузы откатываться на несколько слов назад, чтобы не терять контекст при возобновлении",
            aliases: ["rewindOnPause"],
            control: { type: "toggle", key: "rewindOnPause", defaultValue: DEFAULT_SETTINGS.rewindOnPause },
          },
          {
            name: "Слов для авто-отката",
            desc: "Количество слов, на которое ридер отступает назад при паузе",
            aliases: ["rewindOnPauseWords"],
            control: { type: "slider", key: "rewindOnPauseWords", min: 1, max: 10, step: 1, defaultValue: DEFAULT_SETTINGS.rewindOnPauseWords },
          },
          {
            name: "Пауза на границах абзацев",
            desc: "Делать дополнительную паузу в конце смысловых абзацев для осмысления мысли",
            aliases: ["pauseOnParagraphs"],
            control: { type: "toggle", key: "pauseOnParagraphs", defaultValue: DEFAULT_SETTINGS.pauseOnParagraphs },
          },
          {
            name: "Умные паузы на числах и аббревиатурах",
            desc: "Слегка замедляться на цифрах (например 2026, $500) и аббревиатурах (API, НАТО, HTML)",
            aliases: ["pauseOnNumbersAndAcronyms"],
            control: { type: "toggle", key: "pauseOnNumbersAndAcronyms", defaultValue: DEFAULT_SETTINGS.pauseOnNumbersAndAcronyms },
          },
        ],
      },
      {
        type: "group",
        heading: "Режимы отображения и Чанкинг (Display Modes)",
        items: [
          {
            name: "Размер чанка (слов за раз)",
            desc: "Показывать по 1 слову (классический RSVP с ORP) или по 2–3 слова для опытных чтецов",
            aliases: ["chunkSize"],
            control: { type: "dropdown", key: "chunkSize", defaultValue: String(DEFAULT_SETTINGS.chunkSize),
              options: {
                "1": "1 слово (с точкой фиксации ORP)",
                "2": "2 слова (парный чанкинг)",
                "3": "3 слова (тройной чанкинг)",
              } },
          },
          {
            name: "Bionic-выделение в чанках",
            desc: "Выделять жирным первые буквы каждого слова при показе по 2–3 слова разом",
            aliases: ["bionicInChunks"],
            control: { type: "toggle", key: "bionicInChunks", defaultValue: DEFAULT_SETTINGS.bionicInChunks },
          },
        ],
      },
      {
        type: "group",
        heading: "Память прогресса и Навигация (Progress & Sync)",
        items: [
          {
            name: "Запоминать место остановки в заметке",
            desc: "При повторном открытии заметки предлагать продолжить чтение с сохраненного слова",
            aliases: ["rememberProgress"],
            control: { type: "toggle", key: "rememberProgress", defaultValue: DEFAULT_SETTINGS.rememberProgress },
          },
          {
            name: "Синхронизация курсора в редакторе",
            desc: "При закрытии ридера перемещать курсор заметки на прочитанное слово",
            aliases: ["syncCursorOnClose"],
            control: { type: "toggle", key: "syncCursorOnClose", defaultValue: DEFAULT_SETTINGS.syncCursorOnClose },
          },
        ],
      },
      {
        type: "group",
        heading: "Аудио-сопровождение (Text-to-Speech / TTS)",
        items: [
          {
            name: "Включить озвучку (TTS)",
            desc: "Воспроизводить читаемый текст голосом в реальном времени через системный синтезатор речи",
            aliases: ["enableTts"],
            control: { type: "toggle", key: "enableTts", defaultValue: DEFAULT_SETTINGS.enableTts },
          },
        ],
      },
    ];
  }
}
