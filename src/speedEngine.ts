/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
/**
 * Pure calculation functions for the speed reader engine.
 */

export function calculateWordDelayMs(wpm: number, multiplier: number = 1.0): number {
  const safeWpm = Math.max(60, Math.min(1500, wpm));
  const baseMs = (60 / safeWpm) * 1000;
  return Math.round(baseMs * multiplier);
}

export function clampIndex(index: number, totalWords: number): number {
  if (totalWords <= 0) return 0;
  return Math.max(0, Math.min(totalWords - 1, index));
}

export function stepIndex(currentIndex: number, delta: number, totalWords: number): number {
  return clampIndex(currentIndex + delta, totalWords);
}

export function calculateProgressPercent(currentIndex: number, totalWords: number): number {
  if (totalWords <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round(((currentIndex + 1) / totalWords) * 100)));
}

export function formatTimeRemaining(remainingWords: number, wpm: number): string {
  if (remainingWords <= 0) return "0s left";
  const safeWpm = Math.max(60, wpm);
  const totalSeconds = Math.round((remainingWords / safeWpm) * 60);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;

  if (mins > 0) {
    return `~${mins}m ${secs}s left`;
  }
  return `~${secs}s left`;
}

/**
 * Calculates current WPM during ramp-up phase.
 * Starts at 65% of target WPM and scales linearly to 100% over rampUpWords.
 */
export function calculateRampUpWpm(
  targetWpm: number,
  wordsReadInSession: number,
  rampUpWords: number = 15
): number {
  if (rampUpWords <= 0 || wordsReadInSession >= rampUpWords) {
    return targetWpm;
  }
  const factor = 0.65 + 0.35 * (Math.max(0, wordsReadInSession) / rampUpWords);
  return Math.round(targetWpm * factor);
}

/**
 * Finds index of the beginning of the previous sentence.
 */
export function findPreviousSentenceStart(
  words: { raw: string }[],
  currentIndex: number
): number {
  currentIndex = clampIndex(currentIndex, words.length);
  if (currentIndex <= 0 || words.length === 0) return 0;

  // If already at the first word of a sentence, skip back into the previous sentence
  let searchStart = currentIndex - 1;
  if (searchStart >= 0 && /[.!?…]+["'»”’）)\]}]*$/.test(words[searchStart].raw)) {
    searchStart--;
  }

  for (let i = searchStart; i >= 0; i--) {
    if (/[.!?…]+["'»”’）)\]}]*$/.test(words[i].raw)) {
      return i + 1;
    }
  }
  return 0;
}

/**
 * Finds index of the beginning of the next sentence.
 */
export function findNextSentenceStart(
  words: { raw: string }[],
  currentIndex: number
): number {
  currentIndex = clampIndex(currentIndex, words.length);
  if (words.length === 0) return 0;
  if (currentIndex >= words.length - 1) return words.length - 1;

  for (let i = currentIndex; i < words.length - 1; i++) {
    if (/[.!?…]+["'»”’）)\]}]*$/.test(words[i].raw)) {
      return i + 1;
    }
  }
  return words.length - 1;
}

/**
 * Calculates time saved compared to average reading speed (200 WPM).
 */
export function calculateTimeSavedMinutes(totalWords: number, totalSecondsSpent: number): number {
  if (totalWords <= 0) return 0;
  const standardMinutes = totalWords / 200;
  const actualMinutes = Math.max(0, totalSecondsSpent) / 60;
  return Math.max(0, Math.round((standardMinutes - actualMinutes) * 10) / 10);
}

export interface SessionSummary {
  /** Сколько слов прочитано за текущую сессию. */
  wordsRead: number;
  /** Время в активном чтении, секунды (паузы не считаются). */
  readSeconds: number;
  /** Средняя скорость по факту, WPM. */
  avgWpm: number;
  /** Сколько минут заняло бы то же количество слов при обычных 200 WPM. */
  baselineMinutes: number;
  /** Сэкономленное время против 200 WPM, секунды. */
  savedSeconds: number;
  /** Во сколько раз быстрее обычного чтения. */
  speedup: number;
  /** Сколько минут осталось при текущей целевой скорости. */
  remainingMinutes: number;
}

export function calculateSessionSummary(
  wordsRead: number,
  activeSeconds: number,
  currentWpm: number,
  remainingWords: number
): SessionSummary {
  const safeWords = Math.max(0, wordsRead);
  const minutes = Math.max(0, activeSeconds) / 60;
  const avgWpm = minutes > 0 ? Math.round(safeWords / minutes) : 0;
  const baselineMinutes = safeWords / 200;
  const savedMinutes = Math.max(0, baselineMinutes - minutes);
  const speedup = minutes > 0 ? Math.round((avgWpm / 200) * 10) / 10 : 0;
  const remainingMinutes = Math.max(0, remainingWords) / Math.max(60, currentWpm);

  return {
    wordsRead: safeWords,
    readSeconds: Math.round(Math.max(0, activeSeconds)),
    avgWpm,
    baselineMinutes: Math.round(baselineMinutes * 10) / 10,
    savedSeconds: Math.round(savedMinutes * 60),
    speedup,
    remainingMinutes: Math.round(remainingMinutes * 10) / 10,
  };
}

/**
 * Короткая мотивирующая строка под итогами паузы.
 * Сравнивает фактическую скорость с обычным чтением (200 WPM).
 */
export function buildMotivationLine(avgWpm: number, targetWpm: number): string {
  if (avgWpm <= 0) return "Поехали: пробел — и понеслась.";
  if (avgWpm < 200) return "Пока медленнее обычного чтения. Попробуй +50 WPM, мозг быстро привыкает.";
  if (avgWpm < 300) return "Уже быстрее обычного чтения. Держи ритм.";
  if (avgWpm < 450) return "Хороший темп: обычный читатель столько не вытянет.";
  if (avgWpm < 600) return "Сильный ход. Только не в ущерб пониманию: если плывёт смысл, шагни на -50.";
  if (avgWpm > targetWpm + 50) return "Летишь выше цели. Если картинка в голове рассыпается — притормози на 50.";
  return "На такой скорости обычно перечитывают. Проверь, что смысл держится.";
}

/**
 * Человеческая длительность: до минуты — секунды, дальше минуты с одним знаком.
 */
export function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  if (safe < 60) return `${safe} с`;
  const minutes = safe / 60;
  const text = minutes >= 10 ? String(Math.round(minutes)) : minutes.toFixed(1).replace(".", ",");
  return `${text} мин`;
}
