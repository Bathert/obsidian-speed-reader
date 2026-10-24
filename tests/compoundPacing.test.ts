import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWords } from "../src/textParser.ts";

const options = { pauseOnPunctuation: true, sentencePauseMultiplier: 2, commaPauseMultiplier: 1.4 };

test("long hyphenated names get at least double reading time, including Unicode hyphens", () => {
  for (const name of ["Оффаль-Корт", "Пуддинг-Лэном", "Оффаль‐Корт", "Пуддинг‑Лэном", "Stratford-upon-Avon"]) {
    const [word] = parseWords(name, options);
    assert.ok(word.delayMultiplier >= 2, `${name}: expected >= 2, got ${word.delayMultiplier}`);
    assert.equal(word.raw, name);
  }
});

test("compound slowdown preserves comma pauses and does not penalize short hyphens or dashes", () => {
  const [plain] = parseWords("Оффаль-Корт", options);
  const [comma] = parseWords("Оффаль-Корт,", options);
  assert.equal(comma.delayMultiplier, Math.round(plain.delayMultiplier * 1.4 * 100) / 100);
  for (const token of ["кто-то", "из-за", "слово", "слово—слово"]) {
    const [word] = parseWords(token, options);
    assert.ok(word.delayMultiplier < 2, token);
  }
  const [disabled] = parseWords("Оффаль-Корт", { ...options, spritzVariableTiming: false });
  assert.equal(disabled.delayMultiplier, 1);
});
