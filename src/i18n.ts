/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

export type UiLanguage = "auto" | "ru" | "en";
export type ResolvedLanguage = "ru" | "en";

/**
 * Resolves the active UI language.
 * In Node test environments without localStorage, defaults to "ru" to preserve
 * existing test assertions; in Obsidian, inspects localStorage("language").
 */
export function resolveLanguage(setting: UiLanguage = "auto"): ResolvedLanguage {
  if (setting === "ru" || setting === "en") return setting;
  // Obsidian mirrors its UI language into <html lang>; navigator.language covers
  // plain DOM environments. Node tests without a document fall back to Russian.
  const candidates: string[] = [];
  if (typeof document !== "undefined" && document.documentElement?.lang) {
    candidates.push(document.documentElement.lang);
  }
  if (typeof navigator !== "undefined" && navigator.language) {
    candidates.push(navigator.language);
  }
  for (const candidate of candidates) {
    const value = candidate.toLowerCase();
    if (value.startsWith("ru")) return "ru";
    if (value) return "en";
  }
  return "ru";
}

/** Detects whether a text snippet is primarily Cyrillic or Latin for TTS. */
export function detectSpeechLang(text: string): string {
  return /[а-яёіїєґ]/i.test(text) ? "ru-RU" : "en-US";
}

export const I18N = {
  ru: {
    emptySelectionOrNote: "No readable words found in selection or note.",
    close: "Close",
    resumeProgress: (word: number, total: number, pct: number) =>
      `📍 Предыдущий прогресс: слово ${word} из ${total} (${pct}%)`,
    resumeBtn: "Продолжить",
    startOverBtn: "Сначала",
    wordsCount: (count: number) => ` (${count} слов)`,
    shortcutsHint:
      "Пробел: Старт/Пауза | ↑↓: WPM | ←→: Слов | [ ]: Предложение | H: Выделить | F: Дзен | R: Сначала",
    restartTitle: "Сначала (r)",
    prevSentenceTitle: "Предыдущее предложение ([)",
    stepBackTitle: (count: number) => `Назад на ${count} слов (←)`,
    playPauseTitle: "Старт / Пауза (Пробел)",
    pauseTitle: "Пауза (Пробел)",
    playTitle: "Старт (Пробел)",
    stepForwardTitle: (count: number) => `Вперед на ${count} слов (→)`,
    nextSentenceTitle: "Следующее предложение (])",
    ttsTitle: "Озвучка / TTS (m)",
    highlightTitle: "Выделить предложение в заметке (h)",
    zenTitle: "Дзен-режим (f)",
    tocPlaceholder: "Перейти к разделу…",
    ttsEnabledNotice: "🔊 Озвучка (TTS) включена",
    ttsDisabledNotice: "🔇 Озвучка (TTS) выключена",
    ttsUsageSaveFailedNotice: "⚠️ Не удалось сохранить счётчик символов озвучки.",
    highlightedNotice: "✨ Предложение выделено в заметке",
    highlightCopiedNotice: "📋 Предложение скопировано в буфер обмена",
    pauseTitleText: "⏸ Пауза",
    pauseSubText: (words: string, duration: string) => ` · ${words} слов за ${duration}`,
    metricAvgWpm: "средняя скорость",
    metricSpeedup: "быстрее обычного",
    metricSaved: "сэкономлено",
    metricRemaining: "до конца",
    pauseProgress: (pct: number, current: number, total: number) =>
      `Прогресс ${pct}% · ${current} / ${total} слов`,
    statsNotice: (words: string, mins: number, sessions: number, maxWpm: number, savedMin: number) =>
      `📊 Скорочтение:\n` +
      `• Прочитано слов: ${words}\n` +
      `• Время: ${mins} мин (${sessions} сессий)\n` +
      `• Макс скорость: ${maxWpm} WPM\n` +
      `• Сэкономлено: ~${savedMin} мин`,
  },
  en: {
    emptySelectionOrNote: "No readable words found in selection or note.",
    close: "Close",
    resumeProgress: (word: number, total: number, pct: number) =>
      `📍 Saved progress: word ${word} of ${total} (${pct}%)`,
    resumeBtn: "Resume",
    startOverBtn: "Start over",
    wordsCount: (count: number) => ` (${count} words)`,
    shortcutsHint:
      "Space: Play/Pause | ↑↓: WPM | ←→: Step | [ ]: Sentence | H: Highlight | F: Zen | R: Restart",
    restartTitle: "Restart (r)",
    prevSentenceTitle: "Previous sentence ([)",
    stepBackTitle: (count: number) => `Back ${count} words (←)`,
    playPauseTitle: "Play / Pause (Space)",
    pauseTitle: "Pause (Space)",
    playTitle: "Play (Space)",
    stepForwardTitle: (count: number) => `Forward ${count} words (→)`,
    nextSentenceTitle: "Next sentence (])",
    ttsTitle: "Text-to-speech (m)",
    highlightTitle: "Highlight sentence in note (h)",
    zenTitle: "Zen mode (f)",
    tocPlaceholder: "Jump to heading…",
    ttsEnabledNotice: "🔊 Text-to-speech enabled",
    ttsDisabledNotice: "🔇 Text-to-speech disabled",
    ttsUsageSaveFailedNotice: "⚠️ Could not save the speech usage counter.",
    highlightedNotice: "✨ Sentence highlighted in note",
    highlightCopiedNotice: "📋 Sentence copied to clipboard",
    pauseTitleText: "⏸ Paused",
    pauseSubText: (words: string, duration: string) => ` · ${words} words in ${duration}`,
    metricAvgWpm: "average speed",
    metricSpeedup: "faster than 200 WPM",
    metricSaved: "time saved",
    metricRemaining: "remaining",
    pauseProgress: (pct: number, current: number, total: number) =>
      `Progress ${pct}% · ${current} / ${total} words`,
    statsNotice: (words: string, mins: number, sessions: number, maxWpm: number, savedMin: number) =>
      `📊 Speed reading:\n` +
      `• Words read: ${words}\n` +
      `• Time: ${mins} min (${sessions} sessions)\n` +
      `• Top speed: ${maxWpm} WPM\n` +
      `• Time saved: ~${savedMin} min`,
  },
} as const;
