import test, { describe, it } from "node:test";
import assert from "node:assert";
import {
  cleanMarkdown,
  getOrpIndex,
  parseWords,
  splitWordForOrp,
} from "../src/textParser.ts";

describe("textParser - cleanMarkdown", () => {
  it("drops empty table rows without attaching phantom punctuation to nearby words", () => {
    const options = { pauseOnPunctuation: true, sentencePauseMultiplier: 2, commaPauseMultiplier: 1.4 };
    for (const row of ["||", "|||", "| | |", "|\t|", "|---|---|"]) {
      for (const newline of [String.fromCharCode(10), String.fromCharCode(13, 10)]) {
        const source = `перед таблицей${newline}${row}${newline}после`;
        const words = parseWords(source, options);
        assert.deepStrictEqual(words.map(word => word.raw), ["перед", "таблицей", "после"], row);
        assert.deepStrictEqual(words.map(word => word.charOffset), [0, source.indexOf("таблицей"), source.indexOf("после")]);
        assert.strictEqual(cleanMarkdown(row), "");
        assert.deepStrictEqual(parseWords(row, options), []);
      }
    }
    assert.strictEqual(cleanMarkdown("| а | б |").replace(/\s+/g, " "), "а б ,", "nonempty table cells must remain readable");
  });

  it("unwraps highlight markers around equality without consuming literal code operators", () => {
    for (const body of [
      "Пусть x = 5 и y = 10.", "Сравнение a == b.",
      "Проверка `a = 1` в коде.", "Проверка `a == b` в коде.",
      "Проверка ``a `nested` == b == c`` в коде.",
      "Проверка ```a == b``` в коде.", "Обычный\nперенос.",
    ]) {
      const source = "==" + body + "==";
      assert.strictEqual(cleanMarkdown(source), cleanMarkdown(body), source);
      const options = { pauseOnPunctuation: false, sentencePauseMultiplier: 2, commaPauseMultiplier: 1.4 };
      const words = parseWords(source, options);
      assert.deepStrictEqual(words.map(word => word.raw), parseWords(body, options).map(word => word.raw));
      for (const word of words) {
        const core = word.raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
        assert.strictEqual(source.slice(word.charOffset, word.charEndOffset), core);
      }
    }
    assert.strictEqual(cleanMarkdown("`==literal==` и ==visible=="), "==literal== и visible");
    assert.strictEqual(cleanMarkdown("==first== и ==second=="), "first и second");
    assert.strictEqual(cleanMarkdown("==unclosed"), "==unclosed");
  });

  it("preserves literal Markdown and operators inside inline code", () => {
    for (const body of ["$a", "Array<string>", "a * b * c", "a | b", "**bold**", "[label](url)", "<!--literal-->", "%%literal%%", "a_b_c", "value `nested` end"]) {
      const delimiter = body.includes("`") ? "``" : "`";
      assert.strictEqual(cleanMarkdown(delimiter + body + delimiter), body);
    }
    assert.strictEqual(cleanMarkdown("`$a` и `$b`"), "$a и $b");
    assert.strictEqual(cleanMarkdown("**до `Array<string>` после** и *текст*"), "до Array<string> после и текст");
    const source = "До `Array<string>` и `a | b` после.";
    const words = parseWords(source, { pauseOnPunctuation: false, sentencePauseMultiplier: 2, commaPauseMultiplier: 1.4 });
    for (const word of words) {
      const core = word.raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
      assert.strictEqual(source.slice(word.charOffset, word.charEndOffset), core);
    }
  });

  it("preserves long currency prose enclosing inline code", () => {
    const source = "Цена $5 за штуку, в коде `Array<string>` и ещё немного обычного текста до $10.";
    assert.strictEqual(cleanMarkdown(source), source.replaceAll("`", ""));
  });

  it("does not interpret short or long math across inline code", () => {
    for (const body of ["a `Array<string>` b", "a `Array<string>` " + "long prose ".repeat(6) + "b"]) {
      for (const [open, close] of [["$", "$"], ["$$", "$$"], ["\\(", "\\)"], ["\\[", "\\]"]]) {
        const source = open + body + close;
        assert.strictEqual(cleanMarkdown(source), source.replaceAll("`", ""), source);
      }
    }
  });

  it("does not expose hidden markup just because it contains backticks", () => {
    for (const [source, expected] of [
      ["before ![alt `code`](image.png) after", "before  after"],
      ['before <span title="`code`">after</span>', "before after"],
      ["[[target `code`|alias]]", "alias"],
      ["[label](`destination`)", "label"],
    ]) {
      assert.strictEqual(cleanMarkdown(source), expected, source);
    }
  });

  it("unwraps enclosing emphasis and link labels without dropping code", () => {
    for (const [open, close] of [
      ["**", "**"], ["*", "*"], ["__", "__"], ["_", "_"], ["~~", "~~"], ["==", "=="],
      ["[", "](https://example.com)"], ["[[target|", "]]"], ["[[", "]]"],
    ]) {
      assert.strictEqual(cleanMarkdown(open + "до `Array<string>` после" + close), "до Array<string> после");
    }
  });

  it("still removes complete hidden comments containing paired backticks", () => {
    for (const comment of ["<!-- hidden `Array<string>` -->", "%% hidden `Array<string>` %%"]) {
      assert.strictEqual(cleanMarkdown(comment + " `visible`"), "visible");
    }
  });

  it("keeps existing plain formula cleanup", () => {
    assert.strictEqual(cleanMarkdown("$x$ и $O(n)$ и \\(a+b\\)"), "x и O(n) и a+b");
    for (const source of ["$$a+b$$", "\\[a+b\\]", "$" + "a+b+".repeat(12) + "z$", "$a\nb$"]) {
      assert.strictEqual(cleanMarkdown(source), "", source);
    }
  });

  it("preserves adjacent code spans and their original offsets across wide math", () => {
    const sources = [
      "---\ntitle: hidden\n---\nЦена $5 за `Array<string>` и `Map<number>` вместе с длинным обычным описанием до $10.",
      "$a `Array<string>` `Map<number>` b$",
      "$a ``outer `inner` end`` и `next` b$",
    ];
    for (const source of sources) {
      const words = parseWords(source, { pauseOnPunctuation: false, sentencePauseMultiplier: 2, commaPauseMultiplier: 1.4 });
      assert.ok(words.some(word => word.raw.includes("Array<string>") || word.raw.includes("outer")));
      for (const word of words) {
        const core = word.raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
        const original = source.slice(word.charOffset, word.charEndOffset);
        assert.strictEqual(original, core, source);
      }
    }
  });

  it("cleans neighboring math and emphasis after a protected inline-code span", () => {
    assert.strictEqual(cleanMarkdown("`$a` и $x$"), "$a и x");
    assert.strictEqual(cleanMarkdown("`*a` и *текст*"), "*a и текст");
    assert.strictEqual(cleanMarkdown("`<a` и <b>текст</b>"), "<a и текст");
  });

  it("does not pair inline-code openers from hidden comments with visible text", () => {
    for (const comment of ["<!-- `unmatched -->", "%% `unmatched %%"]) {
      assert.strictEqual(cleanMarkdown(comment + " Outside `Array<string>` after."), "Outside Array<string> after.");
    }
    assert.strictEqual(cleanMarkdown("`<!-- literal` outside <!-- hidden ` --> `visible`"), "<!-- literal outside  visible");
  });

  it("interprets frontmatter only once on the original document", () => {
    for (const newline of ["\n", "\r\n"]) {
      const source = ["---", "title: one", "---", "---", "note: `Array<string>`", "---"].join(newline);
      assert.strictEqual(cleanMarkdown(source), "note: Array<string>");
      const words = parseWords(source, { pauseOnPunctuation: false, sentencePauseMultiplier: 2, commaPauseMultiplier: 1.4 });
      assert.strictEqual(words[1].raw, "Array<string>");
      assert.strictEqual(words[1].charOffset, source.indexOf("Array<string>"));
    }
  });

  it("removes YAML frontmatter", () => {
    const input = `---
title: My Note
tags: [reading, obsidian]
date: 2026-10-19
---
This is the actual note content.`;
    const result = cleanMarkdown(input);
    assert.strictEqual(result, "This is the actual note content.");
  });

  it("removes code blocks and keeps inline code text", () => {
    const input = "Here is some code:\n```javascript\nconsole.log('secret');\n```\nAnd an `inlineVariable` here.";
    const result = cleanMarkdown(input);
    assert.strictEqual(result, "Here is some code:\n\nAnd an inlineVariable here.");
  });

  it("replaces Obsidian wiki-links and Markdown links correctly", () => {
    const input = "Read [[Page Title]] or [[Target Note|Custom Alias]] or [External Site](https://example.com).";
    const result = cleanMarkdown(input);
    assert.strictEqual(result, "Read Page Title or Custom Alias or External Site.");
  });

  it("removes embedded images in both Obsidian and Markdown formats", () => {
    const input = "Look at this image: ![[screenshot.png]] and this one: ![caption](http://example.com/pic.jpg) done.";
    const result = cleanMarkdown(input);
    assert.strictEqual(result, "Look at this image:  and this one:  done.");
  });

  it("removes markdown headers, bold, italics and strikethroughs", () => {
    const input = "# Header 1\n## Subheader\n**bold text** and *italic text* and ~~deleted text~~.";
    const result = cleanMarkdown(input);
    assert.strictEqual(result, "Header 1\nSubheader\nbold text and italic text and deleted text.");
  });

  it("cleans blockquotes and lists including task checkboxes", () => {
    const input = "> A famous quote\n- Normal bullet\n- [ ] Unfinished task\n- [x] Finished task\n1. Numbered item";
    const result = cleanMarkdown(input);
    assert.strictEqual(result, "A famous quote\nNormal bullet\nUnfinished task\nFinished task\nNumbered item");
  });

  it("handles complex Russian text with mixed formatting", () => {
    const input = `---
tag: speedreading
---
# Скорочтение в Obsidian

**Скорочтение** (или [[Метод RSVP]]) позволяет читать со скоростью *500+* слов в минуту.
> «Книга — лучший подарок.»
- [x] Проверить плагин
- [ ] Настроить WPM`;
    const result = cleanMarkdown(input);
    assert.ok(result.includes("Скорочтение (или Метод RSVP) позволяет читать со скоростью 500+ слов в минуту."));
    assert.ok(!result.includes("---"));
    assert.ok(!result.includes("#"));
    assert.ok(!result.includes("**"));
  });
});

describe("textParser - inline code ranges", () => {
  it("exports exact source ranges while ignoring comments, fences and escaped openers", async () => {
    const parser = await import("../src/textParser.ts");
    assert.strictEqual(typeof parser.findInlineCodeRanges, "function");
    const source = "<!-- `hidden` --> %% `hidden` %%\n```\n`fenced`\n```\n\\`escaped and ``outer `inner` end`` `next`";
    const ranges = parser.findInlineCodeRanges(source);
    const expected = ["``outer `inner` end``", "`next`"].map(span => {
      const start = source.indexOf(span);
      const delimiterLength = span.startsWith("``") ? 2 : 1;
      return { start, contentStart: start + delimiterLength,
        contentEnd: start + span.length - delimiterLength, end: start + span.length };
    });
    assert.deepStrictEqual(ranges, expected);
  });
});

describe("textParser - getOrpIndex (Optimal Recognition Point)", () => {
  it("calculates correct ORP index for Latin words of various lengths", () => {
    assert.strictEqual(getOrpIndex("I"), 0);
    assert.strictEqual(getOrpIndex("a"), 0);
    assert.strictEqual(getOrpIndex("in"), 1);
    assert.strictEqual(getOrpIndex("the"), 1);
    assert.strictEqual(getOrpIndex("word"), 1);
    assert.strictEqual(getOrpIndex("speed"), 1);
    assert.strictEqual(getOrpIndex("reader"), 2);
    assert.strictEqual(getOrpIndex("reading"), 2);
    assert.strictEqual(getOrpIndex("computer"), 2);
    assert.strictEqual(getOrpIndex("technology"), 3);
    assert.strictEqual(getOrpIndex("comprehend"), 3);
    assert.strictEqual(getOrpIndex("unprecedentedly"), 4);
  });

  it("calculates correct ORP index for Cyrillic words", () => {
    assert.strictEqual(getOrpIndex("и"), 0);
    assert.strictEqual(getOrpIndex("он"), 1);
    assert.strictEqual(getOrpIndex("текст"), 1);
    assert.strictEqual(getOrpIndex("книга"), 1);
    assert.strictEqual(getOrpIndex("быстро"), 2);
    assert.strictEqual(getOrpIndex("внимание"), 2);
    assert.strictEqual(getOrpIndex("скорочтение"), 3);
    assert.strictEqual(getOrpIndex("способность"), 3);
    assert.strictEqual(getOrpIndex("электростанция"), 4);
  });

  it("handles punctuation padding without shifting the core word focus", () => {
    const idx1 = getOrpIndex("“hello!”");
    assert.strictEqual(idx1, 2);
    assert.strictEqual("“hello!”"[idx1], "e");

    const idx2 = getOrpIndex("(скорочтение),");
    assert.strictEqual(idx2, 4);
    assert.strictEqual("(скорочтение),"[idx2], "р");
  });
});

describe("textParser - parseWords", () => {
  const options = {
    pauseOnPunctuation: true,
    sentencePauseMultiplier: 2.0,
    commaPauseMultiplier: 1.4,
    pauseOnParagraphs: true,
    paragraphPauseMultiplier: 2.5,
    pauseOnNumbersAndAcronyms: true,
  };

  it("parses words into prefix, focusChar and suffix correctly", () => {
    const text = "Quick speed reader";
    const words = parseWords(text, options);

    assert.strictEqual(words.length, 3);
    assert.strictEqual(words[0].prefix, "Q");
    assert.strictEqual(words[0].focusChar, "u");
    assert.strictEqual(words[0].suffix, "ick");

    assert.strictEqual(words[1].prefix, "s");
    assert.strictEqual(words[1].focusChar, "p");
    assert.strictEqual(words[1].suffix, "eed");

    assert.strictEqual(words[2].prefix, "re");
    assert.strictEqual(words[2].focusChar, "a");
    assert.strictEqual(words[2].suffix, "der");
  });

  it("applies sentence pause multiplier on terminating punctuation", () => {
    const text = "Hello world! Are you ready? Yes.";
    const words = parseWords(text, options);

    assert.strictEqual(words[0].delayMultiplier, 1.0);
    assert.strictEqual(words[1].delayMultiplier, 2.0);
    assert.strictEqual(words[2].delayMultiplier, 1.0);
    assert.strictEqual(words[3].delayMultiplier, 1.0);
    assert.strictEqual(words[4].delayMultiplier, 2.0);
    assert.strictEqual(words[5].delayMultiplier, 2.0);
  });

  it("applies comma pause multiplier on intermediate punctuation", () => {
    const text = "First, second; third: fourth — fifth.";
    const words = parseWords(text, options);

    assert.strictEqual(words.length, 5);
    assert.strictEqual(words[0].delayMultiplier, 1.4);
    assert.strictEqual(words[1].delayMultiplier, 1.4);
    assert.strictEqual(words[2].delayMultiplier, 1.4);
    assert.strictEqual(words[3].delayMultiplier, 1.4);
    assert.strictEqual(words[4].delayMultiplier, 2.0);
  });

  it("Feature 1: applies extra pause on numbers and acronyms", () => {
    const text = "In year 2026 the API launched.";
    const words = parseWords(text, options);

    // "2026" contains digits -> 1.35x
    assert.strictEqual(words[2].delayMultiplier, 1.35);
    // "API" is all-caps acronym -> 1.35x
    assert.strictEqual(words[4].delayMultiplier, 1.35);
  });

  it("Feature 1: applies paragraph break pause at end of paragraph", () => {
    const text = "End of paragraph one.\n\nStart of paragraph two.";
    const words = parseWords(text, options);

    // Last word of first paragraph gets paragraph pause (2.5x)
    assert.strictEqual(words[3].isParagraphEnd, true);
    assert.strictEqual(words[3].delayMultiplier, 2.5);
  });

  it("Spritz Feature 4: adjusts duration dynamically based on word length", () => {
    // "In" (len 2) -> 0.8x
    // "book" (len 4) -> 1.0x
    // "technology" (len 10) -> 1.15x
    // "incomprehensible" (len 16) -> 1.35x
    const text = "In book technology incomprehensible";
    const words = parseWords(text, {
      pauseOnPunctuation: true,
      sentencePauseMultiplier: 2.0,
      commaPauseMultiplier: 1.4,
      spritzVariableTiming: true,
    });

    assert.strictEqual(words[0].delayMultiplier, 0.8);
    assert.strictEqual(words[1].delayMultiplier, 1.0);
    assert.strictEqual(words[2].delayMultiplier, 1.15);
    assert.strictEqual(words[3].delayMultiplier, 1.35);
  });
});

describe("textParser - ORP width regressions", () => {
  it("falls back to one focused character for NaN width without corrupting the token", () => {
    const parts = splitWordForOrp("слово,", NaN);
    assert.deepStrictEqual(parts, splitWordForOrp("слово,", 1));
    assert.strictEqual(parts.prefix + parts.focusChar + parts.suffix, "слово,");
  });
});

describe("textParser - punctuation regressions", () => {
  it("recognizes sentence and comma pauses through Russian and curly closing quotes", () => {
    const words = parseWords("«Готово!» “Дальше,” Конец.", { pauseOnPunctuation: true, sentencePauseMultiplier: 2, commaPauseMultiplier: 1.4, spritzVariableTiming: false });
    assert.deepStrictEqual(words.map((w) => w.delayMultiplier), [2, 1.4, 2]);
  });
});

describe("textParser - source offset regressions", () => {
  it("maps repeated visible words past hidden metadata, code, URLs and wiki targets", () => {
    const source = "---\ntitle: echo\n---\n```\necho\n```\n![echo](echo.png) [[echo|echo]] [echo](echo) echo";
    const words = parseWords(source, { pauseOnPunctuation: false, sentencePauseMultiplier: 2, commaPauseMultiplier: 1.4 });
    assert.deepStrictEqual(words.map((w) => w.raw), ["echo", "echo", "echo"]);
    assert.deepStrictEqual(words.map((w) => w.charOffset), [source.indexOf("|echo") + 1, source.indexOf("[echo](echo)") + 1, source.lastIndexOf("echo")]);
  });
});

describe("textParser - charOffset (cursor sync)", () => {
  const options = {
    pauseOnPunctuation: true,
    sentencePauseMultiplier: 2.0,
    commaPauseMultiplier: 1.4,
    pauseOnParagraphs: true,
    paragraphPauseMultiplier: 2.5,
    pauseOnNumbersAndAcronyms: true,
  };

  it("gives every repeated word its own occurrence, not the first one", () => {
    const source = "и кот и пёс и лиса";
    const words = parseWords(source, options);
    const offsets = words.map((w) => w.charOffset);

    assert.strictEqual(words.length, 6);
    assert.ok(offsets.every((o) => typeof o === "number"));
    for (let i = 1; i < offsets.length; i++) {
      assert.ok(
        (offsets[i] as number) > (offsets[i - 1] as number),
        `offset of "${words[i].raw}" must be greater than the previous word`
      );
    }
    for (let i = 0; i < words.length; i++) {
      const offset = offsets[i] as number;
      assert.strictEqual(
        source.slice(offset, offset + words[i].raw.length),
        words[i].raw,
        `source at offset ${offset} must start with "${words[i].raw}"`
      );
    }
  });

  it("points at the word itself when it is wrapped in markdown markup", () => {
    const source = "Начало **жирного** текста";
    const words = parseWords(source, options);
    const bold = words.find((w) => w.raw === "жирного");

    assert.ok(bold, "bold word must be parsed");
    assert.strictEqual(typeof bold!.charOffset, "number");
    assert.strictEqual(
      source.slice(bold!.charOffset!, bold!.charOffset! + "жирного".length),
      "жирного"
    );
  });

  it("points at the alias text of a wiki-link, not at the page name", () => {
    const source = "см. [[Длинное имя страницы|Алиас]] дальше";
    const words = parseWords(source, options);
    const alias = words.find((w) => w.raw === "Алиас");

    assert.ok(alias, "alias must be parsed as a word");
    assert.strictEqual(
      source.slice(alias!.charOffset!, alias!.charOffset! + "Алиас".length),
      "Алиас"
    );
  });

  it("keeps offsets after frontmatter pointing into the body", () => {
    const source = "---\ntitle: Заметка\n---\nПервое слово и второе";
    const words = parseWords(source, options);
    const frontmatterEnd = source.indexOf("Первое");

    assert.strictEqual(words.length, 4);
    assert.ok(
      (words[0].charOffset as number) >= frontmatterEnd,
      "first body word must be located after the frontmatter"
    );
    assert.strictEqual(source.slice(words[0].charOffset!), source.slice(frontmatterEnd));
  });
});

describe("textParser - зона фокуса (splitWordForOrp)", () => {
  it("по умолчанию подсвечивает одну букву в ORP", () => {
    const z = splitWordForOrp("проект", 1);
    assert.deepStrictEqual(z, { prefix: "пр", focusChar: "о", suffix: "ект" });
  });

  it("расширяется до 2 и 3 букв", () => {
    assert.deepStrictEqual(splitWordForOrp("скорочтение", 2), { prefix: "ско", focusChar: "ро", suffix: "чтение" });
    assert.deepStrictEqual(splitWordForOrp("административный", 3), { prefix: "адми", focusChar: "нис", suffix: "тративный" });
  });

  it("не съедает пунктуацию и не выходит за границы коротких слов", () => {
    assert.deepStrictEqual(splitWordForOrp("слово,", 3), { prefix: "с", focusChar: "лов", suffix: "о," });
    assert.deepStrictEqual(splitWordForOrp("и", 3), { prefix: "", focusChar: "и", suffix: "" });
    assert.deepStrictEqual(splitWordForOrp("кот", 3), { prefix: "к", focusChar: "от", suffix: "" });
  });

  it("parseWords прокидывает ширину зоны в результат", () => {
    const opts = { pauseOnPunctuation: true, sentencePauseMultiplier: 2, commaPauseMultiplier: 1.4, orpWidth: 2 };
    const [w] = parseWords("проект", opts);
    assert.strictEqual(w.prefix, "пр");
    assert.strictEqual(w.focusChar, "ое");
    assert.strictEqual(w.suffix, "кт");
  });
});

describe("textParser - formatting edge cases", () => {
  it("keeps underscores inside identifiers", () => {
    assert.strictEqual(cleanMarkdown("my_var_name и file_a"), "my_var_name и file_a");
    assert.strictEqual(cleanMarkdown("_курсив_ текст"), "курсив текст");
  });

  it("does not treat a leading horizontal rule as YAML frontmatter", () => {
    const text = "---\nПервый абзац\n\n---\nВторой абзац";
    assert.match(cleanMarkdown(text), /Первый абзац/);
    assert.match(cleanMarkdown(text), /Второй абзац/);
  });

  it("keeps comparison signs in prose", () => {
    assert.strictEqual(cleanMarkdown("если a < b и b > c"), "если a < b и b > c");
  });
});
