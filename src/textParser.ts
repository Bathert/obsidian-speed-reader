/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
export interface ParsedWord {
  raw: string;
  prefix: string;
  focusChar: string;
  suffix: string;
  delayMultiplier: number;
  isParagraphEnd?: boolean;
  charOffset?: number;
}

export interface ParseOptions {
  pauseOnPunctuation: boolean;
  sentencePauseMultiplier: number;
  commaPauseMultiplier: number;
  pauseOnParagraphs?: boolean;
  paragraphPauseMultiplier?: number;
  pauseOnNumbersAndAcronyms?: boolean;
  spritzVariableTiming?: boolean; // Spritz feature 4: non-linear length timing
  /** Сколько букв подсвечивать в зоне фокуса: 1 (как в Spritz), 2 или 3. */
  orpWidth?: number;
}

/**
 * Strips markdown syntax to extract readable words for RSVP.
 */
export function cleanMarkdown(text: string): string {
  return cleanMarkdownWithOffsets(text).text;
}

/** Keep source positions through exactly the same transformations as visible text. */
function cleanMarkdownWithOffsets(text: string): { text: string; offsets: number[] } {
  let cleaned = text;
  let offsets = Array.from({ length: text.length }, (_, index) => index);
  const replace = (pattern: RegExp, replacement: string): void => {
    const nextOffsets: number[] = [];
    const appendOffsets = (start: number, end: number): void => {
      for (let index = start; index < end; index++) nextOffsets.push(offsets[index]);
    };
    let end = 0;
    cleaned = cleaned.replace(pattern, (...args: unknown[]) => {
      const match = args[0] as string;
      const start = args[args.length - 2] as number;
      appendOffsets(end, start);
      end = start + match.length;
      if (!replacement) return "";
      const group = Number(replacement.slice(1));
      // Re-execute on this match to obtain the retained group's exact position,
      // even when hidden link targets contain the same text as their label.
      const localPattern = new RegExp(pattern.source, pattern.flags.replace("g", "") + "d");
      const localMatch = localPattern.exec(match) as (RegExpExecArray & { indices: [number, number][] }) | null;
      const range = localMatch!.indices[group];
      appendOffsets(start + range[0], start + range[1]);
      return args[group] as string;
    });
    appendOffsets(end, offsets.length);
    offsets = nextOffsets;
  };

  // Remove YAML frontmatter
  replace(/^---[\s\S]*?---\s*/, "");

  // Remove code blocks
  replace(/```[\s\S]*?```/g, "");

  // Remove inline code
  replace(/`([^`]+)`/g, "$1");

  // Remove images ![[image]] or ![alt](url)
  replace(/!\[\[.*?\]\]/g, "");
  replace(/!\[.*?\]\(.*?\)/g, "");

  // Replace Obsidian links [[page|alias]] -> alias, [[page]] -> page
  replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, "$1");

  // Replace Markdown links [text](url) -> text
  replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  // Remove HTML tags
  replace(/<[^>]+>/g, "");

  // Remove header hashes (#, ##, etc.) but keep title words
  replace(/^#{1,6}\s+/gm, "");

  // Remove bold, italic, strikethrough: **, *, __, _, ~~
  replace(/(\*\*|__)(.*?)\1/g, "$2");
  replace(/(\*|_)(.*?)\1/g, "$2");
  replace(/~~(.*?)~~/g, "$1");

  // Remove blockquotes (>)
  replace(/^\s*>\s*/gm, "");

  // Remove task list checkboxes like - [ ] or - [x]
  replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, "");

  // Remove list bullets: -, *, +, 1.
  replace(/^\s*[-*+]\s+/gm, "");
  replace(/^\s*\d+\.\s+/gm, "");

  // Remove horizontal rules
  replace(/^\s*[-*_]{3,}\s*$/gm, "");

  const start = cleaned.match(/^\s*/)![0].length;
  const trimmed = cleaned.trim();
  return { text: trimmed, offsets: offsets.slice(start, start + trimmed.length) };
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
  const { text: cleaned, offsets } = cleanMarkdownWithOffsets(text);
  if (!cleaned.trim()) return [];

  // Split into paragraphs by double newlines
  const paragraphs = cleaned.split(/\n\s*\n+/).filter((p) => p.trim().length > 0);
  const result: ParsedWord[] = [];

  // Search visible text only; retained character positions map back to source.
  let searchFrom = 0;

  for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
    const paragraph = paragraphs[pIdx];
    const rawTokens = paragraph.split(/\s+/).filter((w) => w.length > 0);

    // Merge standalone punctuation with preceding word
    const mergedTokens: string[] = [];
    for (const token of rawTokens) {
      const hasWordChar = /[\p{L}\p{N}]/u.test(token);
      if (!hasWordChar && mergedTokens.length > 0) {
        mergedTokens[mergedTokens.length - 1] += ` ${token}`;
      } else if (hasWordChar) {
        mergedTokens.push(token);
      }
    }

    const isLastParagraph = pIdx === paragraphs.length - 1;

    for (let tIdx = 0; tIdx < mergedTokens.length; tIdx++) {
      const token = mergedTokens[tIdx];
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
        } else if (/[.!?…]+["'»”’）)\]}]*$/.test(token)) {
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
      if (coreWord.length > 0) {
        const found = cleaned.indexOf(coreWord, searchFrom);
        if (found !== -1) {
          charOffset = offsets[found];
          searchFrom = found + coreWord.length;
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
      });
    }
  }

  return result;
}

export interface WordChunk {
  raw: string;
  words: ParsedWord[];
  delayMultiplier: number;
}

/**
 * Groups parsed words into multi-word chunks (chunking mode: 1, 2, or 3 words).
 */
export function groupIntoChunks(words: ParsedWord[], chunkSize: number): WordChunk[] {
  chunkSize = Number.isFinite(chunkSize) ? Math.max(1, Math.floor(chunkSize)) : 1;
  if (chunkSize <= 1) {
    return words.map((w) => ({
      raw: w.raw,
      words: [w],
      delayMultiplier: w.delayMultiplier,
    }));
  }

  const chunks: WordChunk[] = [];
  for (let i = 0; i < words.length; i += chunkSize) {
    const slice = words.slice(i, i + chunkSize);
    const maxDelay = Math.max(...slice.map((w) => w.delayMultiplier));
    chunks.push({
      raw: slice.map((w) => w.raw).join(" "),
      words: slice,
      delayMultiplier: maxDelay,
    });
  }
  return chunks;
}
