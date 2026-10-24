import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';

globalThis.window = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: id => clearTimeout(id), fetch: undefined };
const entry = fileURLToPath(new URL('../src/unrealSpeech.ts', import.meta.url));
const code = buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', write: false })
  .outputFiles[0].text;
const mod = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

test('splitForSpeech keeps every chunk within the request limit', () => {
  const long = `${'Короткое предложение. '.repeat(90)}${'a'.repeat(2500)}`;
  const chunks = mod.splitForSpeech(long, 900);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) assert.ok(chunk.length <= 900, `chunk ${chunk.length}`);
  assert.equal(chunks.join('').replace(/\s+/g, ''), long.replace(/\s+/g, ''));
});

test('splitForSpeech returns nothing for blank text and never splits a word silently', () => {
  assert.deepEqual(mod.splitForSpeech('   \n\t '), []);
  const chunks = mod.splitForSpeech('слово '.repeat(400), 200);
  for (const chunk of chunks) assert.ok(chunk.split(' ').every(part => part === 'слово'));
});

test('wpmToSpeechSpeed maps the reader range into -1..1', () => {
  assert.equal(mod.wpmToSpeechSpeed(200), '0');
  assert.equal(mod.wpmToSpeechSpeed(60), '-0.31');
  assert.equal(mod.wpmToSpeechSpeed(650), '1');
  assert.equal(mod.wpmToSpeechSpeed(5000), '1');
});

test('RequestLimiter serialises calls with the configured spacing', async () => {
  const limiter = new mod.RequestLimiter(25);
  const started = [];
  const begin = Date.now();
  await Promise.all([1, 2, 3].map(index => limiter.schedule(async () => {
    started.push(Date.now() - begin);
    return index;
  })));
  assert.equal(started.length, 3);
  assert.ok(started[1] >= 20, `second call waited ${started[1]}ms`);
  assert.ok(started[0] <= started[1] && started[1] <= started[2]);
});

test('synthesizeSpeech posts the documented payload and returns audio bytes', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) };
  };
  const audio = await mod.synthesizeSpeech('Привет мир', { apiKey: ' test-key ', voiceId: 'Dan', wpm: 400 }, fakeFetch);
  assert.equal(audio.byteLength, 8);
  assert.equal(calls[0].url, mod.UNREAL_SPEECH_ENDPOINT);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer test-key');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.Text, 'Привет мир');
  assert.equal(body.VoiceId, 'Dan');
  assert.equal(body.Codec, 'libmp3lame');
  assert.equal(body.Speed, '0.44');
});

test('synthesizeSpeech validates input before touching the network', async () => {
  let called = false;
  const fakeFetch = async () => { called = true; return { ok: true, arrayBuffer: async () => new ArrayBuffer(1) }; };
  await assert.rejects(() => mod.synthesizeSpeech('   ', { apiKey: 'k' }, fakeFetch), /Пустой текст/);
  await assert.rejects(() => mod.synthesizeSpeech('x', { apiKey: '  ' }, fakeFetch), /Не задан ключ/);
  await assert.rejects(() => mod.synthesizeSpeech('x'.repeat(1001), { apiKey: 'k' }, fakeFetch), /длиннее/);
  assert.equal(called, false);
});

test('HTTP failures map to auth, rate and quota errors', async () => {
  const respond = status => async () => ({ ok: false, status, text: async () => 'nope' });
  await assert.rejects(
    () => mod.synthesizeSpeech('текст', { apiKey: 'k' }, respond(401)),
    error => error instanceof mod.UnrealSpeechError && error.kind === 'auth'
  );
  await assert.rejects(
    () => mod.synthesizeSpeech('текст', { apiKey: 'k' }, respond(429)),
    error => error.kind === 'rate'
  );
  await assert.rejects(
    () => mod.synthesizeSpeech('текст', { apiKey: 'k' }, respond(402)),
    error => error.kind === 'quota'
  );
});

test('countSpeechCharacters normalises whitespace', () => {
  assert.equal(mod.countSpeechCharacters('  привет   мир '), 10);
  assert.equal(mod.countSpeechCharacters('abc'), 3);
});
