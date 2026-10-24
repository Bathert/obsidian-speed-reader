/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * Minimal client for the Unreal Speech streaming endpoint.
 * Docs: POST https://api.v8.unrealspeech.com/stream with a Bearer key,
 * up to 1000 characters per request; the free plan allows 2 requests/second.
 */

export const UNREAL_SPEECH_ENDPOINT = "https://api.v8.unrealspeech.com/stream";
export const MAX_CHARS_PER_REQUEST = 1000;
/** Free plan: 2 requests per second -> keep a safety margin. */
export const MIN_REQUEST_INTERVAL_MS = 600;

export const UNREAL_SPEECH_VOICES = [
  "Amelia",
  "Charlotte",
  "Emily",
  "Autumn",
  "Luna",
  "Hannah",
  "Sierra",
  "Maddie",
  "Kaitlyn",
  "Ivy",
  "Chloe",
  "Eleanor",
  "Lauren",
  "Melody",
  "Giulia",
  "Lucía",
  "Élodie",
  "Camila",
  "Ananya",
  "Priya",
  "Sakura",
  "Yuki",
  "Hana",
  "Rina",
  "Jing",
  "Mei",
  "Ting",
  "Lian",
  "Sheng",
  "Wei",
  "Jian",
  "Hao",
  "Daniel",
  "Jasper",
  "Benjamin",
  "Edward",
  "Luca",
  "Rafael",
  "Javier",
  "Mateo",
  "Thiago",
  "Rohan",
  "Arjun",
  "Oliver",
  "Arthur",
  "Ronan",
  "Haruto",
  "Rowan",
  "Caleb",
  "Zane",
  "Noah",
  "Ethan",
  "Willow",
  "af",
] as const;

export type UnrealSpeechErrorKind = "empty" | "auth" | "rate" | "quota" | "network" | "server";

export class UnrealSpeechError extends Error {
  readonly kind: UnrealSpeechErrorKind;
  readonly status?: number;

  constructor(kind: UnrealSpeechErrorKind, message: string, status?: number) {
    super(message);
    this.name = "UnrealSpeechError";
    this.kind = kind;
    this.status = status;
  }
}

/**
 * Splits text into request-sized chunks on sentence, then word boundaries.
 */
export function splitForSpeech(text: string, max: number = MAX_CHARS_PER_REQUEST - 100): string[] {
  const limit = Math.max(50, Math.min(MAX_CHARS_PER_REQUEST, Math.trunc(max) || 1));
  const source = text.replace(/\s+/g, " ").trim();
  if (!source) return [];

  const chunks: string[] = [];
  let current = "";

  const push = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };

  // Split on sentence punctuation without lookbehind (old iOS WebViews).
  const sentences: string[] = [];
  let buffer = "";
  for (const part of source.split(/([.!?…]+)/)) {
    buffer += part;
    if (/^[.!?…]+$/.test(part)) {
      sentences.push(buffer.trim());
      buffer = "";
    }
  }
  if (buffer.trim()) sentences.push(buffer.trim());

  for (const sentence of sentences) {
    if (sentence.length > limit) {
      for (const word of sentence.split(" ")) {
        if (word.length > limit) {
          for (let i = 0; i < word.length; i += limit) {
            const piece = word.slice(i, i + limit);
            if (current.length + piece.length + 1 > limit) push();
            current += (current ? " " : "") + piece;
          }
          continue;
        }
        if (current.length + word.length + 1 > limit) push();
        current += (current ? " " : "") + word;
      }
      continue;
    }
    if (current.length + sentence.length + 1 > limit) push();
    current += (current ? " " : "") + sentence;
  }
  push();
  return chunks;
}

/** Maps the reader's WPM to the API speed range (-1.0 … 1.0). */
export function wpmToSpeechSpeed(wpm: number): string {
  const value = (Math.max(60, Math.min(1500, wpm)) - 200) / 450;
  return String(Math.max(-1, Math.min(1, Math.round(value * 100) / 100)));
}

const nativeFetch = typeof window !== "undefined" && typeof window.fetch === "function"
  ? window.fetch.bind(window)
  : undefined;

/** Serialises requests so the free plan's 2 rps limit is never exceeded. */
export class RequestLimiter {
  private nextAt = 0;
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly minIntervalMs: number = MIN_REQUEST_INTERVAL_MS) {}

  schedule<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      const now = Date.now();
      const wait = Math.max(0, this.nextAt - now);
      if (wait > 0) await new Promise((resolve) => window.setTimeout(resolve, wait));
      this.nextAt = Date.now() + this.minIntervalMs;
      return task();
    });
    this.chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }
}

export interface UnrealSpeechOptions {
  apiKey: string;
  voiceId?: string;
  bitrate?: string;
  wpm?: number;
}

const limiter = new RequestLimiter();

function classify(status: number, detail: string): UnrealSpeechError {
  if (status === 401 || status === 403) {
    return new UnrealSpeechError("auth", "Ключ Unreal Speech отклонён (401/403). Проверьте ключ в настройках.", status);
  }
  if (status === 429) {
    return new UnrealSpeechError("rate", "Лимит запросов Unreal Speech (2 запроса в секунду). Пауза и повтор.", status);
  }
  if (status === 402) {
    return new UnrealSpeechError("quota", "Закончился лимит символов тарифа Unreal Speech.", status);
  }
  return new UnrealSpeechError("server", `Unreal Speech ответил ${status}${detail ? `: ${detail}` : ""}`, status);
}

/**
 * Synthesises one chunk. Returns raw MP3 bytes.
 */
export async function synthesizeSpeech(
  text: string,
  options: UnrealSpeechOptions,
  fetchImpl?: typeof fetch
): Promise<ArrayBuffer> {
  const payloadText = text.trim();
  if (!payloadText) throw new UnrealSpeechError("empty", "Пустой текст для озвучки.");
  if (payloadText.length > MAX_CHARS_PER_REQUEST) {
    throw new UnrealSpeechError("server", `Текст длиннее ${MAX_CHARS_PER_REQUEST} символов — его нужно разбить.`);
  }
  if (!options.apiKey.trim()) {
    throw new UnrealSpeechError("auth", "Не задан ключ Unreal Speech.");
  }

  const request = fetchImpl ?? nativeFetch;
  if (!request) {
    throw new UnrealSpeechError("network", "В этом окружении нет fetch для запросов к Unreal Speech.");
  }

  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeout = controller ? window.setTimeout(() => controller.abort(), 20000) : 0;

  const response = await limiter.schedule(async () => {
    try {
      return await request(UNREAL_SPEECH_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${options.apiKey.trim()}`,
        },
        signal: controller?.signal,
        body: JSON.stringify({
          Text: payloadText,
          VoiceId: options.voiceId || "Scarlett",
          Bitrate: options.bitrate || "192k",
          Speed: wpmToSpeechSpeed(options.wpm ?? 300),
          Pitch: "1",
          Codec: "libmp3lame",
        }),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "AbortError";
      throw new UnrealSpeechError(
        "network",
        timedOut ? "Unreal Speech не ответил за 20 секунд." : error instanceof Error ? `Сеть недоступна: ${error.message}` : "Сеть недоступна."
      );
    } finally {
      if (timeout && typeof window.clearTimeout === "function") window.clearTimeout(timeout);
    }
  });

  if (!response.ok) {
    let detail = "";
    try {
      detail = (await response.text()).slice(0, 200);
    } catch {
      // Ignore unreadable error bodies.
    }
    throw classify(response.status, detail);
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength === 0) {
    throw new UnrealSpeechError("server", "Unreal Speech вернул пустой аудиопоток.");
  }
  return buffer;
}

/** Total characters that will be billed for the given text. */
export function countSpeechCharacters(text: string): number {
  return text.replace(/\s+/g, " ").trim().length;
}
