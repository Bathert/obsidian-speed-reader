/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import { isSentenceEndWord } from "./speedEngine.ts";

export interface ParsedWord {
  raw: string;
  prefix: string;
  focusChar: string;
  suffix: string;
  delayMultiplier: number;
  isParagraphEnd?: boolean;
  charOffset?: number;
  /** Exclusive source offset after the last core-word character. */
  charEndOffset?: number;
  /** Source boundaries of the complete visible token, including punctuation. */
  sourceStartOffset?: number;
  sourceEndOffset?: number;
}

export interface HeadingItem {
  level: number;
  title: string;
  charOffset: number;
  wordIndex: number;
}

export interface ParseOptions {
  pauseOnPunctuation: boolean;
  sentencePauseMultiplier: number;
  commaPauseMultiplier: number;
  pauseOnParagraphs?: boolean;
  paragraphPauseMultiplier?: number;
  pauseOnNumbersAndAcronyms?: boolean;
  spritzVariableTiming?: boolean; // Spritz feature 4: non-linear length timing
  /** Read fenced code blocks instead of skipping them. */
  readCodeBlocks?: boolean;
  /** Сколько букв подсвечивать в зоне фокуса: 1 (как в Spritz), 2 или 3. */
  orpWidth?: number;
}

/**
 * Strips markdown syntax to extract readable words for RSVP.
 */
export function cleanMarkdown(text: string, readCodeBlocks: boolean = false): string {
  return cleanMarkdownWithOffsets(text, readCodeBlocks).text;
}

interface FencedCodeRange {
  start: number;
  openingEnd: number;
  closingStart: number;
  end: number;
}

/** Locate complete or EOF-terminated fences without confusing their contents with delimiters. */
function findFencedCodeRanges(text: string): FencedCodeRange[] {
  const ranges: FencedCodeRange[] = [];
  let open: { marker: string; length: number; start: number; openingEnd: number } | null = null;
  const lines = /[^\n]*(?:\n|$)/g;
  let match: RegExpExecArray | null;
  while ((match = lines.exec(text)) !== null && match[0].length > 0) {
    const line = match[0].replace(/\r?\n$/, "");
    const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!delimiter) continue;
    if (open) {
      if (delimiter[1][0] === open.marker && delimiter[1].length >= open.length && !delimiter[2].trim()) {
        ranges.push({ start: open.start, openingEnd: open.openingEnd,
          closingStart: match.index, end: match.index + line.length });
        open = null;
      }
    } else if (delimiter[1][0] !== "`" || !delimiter[2].includes("`")) {
      open = { marker: delimiter[1][0], length: delimiter[1].length,
        start: match.index, openingEnd: match.index + line.length };
    }
  }
  if (open) ranges.push({ start: open.start, openingEnd: open.openingEnd,
    closingStart: text.length, end: text.length });
  return ranges;
}

/** A leading horizontal rule is not frontmatter unless the block contains YAML keys. */
function findFrontmatterEnd(text: string): number {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  return frontmatter && /^[ \t]*[A-Za-z_][\w-]*[ \t]*:/m.test(frontmatter[1]) ? frontmatter[0].length : 0;
}

export interface InlineCodeRange {
  start: number;
  contentStart: number;
  contentEnd: number;
  end: number;
}

/** Pair exact-length backtick runs, excluding fenced code and escaped openers. */
export function findInlineCodeRanges(text: string): InlineCodeRange[] {
  const bodyStart = findFrontmatterEnd(text);
  // Collect candidates, not raw fence ranges: a delimiter becomes a fence
  // only when reached outside an earlier comment or inline-code span.
  const fences: { start: number; markerStart: number; end: number; marker: string; length: number; canClose: boolean }[] = [];
  const delimiters = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)/gm;
  delimiters.lastIndex = bodyStart;
  let match: RegExpExecArray | null;
  while ((match = delimiters.exec(text)) !== null) {
    if (match[1][0] === "`" && match[2].includes("`")) continue;
    fences.push({ start: match.index, markerStart: match.index + match[0].indexOf(match[1]),
      end: delimiters.lastIndex, marker: match[1][0], length: match[1].length, canClose: !match[2].trim() });
  }
  const runs: { start: number; end: number }[] = [];
  const pattern = /`+/g;
  pattern.lastIndex = bodyStart;
  while ((match = pattern.exec(text)) !== null) {
    runs.push({ start: match.index, end: match.index + match[0].length });
  }
  const next = new Array<number>(runs.length).fill(-1);
  const byLength = new Map<number, number>();
  for (let index = runs.length - 1; index >= 0; index--) {
    const length = runs[index].end - runs[index].start;
    next[index] = byLength.get(length) ?? -1;
    byLength.set(length, index);
  }
  const ranges: InlineCodeRange[] = [];
  const byStart = new Map(runs.map((run, index) => [run.start, index]));
  const events = /<!--|%%|^ {0,3}~{3,}|`+/gm;
  events.lastIndex = bodyStart;
  let fenceIndex = 0;
  while ((match = events.exec(text)) !== null) {
    while (fenceIndex < fences.length && fences[fenceIndex].markerStart < match.index) fenceIndex++;
    const fence = fences[fenceIndex];
    if (fence && fence.start <= match.index) {
      // A real fence owns all following lines, including apparent comments,
      // until a compatible closing delimiter (or EOF) is reached.
      events.lastIndex = text.length;
      for (fenceIndex++; fenceIndex < fences.length; fenceIndex++) {
        const closing = fences[fenceIndex];
        if (closing.marker === fence.marker && closing.length >= fence.length && closing.canClose) {
          events.lastIndex = closing.end;
          fenceIndex++;
          break;
        }
      }
      continue;
    }
    if (match[0] === "<!--" || match[0] === "%%") {
      const closingMarker = match[0] === "<!--" ? "-->" : "%%";
      const closing = text.indexOf(closingMarker, events.lastIndex);
      if (closing >= 0) events.lastIndex = closing + closingMarker.length;
      continue;
    }
    const index = byStart.get(match.index);
    if (index === undefined) continue;
    let escaped = 0;
    for (let before = runs[index].start - 1; before >= 0 && text.charCodeAt(before) === 92; before--) escaped++;
    if (escaped % 2 || next[index] < 0) continue;
    const closing = next[index];
    if (fenceIndex < fences.length && fences[fenceIndex].start <= runs[closing].start) continue;
    ranges.push({ start: runs[index].start, contentStart: runs[index].end,
      contentEnd: runs[closing].start, end: runs[closing].end });
    events.lastIndex = runs[closing].end;
  }
  return ranges;
}

/** Keep source positions through exactly the same transformations as visible text. */
function cleanMarkdownWithOffsets(text: string, readCodeBlocks: boolean = false): {
  text: string; offsets: number[]; wrappers: { start: number; end: number }[];
} {
  let cleaned = text;
  let offsets = Array.from({ length: text.length }, (_, index) => index);
  const wrappers: { start: number; end: number }[] = [];
  let inlineCode: InlineCodeRange[] = [];
  const inlineCodeAt = (offset: number, end: number = offset + 1): InlineCodeRange | undefined => {
    if (end <= offset) return undefined;
    let low = 0, high = inlineCode.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (inlineCode[middle].end <= offset) low = middle + 1;
      else high = middle;
    }
    const range = inlineCode[low];
    return range && range.start < end ? range : undefined;
  };
  const replace = (pattern: RegExp, replacement: string, allowEnclosingCode: boolean = true): void => {
    // On a clean note most patterns never match: skip copying the whole
    // offset array for each of them.
    if (!new RegExp(pattern.source, pattern.flags.replace(/[gd]/g, "")).test(cleaned)) return;
    const nextOffsets: number[] = [];
    const appendOffsets = (start: number, end: number): void => {
      for (let index = start; index < end; index++) nextOffsets.push(offsets[index]);
    };
    const scanner = new RegExp(pattern.source, pattern.flags.replace(/[gd]/g, "") + "gd");
    const parts: string[] = [];
    const groupMatch = /^\$(\d+)([\s\S]*)$/.exec(replacement);
    let end = 0;
    let match: RegExpExecArray | null;
    while ((match = scanner.exec(cleaned)) !== null) {
      const start = match.index;
      const matchEnd = start + match[0].length;
      const retained = groupMatch
        ? (match as RegExpExecArray & { indices: [number, number][] }).indices[Number(groupMatch[1])]
        : undefined;
      // A rule cannot start/end inside code. Math must not cross any code,
      // but real enclosing Markdown still unwraps or hides its own contents.
      const protectedRange = inlineCodeAt(offsets[start]) ?? inlineCodeAt(offsets[matchEnd - 1])
        ?? (allowEnclosingCode ? undefined : inlineCodeAt(offsets[start], offsets[matchEnd - 1] + 1));
      // Resume after protected code rather than swallowing a later valid match.
      if (protectedRange) {
        let nextStart = start;
        while (nextStart < offsets.length && offsets[nextStart] < protectedRange.end) nextStart++;
        scanner.lastIndex = Math.max(start + 1, nextStart);
        continue;
      }
      parts.push(cleaned.slice(end, start));
      appendOffsets(end, start);
      // Record only transformations that retain readable content. The editor
      // must expand precisely the wrappers the cleaner actually recognized,
      // rather than reinterpret literal underscores with a second parser.
      if (retained && retained[1] > retained[0] && groupMatch?.[2] === "") {
        wrappers.push({ start: offsets[start], end: offsets[matchEnd - 1] + 1 });
      }
      end = matchEnd;
      if (replacement) {
        if (groupMatch && retained) {
          const group = Number(groupMatch[1]);
          const suffix = groupMatch[2];
          appendOffsets(retained[0], retained[1]);
          for (let index = 0; index < suffix.length; index++) nextOffsets.push(offsets[retained[1] - 1] ?? 0);
          parts.push(match[group] + suffix);
        } else {
          for (let index = 0; index < replacement.length; index++) nextOffsets.push(offsets[start] ?? 0);
          parts.push(replacement);
        }
      }
      if (!pattern.global) break;
      if (!match[0].length) scanner.lastIndex++;
    }
    parts.push(cleaned.slice(end));
    appendOffsets(end, offsets.length);
    cleaned = parts.join("");
    offsets = nextOffsets;
  };

  // Remove YAML frontmatter: a delimited block that actually holds YAML keys,
  // so a note that starts with a horizontal rule keeps its first paragraph.
  const frontmatterEnd = findFrontmatterEnd(cleaned);
  if (frontmatterEnd) {
    cleaned = cleaned.slice(frontmatterEnd);
    offsets = offsets.slice(frontmatterEnd);
  }

  inlineCode = findInlineCodeRanges(text);
  wrappers.push(...inlineCode.map(({ start, end }) => ({ start, end })));

  // Remove Obsidian and HTML comments
  replace(/%%[\s\S]*?%%/g, "");
  replace(/<!--[\s\S]*?-->/g, "");

  // Code blocks: skip the entire range, or just its opening/closing lines.
  const codeRanges = findFencedCodeRanges(cleaned);
  if (codeRanges.length > 0) {
    const removed: { start: number; end: number }[] = [];
    for (const range of codeRanges) {
      if (readCodeBlocks) removed.push({ start: range.start, end: range.openingEnd },
        { start: range.closingStart, end: range.end });
      else removed.push({ start: range.start, end: range.end });
    }
    const parts: string[] = [];
    const nextOffsets: number[] = [];
    let cursor = 0;
    for (const range of [...removed, { start: cleaned.length, end: cleaned.length }]) {
      parts.push(cleaned.slice(cursor, range.start));
      for (let index = cursor; index < range.start; index++) nextOffsets.push(offsets[index]);
      cursor = range.end;
    }
    cleaned = parts.join("");
    offsets = nextOffsets;
  }

  // Display math (block and bracket forms) is not read word by word.
  replace(/\$\$[\s\S]*?\$\$/g, "", false);
  replace(/\\\[[\s\S]*?\\\]/g, "", false);

  // Inline math: keep short variables ($x$, $O(n)$) as text, drop formulas.
  // Unlike enclosing emphasis or link labels, math cannot cross inline code.
  // Single-dollar rules must not consume a rejected display-math delimiter.
  replace(/\\\(([\s\S]*?)\\\)/g, "$1", false);
  replace(/(?<!\$)\$([^$\n]{1,40})\$(?!\$)/g, "$1", false);
  replace(/(?<!\$)\$[^$]+\$(?!\$)/g, "", false);


  // Remove images ![[image]] or ![alt](url)
  replace(/!\[\[.*?\]\]/g, "");
  replace(/!\[.*?\]\(.*?\)/g, "");

  // Replace Obsidian links [[page|alias]] -> alias, [[page]] -> page
  replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, "$1");

  // Replace Markdown links [text](url) -> text
  replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  // Remove footnote references
  replace(/\[\^[^\]]+\]:?/g, "");

  // Remove HTML tags, but not prose like "a < b and b > c".
  replace(/<\/?[a-zA-Z][^>]*>/g, "");

  // Remove callout type markers (> [!note]) but keep the title
  replace(/^\s*>\s*\[![^\]]+\][+-]?\s*/gm, "");

  // Pair highlight delimiters outside exact source-code ranges. A closing
  // marker needs a non-space on its left (so "a == b" stays literal).
  // Soft line breaks are valid in the host; blank paragraphs are not.
  const highlightMarkers = /==|\r?\n[ \t]*\r?\n/g;
  const highlightDelimiters = new Set<number>();
  let highlightStart = -1;
  let highlightMarker: RegExpExecArray | null;
  while ((highlightMarker = highlightMarkers.exec(cleaned)) !== null) {
    if (highlightMarker[0] !== "==") { highlightStart = -1; continue; }
    const index = highlightMarker.index;
    if (inlineCodeAt(offsets[index]) || inlineCodeAt(offsets[index + 1])) continue;
    let escapes = 0;
    for (let before = offsets[index] - 1; before >= 0 && text.charCodeAt(before) === 92; before--) escapes++;
    if (escapes % 2) continue;
    if (highlightStart >= 0 && !/\s/.test(cleaned[index - 1])) {
      wrappers.push({ start: offsets[highlightStart], end: offsets[index + 1] + 1 });
      for (const position of [highlightStart, highlightStart + 1, index, index + 1]) highlightDelimiters.add(position);
      highlightStart = -1;
    } else if (highlightStart < 0 && index + 2 < cleaned.length && !/\s/.test(cleaned[index + 2])) {
      highlightStart = index;
    }
  }
  if (highlightDelimiters.size) {
    const characters: string[] = [];
    const retainedOffsets: number[] = [];
    for (let index = 0; index < cleaned.length; index++) {
      if (highlightDelimiters.has(index)) continue;
      characters.push(cleaned[index]);
      retainedOffsets.push(offsets[index]);
    }
    cleaned = characters.join("");
    offsets = retainedOffsets;
  }

  // Unwrap highlights before URL shortening: a path otherwise consumes its
  // adjacent closing == and leaves an unmatched opening marker on reopen.
  replace(/https?:\/\/([^\s/)#?]+)(?:[^\s).,;:!?]*)/g, "$1");

  // Remove header hashes (#, ##, etc.) but keep title words
  replace(/^#{1,6}\s+/gm, "");

  // Remove bold, italic, strikethrough: **, *, __, _, ~~
  replace(/(\*\*|__)(.*?)\1/g, "$2");
  replace(/\*([^*\n]+)\*/g, "$1");
  replace(/(?<![\p{L}\p{N}])_([^_\n]+)_(?![\p{L}\p{N}])/gu, "$1");
  replace(/~~(.*?)~~/g, "$1");

  // Remove blockquotes (>)
  replace(/^\s*>\s*/gm, "");

  // Remove markdown table separators and empty rows such as ||.
  replace(/^[ \t]*\|[-:| \t]*\|[ \t]*$/gm, "");

  // Tables: keep the cells as readable words, end each row with a pause.
  replace(/^[ \t]*\|(.*?)\|[ \t]*$/gm, "$1 ,");
  replace(/[ \t]*\|[ \t]*/g, " ");

  // Remove task list checkboxes like - [ ] or - [x]
  replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, "");

  // Remove list bullets: -, *, +, 1.
  replace(/^\s*[-*+]\s+/gm, "");
  replace(/^\s*\d+\.\s+/gm, "");

  // Remove horizontal rules
  replace(/^\s*[-*_]{3,}\s*$/gm, "");

  // Strip only the original code delimiters after all Markdown rules finish.
  const delimiters = new Set<number>();
  for (const range of inlineCode) {
    for (let index = range.start; index < range.contentStart; index++) delimiters.add(index);
    for (let index = range.contentEnd; index < range.end; index++) delimiters.add(index);
  }
  if (delimiters.size > 0) {
    const characters: string[] = [];
    const retainedOffsets: number[] = [];
    for (let index = 0; index < cleaned.length; index++) {
      if (delimiters.has(offsets[index])) continue;
      characters.push(cleaned[index]);
      retainedOffsets.push(offsets[index]);
    }
    cleaned = characters.join("");
    offsets = retainedOffsets;
  }
  const start = cleaned.match(/^\s*/)![0].length;
  const trimmed = cleaned.trim();
  return { text: trimmed, offsets: offsets.slice(start, start + trimmed.length), wrappers };
}

/**
 * Calculates the Optimal Recognition Point (ORP) index in a word based on Spritz research.
 */
export function getOrpIndex(word: string): number {
  const match = word.match(/^([^\p{L}\p{N}]*)([\p{L}\p{N}].*?)([^\p{L}\p{N}]*)$/u);
  if (!match) {
    return Math.floor(word.length / 2);
  }

  const prefixPunctLen = match[1].length;
  const coreWord = match[2];
  const len = coreWord.length;

  let coreOrp = 0;
  if (len <= 1) {
    coreOrp = 0;
  } else if (len <= 5) {
    coreOrp = 1;
  } else if (len <= 9) {
    coreOrp = 2;
  } else if (len <= 13) {
    coreOrp = 3;
  } else {
    coreOrp = 4;
  }

  return prefixPunctLen + coreOrp;
}

/**
 * Делит слово на три части вокруг зоны фокуса.
 *
 * Зона начинается в ORP (оптимальная точка распознавания) и состоит из `width`
 * букв. Хвостовая пунктуация в зону не попадает: для «слово,» с width=3
 * подсветятся буквы ядра, а запятая останется в суффиксе.
 */
export function splitWordForOrp(
  token: string,
  width: number = 1
): { prefix: string; focusChar: string; suffix: string } {
  const match = token.match(/^([^\p{L}\p{N}]*)([\p{L}\p{N}].*?)([^\p{L}\p{N}]*)$/u);
  const safeWidth = Number.isNaN(width) ? 1 : Math.max(1, Math.min(3, Math.round(width)));

  if (!match) {
    const start = Math.floor(token.length / 2);
    return {
      prefix: token.slice(0, start),
      focusChar: token.slice(start, start + safeWidth) || token.charAt(start),
      suffix: token.slice(start + safeWidth),
    };
  }

  const prefixPunct = match[1];
  const coreWord = match[2];

  const orp = getOrpIndex(token);
  const coreEnd = prefixPunct.length + coreWord.length;
  const zoneEnd = Math.min(orp + safeWidth, coreEnd);

  return {
    prefix: token.slice(0, orp),
    focusChar: token.slice(orp, zoneEnd),
    suffix: token.slice(zoneEnd),
  };
}

/**
 * Parses cleaned text into a sequence of ParsedWords with ORP segments,
 * paragraph boundary awareness, and Spritz variable pacing.
 */
export function parseWords(text: string, options: ParseOptions): ParsedWord[] {
  return parseDocument(text, options).words;
}

/** Words and recognized wrappers from one cleanup pass over the original source. */
export function parseDocument(text: string, options: ParseOptions): {
  words: ParsedWord[]; wrappers: { start: number; end: number }[];
} {
  const { text: cleaned, offsets, wrappers } = cleanMarkdownWithOffsets(text, options.readCodeBlocks ?? false);
  if (!cleaned.trim()) return { words: [], wrappers };

  // Split into paragraphs by double newlines
  const paragraphs = cleaned.split(/\n\s*\n+/).filter((p) => p.trim().length > 0);
  const result: ParsedWord[] = [];

  // Locate tokens in visible text, retaining punctuation positions across hidden syntax.
  let paragraphSearchFrom = 0;

  for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
    const paragraph = paragraphs[pIdx];
    const paragraphStart = cleaned.indexOf(paragraph, paragraphSearchFrom);
    paragraphSearchFrom = paragraphStart + paragraph.length;

    // Merge standalone punctuation with preceding word
    const mergedTokens: { raw: string; start: number; end: number }[] = [];
    const tokenPattern = /\S+/g;
    let tokenMatch: RegExpExecArray | null;
    while ((tokenMatch = tokenPattern.exec(paragraph)) !== null) {
      const token = tokenMatch[0];
      const start = paragraphStart + tokenMatch.index;
      const end = start + token.length;
      const hasWordChar = /[\p{L}\p{N}]/u.test(token);
      if (!hasWordChar && mergedTokens.length > 0) {
        const previous = mergedTokens[mergedTokens.length - 1];
        previous.raw += ` ${token}`;
        previous.end = end;
      } else if (hasWordChar) {
        mergedTokens.push({ raw: token, start, end });
      }
    }

    const isLastParagraph = pIdx === paragraphs.length - 1;

    for (let tIdx = 0; tIdx < mergedTokens.length; tIdx++) {
      const visibleToken = mergedTokens[tIdx];
      const token = visibleToken.raw;
      const isParagraphEnd = tIdx === mergedTokens.length - 1 && !isLastParagraph;

      const { prefix, focusChar, suffix } = splitWordForOrp(token, options.orpWidth ?? 1);

      // Spritz Feature 4: Variable duration based on word length
      const coreWord = token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
      let lengthMultiplier = 1.0;
      if (options.spritzVariableTiming !== false) {
        if (coreWord.length <= 2 && coreWord.length > 0) {
          lengthMultiplier = 0.8; // Short words (in, to, и, в) read 20% faster
        } else if (coreWord.length >= 13) {
          lengthMultiplier = 1.35; // Very long words need extra processing
        } else if (coreWord.length >= 9) {
          lengthMultiplier = 1.15; // Moderately long words
        }

        // Long hyphenated compounds (often unfamiliar names) need time to
        // recognize each part. Ignore short forms like «кто-то» and em dashes.
        const compoundParts = coreWord.split(/[-\u2010\u2011]/u);
        if (
          compoundParts.length > 1 &&
          compoundParts.every((part) => /^\p{L}+$/u.test(part)) &&
          compoundParts.join("").length >= 9
        ) {
          lengthMultiplier = Math.max(lengthMultiplier, 2);
        }
      }

      let punctMultiplier = 1.0;

      if (options.pauseOnPunctuation) {
        if (isParagraphEnd && options.pauseOnParagraphs) {
          punctMultiplier = options.paragraphPauseMultiplier ?? 2.5;
        } else if (isSentenceEndWord(token)) {
          punctMultiplier = options.sentencePauseMultiplier;
        } else if (/[,;:—–-]+["'»”’）)\]}]*$/.test(token)) {
          punctMultiplier = options.commaPauseMultiplier;
        } else if (
          options.pauseOnNumbersAndAcronyms &&
          (/\d/.test(token) || /^[A-ZА-ЯЁ\d]{2,}[.,;:!?]?$/u.test(token))
        ) {
          punctMultiplier = 1.35;
        }
      }

      // Final delay is length multiplier combined with punctuation multiplier
      const delayMultiplier = Math.round(lengthMultiplier * punctMultiplier * 100) / 100;

      // Locate the first visible letter, including words spanning markup.
      let charOffset: number | undefined;
      let charEndOffset: number | undefined;
      if (coreWord.length > 0) {
        const prefixLength = token.match(/^[^\p{L}\p{N}]*/u)![0].length;
        const found = visibleToken.start + prefixLength;
        if (cleaned.slice(found, found + coreWord.length) === coreWord) {
          charOffset = offsets[found];
          charEndOffset = offsets[found + coreWord.length - 1] + 1;
        }
      }

      result.push({
        raw: token,
        prefix,
        focusChar,
        suffix,
        delayMultiplier,
        isParagraphEnd,
        charOffset,
        charEndOffset,
        sourceStartOffset: offsets[visibleToken.start],
        sourceEndOffset: offsets[visibleToken.end - 1] + 1,
      });
    }
  }

  return { words: result, wrappers };
}

/**
 * Finds the word containing the source offset, or the next word in a gap.
 */
export function findWordIndexAtOffset(words: ParsedWord[], targetOffset: number): number {
  if (words.length === 0 || targetOffset <= 0) return 0;
  for (let index = 0; index < words.length; index++) {
    const offset = words[index].charOffset;
    if (typeof offset !== "number") continue;
    if (offset >= targetOffset) return index;
    const end = words[index].charEndOffset ?? offset + words[index].raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").length;
    if (targetOffset < end) return index;
  }
  return words.length - 1;
}

/**
 * Extracts Markdown headings and maps each one to its starting word index.
 */
export function extractHeadings(text: string, words: ParsedWord[]): HeadingItem[] {
  if (!text || words.length === 0) return [];
  const headings: HeadingItem[] = [];
  // Mask comments before scanning fences: an example fence inside a hidden
  // comment must not swallow real headings after it. Keep source offsets.
  let source = text.replace(/%%[\s\S]*?%%|<!--[\s\S]*?-->/g, (hidden) => hidden.replace(/[^\r\n]/g, " "));
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (frontmatter && /^[ \t]*[A-Za-z_][\w-]*[ \t]*:/m.test(frontmatter[1])) {
    source = frontmatter[0].replace(/[^\r\n]/g, " ") + source.slice(frontmatter[0].length);
  }
  const codeRanges = findFencedCodeRanges(source);
  let codeIndex = 0;
  let lineOffset = 0;
  for (const line of source.split("\n")) {
    const offset = lineOffset;
    lineOffset += line.length + 1;
    while (codeIndex < codeRanges.length && offset >= codeRanges[codeIndex].end) codeIndex++;
    if (codeIndex < codeRanges.length && offset >= codeRanges[codeIndex].start) continue;
    const match = /^(#{1,6})[ \t]+(.+?)[ \t\r]*$/.exec(line);
    if (!match) continue;
    const title = cleanMarkdown(match[2]).trim();
    if (!title) continue;
    const titleOffset = offset + match[1].length;
    const wordIndex = findWordIndexAtOffset(words, titleOffset);
    const wordOffset = words[wordIndex].charOffset;
    // Only headings represented in readable text belong in the reader TOC.
    if (wordOffset === undefined || wordOffset < titleOffset || wordOffset >= offset + line.length) continue;
    headings.push({ level: match[1].length, title, charOffset: offset, wordIndex });
  }
  return headings;
}
