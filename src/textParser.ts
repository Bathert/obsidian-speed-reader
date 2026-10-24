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
  let cleaned = text;

  // Remove YAML frontmatter
  cleaned = cleaned.replace(/^---[\s\S]*?---\s*/, "");

  // Remove code blocks
  cleaned = cleaned.replace(/```[\s\S]*?```/g, "");

  // Remove inline code
  cleaned = cleaned.replace(/`([^`]+)`/g, "$1");

  // Remove images ![[image]] or ![alt](url)
  cleaned = cleaned.replace(/!\[\[.*?\]\]/g, "");
  cleaned = cleaned.replace(/!\[.*?\]\(.*?\)/g, "");

  // Replace Obsidian links [[page|alias]] -> alias, [[page]] -> page
  cleaned = cleaned.replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, "$1");

  // Replace Markdown links [text](url) -> text
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  // Remove HTML tags
  cleaned = cleaned.replace(/<[^>]+>/g, "");

  // Remove header hashes (#, ##, etc.) but keep title words
  cleaned = cleaned.replace(/^#{1,6}\s+/gm, "");

  // Remove bold, italic, strikethrough: **, *, __, _, ~~
  cleaned = cleaned.replace(/(\*\*|__)(.*?)\1/g, "$2");
  cleaned = cleaned.replace(/(\*|_)(.*?)\1/g, "$2");
  cleaned = cleaned.replace(/~~(.*?)~~/g, "$1");

  // Remove blockquotes (>)
  cleaned = cleaned.replace(/^\s*>\s*/gm, "");

  // Remove task list checkboxes like - [ ] or - [x]
  cleaned = cleaned.replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, "");

  // Remove list bullets: -, *, +, 1.
  cleaned = cleaned.replace(/^\s*[-*+]\s+/gm, "");
  cleaned = cleaned.replace(/^\s*\d+\.\s+/gm, "");

  // Remove horizontal rules
  cleaned = cleaned.replace(/^\s*[-*_]{3,}\s*$/gm, "");

  return cleaned.trim();
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
  const safeWidth = Math.max(1, Math.min(3, Math.round(width)));

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
  const suffixPunct = match[3];
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
  const cleaned = cleanMarkdown(text);
  if (!cleaned.trim()) return [];

  // Split into paragraphs by double newlines
  const paragraphs = cleaned.split(/\n\s*\n+/).filter((p) => p.trim().length > 0);
  const result: ParsedWord[] = [];

  // Sequential search cursor into the ORIGINAL text. Markdown is stripped in
  // `cleaned`, so we re-locate every core word in the source in reading order.
  // A moving cursor (instead of indexOf from 0) keeps repeated words like "и"
  // pointing at their own occurrence rather than the first one in the note.
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
      }

      let punctMultiplier = 1.0;

      if (options.pauseOnPunctuation) {
        if (isParagraphEnd && options.pauseOnParagraphs) {
          punctMultiplier = options.paragraphPauseMultiplier ?? 2.5;
        } else if (/[.!?…]+["')\]}]*$/.test(token)) {
          punctMultiplier = options.sentencePauseMultiplier;
        } else if (/[,;:—–-]+["')\]}]*$/.test(token)) {
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

      // Locate the core word in the original note, moving forward only, so the
      // offset always belongs to the occurrence currently being read.
      let charOffset: number | undefined;
      if (coreWord.length > 0) {
        const found = text.indexOf(coreWord, searchFrom);
        if (found !== -1) {
          charOffset = found;
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
