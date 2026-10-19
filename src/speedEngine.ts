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
  return Math.round(((currentIndex + 1) / totalWords) * 100);
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
  const factor = 0.65 + 0.35 * (wordsReadInSession / rampUpWords);
  return Math.round(targetWpm * factor);
}

/**
 * Finds index of the beginning of the previous sentence.
 */
export function findPreviousSentenceStart(
  words: { raw: string }[],
  currentIndex: number
): number {
  if (currentIndex <= 0 || words.length === 0) return 0;

  // If already at the first word of a sentence, skip back into the previous sentence
  let searchStart = currentIndex - 1;
  if (searchStart >= 0 && /[.!?…]+["')\]}]*$/.test(words[searchStart].raw)) {
    searchStart--;
  }

  for (let i = searchStart; i >= 0; i--) {
    if (/[.!?…]+["')\]}]*$/.test(words[i].raw)) {
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
  if (currentIndex >= words.length - 1 || words.length === 0) return words.length - 1;

  for (let i = currentIndex; i < words.length - 1; i++) {
    if (/[.!?…]+["')\]}]*$/.test(words[i].raw)) {
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
  const actualMinutes = totalSecondsSpent / 60;
  return Math.max(0, Math.round((standardMinutes - actualMinutes) * 10) / 10);
}
