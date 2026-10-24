import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { harness } from './helpers/pluginHarness.mjs';

// Match the existing speech test loader; transpile only in memory.
Reflect.set(globalThis, 'window', { setTimeout, clearTimeout, fetch: undefined });
const code = buildSync({
  entryPoints: [fileURLToPath(new URL('../src/unrealSpeech.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', write: false,
}).outputFiles[0].text;
const speech = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

test('synthesizeSpeech fallback matches the configured default voice', async () => {
  const DEFAULT_SETTINGS = Reflect.get(harness(), 'DEFAULT_SETTINGS');
  const voices: string[] = [];
  const fakeFetch = async (_url: string, init: { body: string }) => {
    voices.push(JSON.parse(init.body).VoiceId);
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
  };
  for (const voiceId of [undefined, '', 'Charlotte']) {
    await speech.synthesizeSpeech('Voice probe', { apiKey: 'test-key', voiceId }, fakeFetch);
  }
  assert.deepEqual(voices, [
    DEFAULT_SETTINGS.unrealSpeechVoiceId,
    DEFAULT_SETTINGS.unrealSpeechVoiceId,
    'Charlotte',
  ]);
  assert.ok(speech.UNREAL_SPEECH_VOICES.includes(voices[0]), 'fallback must belong to the project voice list');
});

for (const outcome of ['success', 'timeout']) {
  test(`queued speech gets its own full timeout after dispatch: ${outcome}`, async () => {
    let now = 0, nextId = 0;
    const timers = new Map<number, {at: number; fn: () => void}>();
    const clock = {
      setTimeout(fn: () => void, ms: number) { const id = ++nextId; timers.set(id, {at: now + ms, fn}); return id; },
      clearTimeout(id: number) { timers.delete(id); },
    };
    const settle = async () => { for (let index = 0; index < 30; index++) await Promise.resolve(); };
    const advance = async (ms: number) => {
      const target = now + ms;
      while (true) {
        const due = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at;
        timers.delete(due[0]);
        due[1].fn();
        await settle();
      }
      now = target;
      await settle();
    };
    const context = {module: {exports: {}}, window: clock, AbortController, Error,
      Date: class extends Date { static now() { return now; } }};
    const bundle = buildSync({
      entryPoints: [fileURLToPath(new URL('../src/unrealSpeech.ts', import.meta.url))],
      bundle: true, platform: 'node', format: 'cjs', write: false,
    }).outputFiles[0].text;
    vm.runInNewContext(bundle, context);
    const calls: {at: number; aborted: boolean}[] = [];
    const fakeFetch = async (_url: string, init: {signal: AbortSignal}) => {
      calls.push({at: now, aborted: init.signal.aborted});
      const abortError = () => Object.assign(new Error('timeout'), {name: 'AbortError'});
      if (init.signal.aborted) throw abortError();
      return new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(abortError()), {once: true});
        if (calls.length === 2 && outcome === 'success') {
          clock.setTimeout(() => resolve({ok: true, arrayBuffer: async () => new ArrayBuffer(8)}), 19999);
        }
      });
    };
    const synthesize = Reflect.get(context.module.exports, 'synthesizeSpeech');
    const completedAt: number[] = [];
    const results = Promise.allSettled([
      synthesize('first', {apiKey: 'synthetic-test-key'}, fakeFetch),
      synthesize('second', {apiKey: 'synthetic-test-key'}, fakeFetch),
    ].map((promise: Promise<ArrayBuffer>, index) => promise.then(value => {
      completedAt[index] = now; return value;
    }, error => { completedAt[index] = now; throw error; })));
    await settle();
    assert.deepEqual(calls, [{at: 0, aborted: false}]);
    await advance(20000);
    assert.deepEqual(calls, [{at: 0, aborted: false}, {at: 20000, aborted: false}], 'queued request must not arrive pre-aborted');
    await advance(20000);
    const [first, second] = await results;
    assert.equal(first.status, 'rejected');
    if (first.status === 'rejected') assert.match(first.reason.message, /20 секунд/);
    assert.equal(second.status, outcome === 'success' ? 'fulfilled' : 'rejected');
    if (second.status === 'fulfilled') assert.equal(second.value.byteLength, 8);
    else assert.match(second.reason.message, /20 секунд/);
    assert.deepEqual(completedAt, [20000, outcome === 'success' ? 39999 : 40000]);
    assert.equal(timers.size, 0, 'success and timeout must both release timers');
  });
}
