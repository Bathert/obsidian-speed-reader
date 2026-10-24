import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  cleanMarkdown,
  extractHeadings,
  findInlineCodeRanges,
  findWordIndexAtOffset,
  parseWords,
} from "../src/textParser.ts";
import {
  buildMotivationLine,
  findSentenceBounds,
  formatDuration,
  formatTimeRemaining,
} from "../src/speedEngine.ts";
import { detectSpeechLang, I18N, resolveLanguage } from "../src/i18n.ts";

const defaultOpts = {
  pauseOnPunctuation: true,
  sentencePauseMultiplier: 2.0,
  commaPauseMultiplier: 1.4,
  spritzVariableTiming: false,
};

describe("textParser - Obsidian syntax cleanup & offsets", () => {
  it("strips Obsidian comments, HTML comments, callout tags, math and footnotes", () => {
    const input = [
      "Visible %%hidden comment%% text <!-- html comment --> here.",
      "> [!warning]+ Important title",
      "Formula $$E = mc^2$$ and footnote[^1] with https://obsidian.md/plugins/speed-reader.",
    ].join("\n\n");

    const words = parseWords(input, defaultOpts);
    const rawWords = words.map((word) => word.raw);

    assert.ok(!rawWords.some((word) => word.includes("hidden")));
    assert.ok(!rawWords.some((word) => word.includes("comment")));
    assert.ok(!rawWords.some((word) => word.includes("[!warning]")));
    assert.ok(rawWords.includes("Important"));
    assert.ok(rawWords.includes("obsidian.md."));
  });

  it("keeps character offsets pointing at the visible word", () => {
    const input = [
      "Visible %%hidden comment%% text.",
      "> [!note] Callout title",
      "Formula $$E = mc^2$$ and footnote[^1] with https://obsidian.md/plugins/speed-reader.",
    ].join("\n\n");

    for (const word of parseWords(input, defaultOpts)) {
      const core = word.raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
      if (!core) continue;
      assert.equal(
        input.slice(word.charOffset!, word.charOffset! + core.length),
        core,
        `offset for «${word.raw}»`
      );
    }
  });

  it("preserves snake_case identifiers and < comparison operators", () => {
    const input = "Variable my_var_name and second_var where a < b and b > c.";
    const cleaned = cleanMarkdown(input);
    assert.ok(cleaned.includes("my_var_name"));
    assert.ok(cleaned.includes("second_var"));
    assert.ok(cleaned.includes("a < b and b > c."));
  });

  it("unwraps ==highlights== and drops table separator rows", () => {
    const input = "==Важная мысль== остаётся.\n\n| a | b |\n|---|---|\n| 1 | 2 |";
    const cleaned = cleanMarkdown(input);
    assert.ok(cleaned.includes("Важная мысль остаётся."));
    assert.ok(!cleaned.includes("==="));
    assert.ok(!cleaned.includes("|---|"));
  });

  it("does not eat note body starting with a horizontal rule", () => {
    const words = parseWords("---\n\nFirst paragraph here.\n\n---\n\nSecond paragraph.", defaultOpts);
    assert.equal(words[0].raw, "First");
  });

  it("extracts headings and maps offsets accurately", () => {
    const doc = "# Chapter One\n\nIntro words here.\n\n## Section Two\n\nMore text follows.";
    const words = parseWords(doc, defaultOpts);
    const headings = extractHeadings(doc, words);

    assert.equal(headings.length, 2);
    assert.deepEqual(
      headings.map((heading) => ({ level: heading.level, title: heading.title, first: words[heading.wordIndex].raw })),
      [
        { level: 1, title: "Chapter One", first: "Chapter" },
        { level: 2, title: "Section Two", first: "Section" },
      ]
    );

    const sectionOffset = doc.indexOf("More");
    assert.equal(words[findWordIndexAtOffset(words, sectionOffset)].raw, "More");
  });
});

describe("speedEngine & i18n - sentence bounds and localization", () => {
  it("finds sentence bounds around the current word", () => {
    const words = parseWords("First sentence. Second sentence has four words! Third.", defaultOpts);
    const bounds = findSentenceBounds(words, 3);
    assert.equal(words[bounds.start].raw, "Second");
    assert.equal(words[bounds.end].raw, "words!");
  });

  it("returns sane bounds at edges and for empty text", () => {
    assert.deepEqual(findSentenceBounds([], 0), { start: 0, end: 0 });
    const words = parseWords("Only one.", defaultOpts);
    assert.deepEqual(findSentenceBounds(words, 99), { start: 0, end: 1 });
  });

  it("supports Russian and English formatting", () => {
    assert.equal(formatDuration(45, "en"), "45s");
    assert.equal(formatDuration(90, "en"), "1.5m");
    assert.equal(formatDuration(45, "ru"), "45 с");
    assert.equal(formatTimeRemaining(600, 300, "en"), "~2m 0s left");
    assert.equal(formatTimeRemaining(600, 300, "ru"), "~2 мин 0 с");
    assert.match(buildMotivationLine(350, 500, "en"), /Great pace/);
    assert.match(buildMotivationLine(350, 500, "ru"), /Хороший темп/);
  });

  it("detects speech language and resolves the UI language", () => {
    assert.equal(detectSpeechLang("Привет мир"), "ru-RU");
    assert.equal(detectSpeechLang("Hello world"), "en-US");
    assert.equal(resolveLanguage("en"), "en");
    assert.equal(resolveLanguage("ru"), "ru");
    assert.ok(I18N.ru.resumeBtn && I18N.en.resumeBtn);
  });
});

describe("textParser - table cleanup regressions", () => {
  it("removes spaced separator rows but keeps content rows", () => {
    const input = "| a | b |\n| --- | :--- |\n| hello | world |";
    const cleaned = cleanMarkdown(input);
    assert.ok(!cleaned.includes("---"), "separator row must be removed");
    assert.ok(cleaned.includes("hello"));
    assert.ok(cleaned.includes("world"));
  });

  it("removes compact separators without eating a one-cell content row", () => {
    const cleaned = cleanMarkdown("|---|\n|cell|");
    assert.ok(!cleaned.includes("---"));
    assert.ok(cleaned.includes("cell"));
  });

  it("keeps charOffset on the focused letter and leading punctuation in raw", () => {
    const source = "Он сказал: «Слово» и ушёл.";
    const word = parseWords(source, defaultOpts).find((item) => item.raw.includes("Слово"))!;
    const leading = word.raw.match(/^[^\p{L}\p{N}]*/u)![0];
    assert.equal(leading, "«");
    assert.equal(source[word.charOffset! - leading.length], "«");
    assert.match(source[word.charOffset!] ?? "", /\p{L}/u);
  });
});

describe("textParser - cursor position regressions", () => {
  it("starts with the word containing the cursor instead of skipping it", () => {
    const words = parseWords("one two three", defaultOpts);
    assert.equal(findWordIndexAtOffset(words, 5), 1);
    assert.equal(findWordIndexAtOffset(words, 4), 1);
    assert.equal(findWordIndexAtOffset(words, 7), 2, "space starts the next word");
    assert.equal(findWordIndexAtOffset(words, 99), 2);
    assert.equal(findWordIndexAtOffset([], 5), 0);
  });

  it("recognizes a word spanning inline Markdown at the cursor", () => {
    const source = "one **tw**o three";
    const words = parseWords(source, defaultOpts);
    assert.equal(words[1].raw, "two");
    assert.equal(findWordIndexAtOffset(words, source.indexOf("o three")), 1);
  });
});

describe("textParser - heading visibility regressions", () => {
  it("excludes code headings even when code reading is enabled", () => {
    const source = "```md\n# Example, not a chapter\n```\n\n# Real chapter\nText";
    for (const readCodeBlocks of [false, true]) {
      const words = parseWords(source, { ...defaultOpts, readCodeBlocks });
      const headings = extractHeadings(source, words);
      assert.deepEqual(headings.map((heading) => heading.title), ["Real chapter"]);
      assert.equal(words[headings[0].wordIndex].raw, "Real");
    }
  });

  it("ignores tilde fences, longer fences and unclosed fences", () => {
    const source = [
      "# Real", "~~~md", "# Hidden", "~~~", "````md", "```",
      "# Still hidden", "````", "## Visible", "```md", "# Unclosed hidden",
    ].join("\n");
    const words = parseWords(source, { ...defaultOpts, readCodeBlocks: true });
    assert.deepEqual(extractHeadings(source, words).map((heading) => heading.title), ["Real", "Visible"]);
  });

  it("ignores headings removed as comments or frontmatter", () => {
    const source = "---\ntitle: test\n# Metadata comment\n---\n<!--\n# HTML comment\n-->\n%%\n# Obsidian comment\n%%\n# Real\nText";
    const words = parseWords(source, defaultOpts);
    assert.deepEqual(extractHeadings(source, words).map((heading) => heading.title), ["Real"]);
  });
});

describe("textParser - fenced code boundary regressions", () => {
  for (const fence of ["~~~", "~~~~", "```", "````"]) {
    it(`handles ${fence.length}-character ${fence[0]} fences in both reading modes`, () => {
      const source = `Before.\r\n\r\n  ${fence}js\r\nsecret code\r\n  ${fence}\r\n\r\nAfter.`;
      for (const readCodeBlocks of [false, true]) {
        const words = parseWords(source, { ...defaultOpts, readCodeBlocks });
        assert.deepEqual(words.map((word) => word.raw), readCodeBlocks
          ? ["Before.", "secret", "code", "After."] : ["Before.", "After."]);
        const last = words.at(-1)!;
        assert.equal(last.charOffset, source.indexOf("After."));
        assert.equal(last.charEndOffset, source.indexOf("After.") + "After".length);
      }
    });
  }

  it("does not close a fence on a shorter delimiter, a different marker or trailing text", () => {
    const source = "Before.\n\n````md\nhidden\n```\nstill hidden\n~~~~\n````invalid\nmore hidden\n`````\nAfter.";
    assert.deepEqual(parseWords(source, defaultOpts).map((word) => word.raw), ["Before.", "After."]);
  });

  it("treats an unclosed fence as code until the end of the note", () => {
    for (const fence of ["~~~", "```"]) {
      const source = `Before.\n\n${fence}js\nsecret code`;
      assert.deepEqual(parseWords(source, defaultOpts).map((word) => word.raw), ["Before."]);
      assert.deepEqual(parseWords(source, { ...defaultOpts, readCodeBlocks: true }).map((word) => word.raw),
        ["Before.", "secret", "code"]);
    }
  });
});

describe("textParser - inline code after hidden fences", () => {
  it("preserves the exact reported HTML and Obsidian comment examples", () => {
    assert.equal(cleanMarkdown("<!--\n```\n-->\n`Array<string>` after"), "Array<string> after");
    assert.equal(cleanMarkdown("%%\n~~~\n%%\n`Array<string>` after"), "Array<string> after");
  });

  for (const newline of ["\n", "\r\n"]) {
    for (const [open, close] of [["<!--", "-->"], ["%%", "%%"]]) {
      for (const fence of ["```", "~~~"]) {
        for (const paired of [false, true]) {
          it(`ignores ${paired ? "paired" : "unclosed"} ${fence} in ${open} with ${JSON.stringify(newline)}`, () => {
            const hidden = [open, "hidden `ticks`", fence, "example", ...(paired ? [fence] : []), close].join(newline);
            const source = `${hidden}${newline}\`Array<string>\` after`;
            assert.equal(cleanMarkdown(source), "Array<string> after");
            const start = source.indexOf("`Array");
            assert.deepEqual(findInlineCodeRanges(source), [{
              start, contentStart: start + 1, contentEnd: start + "`Array<string>".length,
              end: start + "`Array<string>`".length,
            }]);
            const words = parseWords(source, defaultOpts);
            assert.deepEqual(words.map(word => word.raw), ["Array<string>", "after"]);
            assert.equal(words[0].charOffset, start + 1);
            assert.equal(words[0].charEndOffset, start + "`Array<string".length);
            assert.equal(words[1].charOffset, source.indexOf("after"));
            assert.equal(words[1].charEndOffset, source.length);
          });
        }
      }
    }
  }

  it("keeps literal comment markers in code even after a hidden fence", () => {
    for (const literal of ["<!-- literal -->", "%% literal %%"]) {
      const source = `<!--\n\`\`\`\n-->\n\`Array<string> ${literal}\` after`;
      assert.equal(cleanMarkdown(source), `Array<string> ${literal} after`);
    }
  });

  it("keeps report1 code pairing and literal backslashes inside code", () => {
    for (const literal of ["<!-- hidden ` secret -->", "%% hidden ` secret %%"]) {
      const source = `\`unmatched ${literal} \`Array<string>\``;
      assert.deepEqual(findInlineCodeRanges(source).map(range => source.slice(range.contentStart, range.contentEnd)),
        [`unmatched ${literal.slice(0, literal.indexOf("`"))}`, "Array<string>"]);
    }
    const source = "`a \\` b`";
    assert.deepEqual(findInlineCodeRanges(source), [{ start: 0, contentStart: 1, contentEnd: 4, end: 5 }]);
  });

  it("allows multiline inline code but never pairs across real fenced blocks", () => {
    const multiline = "`Array<string>\nnext`";
    assert.equal(cleanMarkdown(multiline), "Array<string>\nnext");
    for (const fence of ["```", "~~~"]) {
      const source = `\`before\n${fence}\n\`inside\`\n${fence}\nafter\` then \`Array<string>\``;
      assert.deepEqual(findInlineCodeRanges(source).map(range => source.slice(range.contentStart, range.contentEnd)),
        [" then "]);
      const unclosed = `${fence}\n<!--\n\`Array<string>\`\n-->`;
      assert.deepEqual(findInlineCodeRanges(unclosed), []);
    }
  });
});

describe("textParser - technical notes", () => {
  const code = "Текст до.\n\n```ts\nconst x = 1;\n```\n\nТекст после.";

  it("skips fenced code blocks by default", () => {
    const words = parseWords(code, defaultOpts).map((word) => word.raw);
    assert.ok(!words.includes("const"));
    assert.ok(words.includes("до."));
    assert.ok(words.includes("после."));
  });

  it("reads fenced code when readCodeBlocks is enabled", () => {
    const words = parseWords(code, { ...defaultOpts, readCodeBlocks: true }).map((word) => word.raw);
    assert.ok(words.includes("const"));
    assert.ok(words.some((word) => word.startsWith("x")));
    assert.ok(words.includes("1;"));
    assert.ok(!words.some((word) => word.includes("```")));
  });

  it("drops display math and long formulas but keeps short inline variables", () => {
    const input = "Формула $$E = mc^2$$ и переменная $x$ вместе с $\frac{a}{b} + c$ конец.";
    const words = parseWords(input, defaultOpts).map((word) => word.raw);
    assert.ok(!words.some((word) => word.includes("mui")));
    assert.ok(!words.some((word) => word.includes("$$")));
    assert.ok(words.includes("x"));
    assert.ok(!words.some((word) => word.includes("frac")));
  });

  it("flattens table rows into words and pauses at row end", () => {
    const table = "| Имя | Роль |\n| --- | --- |\n| Том | принц |";
    const words = parseWords(table, { ...defaultOpts, pauseOnPunctuation: true, pauseOnParagraphs: true, paragraphPauseMultiplier: 2.5 });
    const raw = words.map((word) => word.raw);
    assert.deepEqual(raw, ["Имя", "Роль ,", "Том", "принц ,"]);
    assert.ok(words.every((word) => !word.raw.includes("|")));
    assert.ok(words.at(-1)!.delayMultiplier > 1, "row end gets a pause multiplier");
  });
});
