import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

test('reader visibility is controlled by a scoped CSS class', () => {
  const css = read('styles.css');
  assert.match(css, /\.sr-modal-container\s+\.sr-hidden\s*\{\s*display:\s*none;/);
  assert.doesNotMatch(read('src/readerModal.ts'), /\.style\s*[.[]/);
});

test('release metadata uses the registered ID and matching versions', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const pkg = JSON.parse(read('package.json'));
  assert.equal(manifest.id, 'rsvp-speed-reader');
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.minAppVersion, '1.13.0');
});

test('note content is never rendered through HTML assignment', () => {
  assert.doesNotMatch(read('src/readerModal.ts'), /\.(?:innerHTML|outerHTML)\s*=/);
});

test('themes do not override host styles with important', () => {
  assert.doesNotMatch(read('styles.css'), /!important/);
});

test('styles avoid :has() and text-decoration features the minimum app lacks', () => {
  const css = read('styles.css');
  assert.doesNotMatch(css, /:has\(/, ':has() is flagged by the directory review');
  assert.doesNotMatch(css, /text-decoration|text-underline-offset/, 'text decoration properties are flagged by the directory review');
});

test('the host modal header is hidden through a class, not a :has() selector', () => {
  assert.match(read('styles.css'), /\.modal-header\.sr-header-hidden\s*\{\s*display:\s*none;/);
  assert.match(read('src/readerModal.ts'), /querySelector\("\.modal-header"\)\?\.addClass\("sr-header-hidden"\)/);
});

test('README is in English and the Russian translation is a separate file', () => {
  const english = read('README.md');
  const russian = read('README.ru.md');
  assert.match(english, /## Installation/);
  assert.match(english, /## Usage/);
  assert.match(english, /\[README\.ru\.md\]\(README\.ru\.md\)/);
  assert.ok(english.length > 3000, 'English README must document the plugin');
  assert.ok((english.match(/[А-Яа-яЁё]/g) ?? []).length < english.length / 100, 'README.md must stay English');
  assert.ok((russian.match(/[А-Яа-яЁё]/g) ?? []).length > 500, 'README.ru.md must hold the Russian text');
});
