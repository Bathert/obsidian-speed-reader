import test, { describe, it } from "node:test";
import assert from "node:assert";
import {
  calculateWordDelayMs,
  formatDuration,
  clampIndex,
  stepIndex,
  calculateProgressPercent,
  formatTimeRemaining,
  calculateRampUpWpm,
  findPreviousSentenceStart,
  findNextSentenceStart,
  calculateTimeSavedMinutes,
  calculateSessionSummary,
  buildMotivationLine,
} from "../src/speedEngine.ts";

describe("speedEngine - edge audit", () => {
  it("handles empty and singleton navigation, clamping and progress", () => {
    for (const total of [0, -1]) {
      assert.strictEqual(clampIndex(10, total), 0);
      assert.strictEqual(stepIndex(10, 100, total), 0);
      assert.strictEqual(calculateProgressPercent(10, total), 0);
    }
    for (const index of [-10, 0, 1, 10]) {
      assert.strictEqual(findPreviousSentenceStart([], index), 0);
      assert.strictEqual(findNextSentenceStart([], index), 0);
      assert.strictEqual(findPreviousSentenceStart([{ raw: "Only." }], index), 0);
      assert.strictEqual(findNextSentenceStart([{ raw: "Only." }], index), 0);
    }
    assert.strictEqual(calculateProgressPercent(0, 1), 100);
  });

  it("stays at the final word when no next sentence exists", () => {
    const words = [{ raw: "No" }, { raw: "boundary" }, { raw: "here" }];
    assert.strictEqual(findNextSentenceStart(words, 0), 2);
    assert.strictEqual(findNextSentenceStart(words, 2), 2);
    assert.strictEqual(findPreviousSentenceStart(words, 2), 0);
  });

  it("calculates rounded fractional delays at both speed boundaries", () => {
    assert.strictEqual(calculateWordDelayMs(60, 0.8), 800);
    assert.strictEqual(calculateWordDelayMs(1500, 1.35), 54);
    assert.strictEqual(calculateWordDelayMs(333), 180);
    assert.strictEqual(calculateWordDelayMs(300, 0), 0);
  });

  it("formats remaining time at empty, negative and minute-rounding boundaries", () => {
    assert.strictEqual(formatTimeRemaining(-1, 300), "0s left");
    assert.strictEqual(formatTimeRemaining(60, 0), "~1m 0s left");
    assert.strictEqual(formatTimeRemaining(59, 60), "~59s left");
    assert.strictEqual(formatTimeRemaining(59.5, 60), "~1m 0s left");
    assert.strictEqual(formatTimeRemaining(1, 1500), "~0s left");
  });

  it("handles disabled and default ramp lengths at each endpoint", () => {
    assert.strictEqual(calculateRampUpWpm(400, 0, 0), 400);
    assert.strictEqual(calculateRampUpWpm(400, 0, -1), 400);
    assert.strictEqual(calculateRampUpWpm(400, 0), 260);
    assert.strictEqual(calculateRampUpWpm(400, 15), 400);
  });

  it("clamps negative summary inputs without inventing elapsed time or remaining words", () => {
    assert.deepStrictEqual(calculateSessionSummary(-5, -10, 0, -1), {
      wordsRead: 0, readSeconds: 0, avgWpm: 0, baselineMinutes: 0, savedSeconds: 0, speedup: 0, remainingMinutes: 0,
    });
    assert.strictEqual(calculateSessionSummary(0, 0, 0, 120).remainingMinutes, 2);
  });

  it("rounds summary fields while using unrounded active time for actual WPM", () => {
    assert.deepStrictEqual(calculateSessionSummary(10, 1.5, 600, 101), {
      wordsRead: 10, readSeconds: 2, avgWpm: 400, baselineMinutes: 0.1, savedSeconds: 2, speedup: 2, remainingMinutes: 0.2,
    });
    assert.strictEqual(calculateTimeSavedMinutes(-1, 0), 0);
    assert.strictEqual(calculateTimeSavedMinutes(100, 60), 0);
  });

  it("selects every motivation threshold including the target-plus-fifty boundary", () => {
    const cases: [number, number, RegExp][] = [
      [-1, 650, /Поехали/], [199, 650, /медленнее/], [200, 650, /Уже быстрее/],
      [299, 650, /Уже быстрее/], [300, 650, /Хороший темп/], [449, 650, /Хороший темп/],
      [450, 650, /Сильный ход/], [599, 650, /Сильный ход/], [600, 650, /перечитывают/],
      [700, 650, /перечитывают/], [701, 650, /выше цели/],
    ];
    for (const [average, target, expected] of cases) assert.match(buildMotivationLine(average, target), expected);
  });

  it("formats durations at rounding, minute and ten-minute boundaries", () => {
    assert.strictEqual(formatDuration(-10), "0 с");
    assert.strictEqual(formatDuration(0.5), "1 с");
    assert.strictEqual(formatDuration(59.4), "59 с");
    assert.strictEqual(formatDuration(59.5), "1,0 мин");
    assert.strictEqual(formatDuration(599), "10,0 мин");
    assert.strictEqual(formatDuration(600), "10 мин");
    assert.strictEqual(formatDuration(630), "11 мин");
  });
});

describe("speedEngine - saved time boundary regressions", () => {
  it("does not count negative elapsed time as extra time saved", () => {
    assert.strictEqual(calculateTimeSavedMinutes(200, -60), 1);
  });
});

describe("speedEngine - ramp boundary regressions", () => {
  it("does not ramp below the initial speed for negative session counts", () => {
    assert.strictEqual(calculateRampUpWpm(400, -10, 10), 260);
  });
});

describe("speedEngine - progress boundary regressions", () => {
  it("keeps progress inside zero to one hundred for stale indices", () => {
    assert.strictEqual(calculateProgressPercent(-10, 5), 0);
    assert.strictEqual(calculateProgressPercent(10, 5), 100);
  });
});

describe("speedEngine - quoted sentence regressions", () => {
  it("navigates across sentences ending in guillemets and curly quotes", () => {
    const words = [{ raw: "«Первая.»" }, { raw: "“Вторая!”" }, { raw: "Третья." }];
    assert.strictEqual(findNextSentenceStart(words, 0), 1);
    assert.strictEqual(findPreviousSentenceStart(words, 2), 1);
  });
});

describe("speedEngine - navigation boundary regressions", () => {
  it("clamps stale and negative sentence positions before reading words", () => {
    const words = [{ raw: "One." }, { raw: "Two." }, { raw: "Three" }];
    assert.strictEqual(findPreviousSentenceStart(words, 99), 1);
    assert.strictEqual(findNextSentenceStart(words, -99), 1);
  });
});

describe("speedEngine - empty sentence navigation", () => {
  it("uses zero as the next index for empty input", () => {
    assert.strictEqual(findNextSentenceStart([], 0), 0);
  });
});

describe("speedEngine - calculateWordDelayMs", () => {
  it("calculates exact milliseconds per word based on WPM", () => {
    assert.strictEqual(calculateWordDelayMs(60), 1000);
    assert.strictEqual(calculateWordDelayMs(300), 200);
    assert.strictEqual(calculateWordDelayMs(600), 100);
    assert.strictEqual(calculateWordDelayMs(1200), 50);
  });

  it("applies punctuation multiplier accurately", () => {
    assert.strictEqual(calculateWordDelayMs(300, 2.0), 400);
    assert.strictEqual(calculateWordDelayMs(300, 1.4), 280);
  });

  it("clamps WPM within safe limits (60 - 1500)", () => {
    assert.strictEqual(calculateWordDelayMs(10), 1000);
    assert.strictEqual(calculateWordDelayMs(5000), 40);
  });
});

describe("speedEngine - Feature 1: Speed Ramp-up", () => {
  it("scales WPM smoothly from 65% to 100% over ramp-up period", () => {
    const targetWpm = 400;
    const rampWords = 10;

    // At start (word 0): 65% of 400 = 260 WPM
    assert.strictEqual(calculateRampUpWpm(targetWpm, 0, rampWords), 260);

    // Halfway (word 5): 65% + 0.35 * 0.5 = 82.5% -> 330 WPM
    assert.strictEqual(calculateRampUpWpm(targetWpm, 5, rampWords), 330);

    // Reached target (word 10): 100% -> 400 WPM
    assert.strictEqual(calculateRampUpWpm(targetWpm, 10, rampWords), 400);

    // Beyond ramp words: stays at 400 WPM
    assert.strictEqual(calculateRampUpWpm(targetWpm, 25, rampWords), 400);
  });
});

describe("speedEngine - Feature 3: Sentence Navigation", () => {
  const sampleWords = [
    { raw: "First" },
    { raw: "sentence." }, // idx 1
    { raw: "Second" },    // idx 2
    { raw: "short" },
    { raw: "sentence!" }, // idx 4
    { raw: "Third" },     // idx 5
    { raw: "one?" },      // idx 6
  ];

  it("finds previous sentence start correctly", () => {
    // In middle of second sentence (idx 3): jumps to start of current sentence (idx 2)
    assert.strictEqual(findPreviousSentenceStart(sampleWords, 3), 2);

    // At start of second sentence (idx 2): jumps to start of previous sentence (idx 0)
    assert.strictEqual(findPreviousSentenceStart(sampleWords, 2), 0);

    // At start of third sentence (idx 5): previous sentence start is idx 2
    assert.strictEqual(findPreviousSentenceStart(sampleWords, 5), 2);

    // At beginning: returns 0
    assert.strictEqual(findPreviousSentenceStart(sampleWords, 0), 0);
  });

  it("finds next sentence start correctly", () => {
    // In first sentence (idx 0): next sentence start is idx 2
    assert.strictEqual(findNextSentenceStart(sampleWords, 0), 2);

    // In second sentence (idx 2): next sentence start is idx 5
    assert.strictEqual(findNextSentenceStart(sampleWords, 2), 5);

    // At last sentence: returns last word index
    assert.strictEqual(findNextSentenceStart(sampleWords, 6), 6);
  });
});

describe("speedEngine - Feature 5: Time Saved Analytics", () => {
  it("calculates time saved relative to 200 WPM baseline", () => {
    // Reading 600 words at 600 WPM takes 1 minute (60s)
    // Standard 200 WPM would take 3 minutes
    // Saved: 3 - 1 = 2 minutes
    assert.strictEqual(calculateTimeSavedMinutes(600, 60), 2.0);

    // Reading 1000 words in 120s (2 mins): standard is 5 mins -> saved 3 mins
    assert.strictEqual(calculateTimeSavedMinutes(1000, 120), 3.0);

    // Zero words returns 0
    assert.strictEqual(calculateTimeSavedMinutes(0, 0), 0);
  });
});

describe("speedEngine - navigation & clamping", () => {
  it("clamps index within bounds", () => {
    assert.strictEqual(clampIndex(-5, 100), 0);
    assert.strictEqual(clampIndex(0, 100), 0);
    assert.strictEqual(clampIndex(50, 100), 50);
    assert.strictEqual(clampIndex(99, 100), 99);
    assert.strictEqual(clampIndex(100, 100), 99);
  });

  it("steps forward and backward with boundaries", () => {
    assert.strictEqual(stepIndex(0, 10, 100), 10);
    assert.strictEqual(stepIndex(5, -10, 100), 0);
    assert.strictEqual(stepIndex(90, 20, 100), 99);
    assert.strictEqual(stepIndex(50, -10, 100), 40);
  });
});

describe("speedEngine - progress and time remaining", () => {
  it("calculates progress percentage correctly", () => {
    assert.strictEqual(calculateProgressPercent(0, 100), 1);
    assert.strictEqual(calculateProgressPercent(49, 100), 50);
    assert.strictEqual(calculateProgressPercent(99, 100), 100);
  });

  it("formats time remaining nicely in minutes and seconds", () => {
    assert.strictEqual(formatTimeRemaining(300, 300), "~1m 0s left");
    assert.strictEqual(formatTimeRemaining(450, 300), "~1m 30s left");
    assert.strictEqual(formatTimeRemaining(50, 300), "~10s left");
    assert.strictEqual(formatTimeRemaining(0, 300), "0s left");
  });
});

describe("speedEngine - session summary", () => {
  it("считает среднюю скорость, экономию и остаток", () => {
    const s = calculateSessionSummary(1200, 180, 600, 12000);
    assert.strictEqual(s.wordsRead, 1200);
    assert.strictEqual(s.readSeconds, 180);
    assert.strictEqual(s.avgWpm, 400);
    assert.strictEqual(s.baselineMinutes, 6);
    assert.strictEqual(s.savedSeconds, 180);
    assert.strictEqual(s.speedup, 2);
    assert.strictEqual(s.remainingMinutes, 20);
  });

  it("не делит на ноль, если активного времени ещё нет", () => {
    const s = calculateSessionSummary(0, 0, 650, 5000);
    assert.strictEqual(s.avgWpm, 0);
    assert.strictEqual(s.savedSeconds, 0);
    assert.strictEqual(s.speedup, 0);
    assert.strictEqual(s.remainingMinutes, 7.7);
  });

  it("не показывает отрицательную экономию, если читал медленнее обычного", () => {
    const s = calculateSessionSummary(100, 60, 350, 1000);
    assert.strictEqual(s.avgWpm, 100);
    assert.strictEqual(s.savedSeconds, 0);
    assert.ok(s.speedup < 1);
  });
});

describe("speedEngine - motivation line", () => {
  it("подбадривает на низкой скорости и предупреждает на слишком высокой", () => {
    assert.match(buildMotivationLine(120, 650), /медленнее обычного/);
    assert.match(buildMotivationLine(350, 650), /Хороший темп/);
    assert.match(buildMotivationLine(900, 650), /Летишь выше цели/);
    assert.match(buildMotivationLine(0, 650), /Пробел|пробел/);
  });
});

describe("speedEngine - formatDuration", () => {
  it("показывает секунды до минуты и минуты дальше", () => {
    assert.strictEqual(formatDuration(0), "0 с");
    assert.strictEqual(formatDuration(45), "45 с");
    assert.strictEqual(formatDuration(59), "59 с");
    assert.strictEqual(formatDuration(60), "1,0 мин");
    assert.strictEqual(formatDuration(144), "2,4 мин");
    assert.strictEqual(formatDuration(3600), "60 мин");
  });
});

describe("speedEngine - темп и разгон на практике", () => {
  it("длинные слова показываются дольше коротких при одной скорости", () => {
    const base = calculateWordDelayMs(650, 1.0);
    const short = calculateWordDelayMs(650, 0.8);
    const long = calculateWordDelayMs(650, 1.35);

    assert.strictEqual(base, 92);
    assert.strictEqual(short, 74);
    assert.strictEqual(long, 125);
    assert.ok(long > base && base > short);
    assert.ok(long / short > 1.6);
  });

  it("после возобновления разгон начинается заново, а не с полной скорости", () => {
    // 0 слов с момента resume — это 65% от цели, и только к rampUpWords выходим на цель
    assert.strictEqual(calculateRampUpWpm(650, 0, 30), 423);
    assert.ok(calculateRampUpWpm(650, 0, 30) < 650);
    assert.strictEqual(calculateRampUpWpm(650, 30, 30), 650);
  });
});
